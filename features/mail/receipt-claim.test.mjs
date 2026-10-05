import assert from "node:assert/strict";
import test from "node:test";
import { demoApplicationState } from "../application/engine.ts";
Object.assign(process.env, { DGITA_ENVIRONMENT:"pilot", DGITA_ENABLE_DEMO_SEED:"false", TURSO_DATABASE_URL:":memory:", TURSO_AUTH_TOKEN:"synthetic", BLOB_READ_WRITE_TOKEN:"synthetic" });
const { ensurePortalSchema, getPersistenceBindings } = await import("../../db/persistence.ts");
const { getOrCreateOutboxReceipt } = await import("../receipt/server.ts");
await ensurePortalSchema();
const { DB, FILES } = await getPersistenceBindings();
const timestamp = new Date().toISOString();
await DB.prepare("INSERT INTO portal_tenants (id,slug,name) VALUES ('receipt-job','receipt-job','Testkommune')").run();
await DB.prepare("INSERT INTO portal_users (id,tenant_id,identity_provider,external_subject,email,display_name) VALUES ('receipt-owner','receipt-job','dev','synthetic','synthetic@example.invalid','Syntetisk bruger')").run();
await DB.prepare(`INSERT INTO portal_applications (id,tenant_id,owner_user_id,case_number,status,draft_schema_version,draft_state_json,current_version_number,current_version_id)
 VALUES ('receipt-case','receipt-job','receipt-owner','ITA-12345678','submitted','dgita-v1',?,2,'receipt-v2')`).bind(JSON.stringify(demoApplicationState)).run();
for (const number of [1,2]) await DB.prepare(`INSERT INTO portal_application_versions (id,tenant_id,application_id,version_number,schema_version,snapshot_json,snapshot_sha256,submitted_by_user_id,submitted_at)
 VALUES (?,'receipt-job','receipt-case',?,'dgita-v1',?,'synthetic','receipt-owner',?)`).bind(`receipt-v${number}`,number,JSON.stringify(demoApplicationState),timestamp).run();
const claim = { id:"receipt-mail",tenant_id:"receipt-job",application_id:"receipt-case",recipient_email:"synthetic@example.invalid",template_key:"application.status",idempotency_key:"receipt-mail",attachments_json:JSON.stringify([{receiptKind:"submission",applicationVersionId:"receipt-v1"}]),attempt_count:0 };
await DB.prepare(`INSERT INTO portal_mail_outbox (id,tenant_id,application_id,recipient_email,template_key,subject,text_body,html_body,idempotency_key,attachments_json,status,attempt_count)
 VALUES (?,?,?,?,'application.status','Syntetisk','Syntetisk','Syntetisk',?,?,'processing',1)`)
 .bind(claim.id,claim.tenant_id,claim.application_id,claim.recipient_email,claim.idempotency_key,claim.attachments_json).run();
const objects=new Map();
FILES.put=async (key,bytes)=>{objects.set(key,new Uint8Array(bytes));return {key};};
FILES.get=async (key)=>{const bytes=objects.get(key);return bytes?{arrayBuffer:async()=>bytes.buffer}:null;};

test("job receipt is limited to its DB claim and exact historical version reference", async () => {
  for (const invalid of [{...claim,tenant_id:"other"},{...claim,attempt_count:1},{...claim,recipient_email:"other@example.invalid"},{...claim,attachments_json:"[]"}]) {
    await assert.rejects(getOrCreateOutboxReceipt(invalid,"submission","receipt-v1"),{name:"MailCancelledError"});
  }
  await assert.rejects(getOrCreateOutboxReceipt(claim,"submission","receipt-v2"),{name:"MailAttachmentReferenceError"});
  const receipt=await getOrCreateOutboxReceipt(claim,"submission","receipt-v1");
  assert.equal(new TextDecoder().decode(receipt.bytes.slice(0,4)),"%PDF");
  const row=await DB.prepare("SELECT application_version_id,created_by_user_id FROM portal_receipts").first();
  assert.deepEqual(row,{application_version_id:"receipt-v1",created_by_user_id:null});
  const audit=await DB.prepare("SELECT actor_subject,actor_user_id FROM portal_audit_events WHERE event_type='receipt.generated'").first();
  assert.deepEqual(audit,{actor_subject:"service:mail-scheduler",actor_user_id:null});
});

test("a revoked claim cannot read an already materialized receipt", async () => {
  await DB.prepare("UPDATE portal_mail_outbox SET status='cancelled' WHERE id=?").bind(claim.id).run();
  await assert.rejects(getOrCreateOutboxReceipt(claim,"submission","receipt-v1"),{name:"MailCancelledError"});
});

test("revocation while storing a new PDF prevents publication and audit", async () => {
  await DB.prepare("UPDATE portal_mail_outbox SET status='processing',attachments_json=? WHERE id=?").bind(JSON.stringify([{receiptKind:"submission",applicationVersionId:"receipt-v2"}]),claim.id).run();
  const changed={...claim,attachments_json:JSON.stringify([{receiptKind:"submission",applicationVersionId:"receipt-v2"}])};
  FILES.put=async (key)=>{await DB.prepare("UPDATE portal_mail_outbox SET status='cancelled' WHERE id=?").bind(claim.id).run();return {key};};
  await assert.rejects(getOrCreateOutboxReceipt(changed,"submission","receipt-v2"),{name:"MailCancelledError"});
  assert.equal(await DB.prepare("SELECT COUNT(*) AS total FROM portal_receipts").first("total"),1);
});
