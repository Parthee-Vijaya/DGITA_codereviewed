import assert from "node:assert/strict";
import test, { after } from "node:test";

Object.assign(process.env, {
  DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEMO_SEED:"false",
  TURSO_DATABASE_URL:":memory:",TURSO_AUTH_TOKEN:"mail-outbox-test-only",BLOB_READ_WRITE_TOKEN:"mail-outbox-test-only",
  DGITA_GRAPH_TENANT_ID:"11111111-2222-3333-4444-555555555555",
  DGITA_GRAPH_CLIENT_ID:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  DGITA_GRAPH_CLIENT_SECRET:"mail-outbox-test-only",DGITA_GRAPH_SENDER:"sender@example.invalid",
  DGITA_MAIL_ALLOWED_RECIPIENTS:"recipient@example.invalid",
});
const { ensurePortalSchema,getPersistenceBindings } = await import("../../db/persistence.ts");
const { processOutbox,processScheduledOutbox } = await import("./outbox.ts");
await ensurePortalSchema();
const {DB} = await getPersistenceBindings();
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error("No network is permitted by this test"); };
after(() => { globalThis.fetch = originalFetch; });

test("suspending a tenant prevents direct and scheduled delivery of already queued mail", async () => {
  const tenantId="suspended-mail-test";
  const userId="suspended-mail-admin";
  await DB.prepare("INSERT INTO portal_tenants (id,slug,name,status) VALUES (?,?,'Testkommune','suspended')").bind(tenantId,tenantId).run();
  await DB.prepare("INSERT INTO portal_users (id,tenant_id,identity_provider,external_subject,email,display_name,status) VALUES (?,?,'dev',?,'admin@example.invalid','Testadmin','active')").bind(userId,tenantId,userId).run();
  await DB.prepare("INSERT INTO portal_user_roles (id,tenant_id,user_id,role) VALUES ('mail-test-admin-role',?,?,'admin')").bind(tenantId,userId).run();
  await DB.prepare(`INSERT INTO portal_mail_outbox (id,tenant_id,recipient_email,template_key,subject,text_body,html_body,idempotency_key,status)
    VALUES ('suspended-queued-mail',?,'recipient@example.invalid','application.status','Test','Test','<p>Test</p>','suspended-queued-mail','queued')`).bind(tenantId).run();
  await assert.rejects(processOutbox({userId,tenantId,subject:userId,role:"admin",provider:"dev",email:"admin@example.invalid",displayName:"Testadmin",initials:"TA",municipality:"Testkommune"}),{code:"TENANT_INACTIVE"});
  const result=await processScheduledOutbox();
  assert.equal(result.processed,0);
  assert.equal(result.tenants,0);
  assert.equal(networkCalls,0);
  assert.equal(await DB.prepare("SELECT status FROM portal_mail_outbox WHERE id='suspended-queued-mail'").first("status"),"queued");
});

async function queue(id, status = "queued", timestamp = new Date().toISOString()) {
  await DB.prepare("INSERT OR IGNORE INTO portal_tenants (id,slug,name,status) VALUES ('machine-mail','machine-mail','Syntetisk kommune','active')").run();
  await DB.prepare(`INSERT INTO portal_mail_outbox (id,tenant_id,recipient_email,template_key,subject,text_body,html_body,idempotency_key,status,created_at,updated_at)
    VALUES (?,'machine-mail','recipient@example.invalid','application.status','Syntetisk','Syntetisk','<p>Syntetisk</p>',?,?,?,?)`)
    .bind(id,id,status,timestamp,timestamp).run();
}
let acceptedCalls = 0;
function acceptingTransport(beforeToken = async () => {}) {
  globalThis.fetch = async (url) => {
    networkCalls++;
    if (String(url).includes("/oauth2/")) {
      await beforeToken();
      return Response.json({access_token:"synthetic",expires_in:3600});
    }
    assert.match(String(url), /graph\.microsoft\.com\/v1\.0\/users\/.*\/sendMail$/);
    acceptedCalls++;
    return new Response(null,{status:202,headers:{"request-id":`synthetic-${acceptedCalls}`}});
  };
}

test("overlapping scheduled runs claim once without any human admin and audit a machine principal", async () => {
  await queue("machine-overlap");
  acceptingTransport();
  const before = acceptedCalls;
  const runs = await Promise.all([processScheduledOutbox(),processScheduledOutbox()]);
  assert.equal(acceptedCalls-before,1);
  assert.equal(runs.reduce((sum,result)=>sum+result.processed,0),1);
  const audit = await DB.prepare("SELECT actor_subject,actor_user_id FROM portal_audit_events WHERE entity_id='machine-overlap' AND event_type='mail.sent'").first();
  assert.deepEqual(audit,{actor_subject:"service:mail-scheduler",actor_user_id:null});
});

