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
