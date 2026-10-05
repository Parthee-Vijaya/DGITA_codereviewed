import assert from "node:assert/strict";
import test from "node:test";

process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-approver-directory";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-approver-directory";

const { preparePortalData } = await import("../features/workspace/server-repository.ts");
const { DEMO_VIEWERS } = await import("../features/workspace/model.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { canonicalizeApprovingLeader, listApproversForActor } = await import("../features/application/approver-repository.ts");
const DB = await preparePortalData();
const actor = { ...DEMO_VIEWERS.user, userId: DEMO_VIEWERS.user.subject, provider: "dev" };
const approverId = crypto.randomUUID();
await DB.prepare(`INSERT INTO portal_users
  (id, tenant_id, identity_provider, external_subject, email, display_name)
  VALUES (?, 'kalundborg', 'entra', ?, 'approver@example.invalid', 'Synthetic Approver')`)
  .bind(approverId, `tenant:${crypto.randomUUID()}`).run();
await DB.prepare("INSERT INTO portal_user_roles (id, tenant_id, user_id, role) VALUES (?, 'kalundborg', ?, 'approver')")
  .bind(crypto.randomUUID(), approverId).run();

test("the real tenant approver directory supports newly provisioned identities and excludes self", async () => {
  const options = await listApproversForActor(actor);
  assert.equal(options.some((entry) => entry.id === actor.userId), false);
  assert.deepEqual(options.find((entry) => entry.id === approverId), { id: approverId, name: "Synthetic Approver" });
  assert.equal(JSON.stringify(options).includes("email"), false);
});

test("the database canonicalizes the approver name and rejects forged or cross-tenant mandates", async () => {
  const input = { ...demoApplicationState, approvingLeaderId: approverId, approvingLeader: "Forged name" };
  const result = await canonicalizeApprovingLeader(DB, actor, input);
  assert.equal(result.approvingLeader, "Synthetic Approver");
  await assert.rejects(canonicalizeApprovingLeader(DB, actor, { ...input, approvingLeaderId: crypto.randomUUID() }));
  await assert.rejects(canonicalizeApprovingLeader(DB, { ...actor, tenantId: "different-tenant" }, input));
  await assert.rejects(canonicalizeApprovingLeader(DB, actor, { ...input, approvingLeaderId: actor.userId }));
  await DB.prepare("DELETE FROM portal_user_roles WHERE user_id = ? AND role = 'approver'").bind(approverId).run();
  await assert.rejects(canonicalizeApprovingLeader(DB, actor, input));
});