test("revocation after claim and before transport prevents sending", async () => {
  await queue("machine-revoked");
  acceptingTransport(async () => { await DB.prepare("UPDATE portal_mail_outbox SET status='cancelled' WHERE id='machine-revoked'").run(); });
  const before = acceptedCalls;
  await processScheduledOutbox();
  assert.equal(acceptedCalls,before);
  assert.equal(await DB.prepare("SELECT status FROM portal_mail_outbox WHERE id='machine-revoked'").first("status"),"cancelled");
});

test("an expired processing claim becomes unknown-delivery failure, never automatic retry", async () => {
  await queue("machine-unknown","processing",new Date(Date.now()-20*60_000).toISOString());
  acceptingTransport();
  const before = acceptedCalls;
  const result = await processScheduledOutbox();
  assert.equal(result.failed,1);
  assert.ok(result.queueAgeSeconds>=1200);
  const row = await DB.prepare("SELECT status,last_error FROM portal_mail_outbox WHERE id='machine-unknown'").first();
  assert.deepEqual(row,{status:"failed",last_error:"MAIL_DELIVERY_STATE_UNKNOWN"});
  await processScheduledOutbox();
  assert.equal(acceptedCalls,before);
});

test("a stale worker cannot cancel or send a newer processing attempt", async () => {
  await queue("machine-reclaimed");
  acceptingTransport(async () => { await DB.prepare("UPDATE portal_mail_outbox SET attempt_count=4 WHERE id='machine-reclaimed'").run(); });
  const before = acceptedCalls;
  await processScheduledOutbox();
  assert.equal(acceptedCalls,before);
  assert.deepEqual(await DB.prepare("SELECT status,attempt_count FROM portal_mail_outbox WHERE id='machine-reclaimed'").first(),{status:"processing",attempt_count:4});
});

test("explicit provider rejection retries with backoff; ambiguous send failure never retries", async () => {
  await queue("machine-backoff");
  globalThis.fetch = async (url) => String(url).includes("/oauth2/")
    ? Response.json({access_token:"synthetic",expires_in:3600})
    : Response.json({error:{code:"Throttled"}},{status:429,headers:{"retry-after":"60"}});
  await processScheduledOutbox();
  const queued=await DB.prepare("SELECT status,next_attempt_at,attempt_count FROM portal_mail_outbox WHERE id='machine-backoff'").first();
  assert.equal(queued.status,"queued");assert.equal(queued.attempt_count,1);assert.ok(Date.parse(queued.next_attempt_at)>Date.now());
  assert.equal((await processScheduledOutbox()).processed,0);
  await DB.prepare("UPDATE portal_mail_outbox SET next_attempt_at=NULL WHERE id='machine-backoff'").run();
  acceptingTransport();await processScheduledOutbox();
  assert.equal(await DB.prepare("SELECT status FROM portal_mail_outbox WHERE id='machine-backoff'").first("status"),"sent");
  await queue("machine-ambiguous");
  globalThis.fetch = async (url) => { if(String(url).includes("/oauth2/")) return Response.json({access_token:"synthetic",expires_in:3600});throw Error("socket closed after send"); };
  await processScheduledOutbox();
  assert.equal(await DB.prepare("SELECT status FROM portal_mail_outbox WHERE id='machine-ambiguous'").first("status"),"failed");
  acceptingTransport();const before=acceptedCalls;await processScheduledOutbox();assert.equal(acceptedCalls,before);
});

test("recovery quarantine blocks new mail and a claim already in progress", async () => {
  await queue("machine-quarantine");
  acceptingTransport(async () => {
    await DB.prepare("INSERT INTO portal_bootstrap_state (tenant_id,scope,version) VALUES ('machine-mail','recovery-quarantine','synthetic-bundle')").run();
  });
  const before=acceptedCalls;
  await processScheduledOutbox();
  assert.equal(acceptedCalls,before);
  await queue("machine-after-restore");
  assert.equal((await processScheduledOutbox()).processed,0);
  assert.equal(await DB.prepare("SELECT status FROM portal_mail_outbox WHERE id='machine-after-restore'").first("status"),"queued");
  await assert.rejects(processOutbox({tenantId:"machine-mail",role:"admin"}),{code:"MAIL_RECOVERY_QUARANTINED"});
});
