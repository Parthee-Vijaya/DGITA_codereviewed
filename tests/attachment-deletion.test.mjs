import assert from "node:assert/strict";
import test from "node:test";

process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-deletion-test";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-deletion-test";
process.env.DGITA_APPROVAL_TOKEN_SECRET = "synthetic-deletion-test-secret-only-123456789";
delete process.env.NEXT_PUBLIC_DGITA_UPLOAD_MODE;

const { getPersistenceBindings } = await import("../db/persistence.ts");
const { preparePortalData, resolveActorUserId } = await import("../features/workspace/server-repository.ts");
const { saveApplicationDraft, getLatestApplicationDraft, storeApplicationAttachment, deleteApplicationAttachment, submitApplication } = await import("../features/application/server-repository.ts");
const { authorizeAttachmentDownload } = await import("../features/application/file-repository.ts");
const { runScheduledMaintenance } = await import("../features/runtime/scheduled-maintenance.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { DEMO_VIEWERS } = await import("../features/workspace/model.ts");

const DB = await preparePortalData();
const owner = { ...DEMO_VIEWERS.user, provider: "dev" };
owner.userId = await resolveActorUserId(DB, owner);

function state() {
  return {
    ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    manualSystemName: "Syntetisk sletteprøve", catalogQuery: "", consent: true,
  };
}

async function storageFixture(run) {
  const { FILES } = await getPersistenceBindings();
  const previous = { get: FILES.get, put: FILES.put, delete: FILES.delete };
  const objects = new Map();
  let failuresRemaining = 0;
  FILES.put = async (key, bytes) => { objects.set(key, new Uint8Array(bytes)); return { key }; };
  FILES.get = async (key) => {
    const bytes = objects.get(key);
    return bytes ? { arrayBuffer: async () => bytes.slice().buffer, body: new Blob([bytes]).stream() } : null;
  };
  FILES.delete = async (key) => {
    if (failuresRemaining > 0) { failuresRemaining -= 1; throw new Error("Synthetic storage outage"); }
    objects.delete(key);
  };
  try { await run({ FILES, objects, failDeletes: (count) => { failuresRemaining = count; } }); }
  finally { Object.assign(FILES, previous); }
}

async function draftWithAttachment() {
  const draft = await saveApplicationDraft(owner, crypto.randomUUID(), state());
  const attachment = await storeApplicationAttachment(owner, draft.id, "contract", new File(["%PDF-1.4\nsynthetic\n%%EOF"], "synthetic.pdf", { type: "application/pdf" }));
  return { draft, attachment };
}

function maintenance() {
  return runScheduledMaintenance({
    mail: async () => ({ configured: true, tenants: 1, processed: 0, failed: 0, queueAgeSeconds: 0 }),
    persist: async () => ({ status: "written", rowsAffected: 1 }),
    notify: async () => "not_configured",
    log: () => {},
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function rejectedVersionWithAttachment() {
  const { createLeaderApprovalRequest, decideLeaderApproval } = await import("../features/approval/server.ts");
  const { approvalTokenForRequest } = await import("../features/approval/token-service.ts");
  const consultant = { ...DEMO_VIEWERS.consultant, provider: "dev" };
  consultant.userId = await resolveActorUserId(DB, consultant);
  const { draft, attachment } = await draftWithAttachment();
  const input = { ...state(), hasContract: "ja" };
  input.attachments.contract = [attachment];
  await submitApplication(owner, draft.id, input, draft.rowVersion);
  const request = await createLeaderApprovalRequest(consultant, draft.caseNumber, "https://portal.example.invalid");
  await decideLeaderApproval(await approvalTokenForRequest(request.id), { decision: "rejected", comment: "Syntetisk rettelse" });
  return { draft, attachment };
}

test("scheduled maintenance retries failed attachment deletion without direct Blob upload enabled", async () => {
  await storageFixture(async ({ objects, failDeletes }) => {
    const { draft, attachment } = await draftWithAttachment();
    assert.equal((await authorizeAttachmentDownload(owner, attachment.id)).id, attachment.id);
    failDeletes(2);
    assert.equal(await deleteApplicationAttachment(owner, draft.id, attachment.id), true);
    assert.equal((await getLatestApplicationDraft(owner, draft.caseNumber)).state.attachments.contract.length, 0);
    await assert.rejects(authorizeAttachmentDownload(owner, attachment.id), { status: 404 });
    assert.equal(objects.size, 1, "temporary storage failure preserves a retry target");

    const failedTick = await maintenance();
    assert.equal(failedTick.uploadCleanup.blobsPendingRetry, 1);
    assert.equal(failedTick.cleanupFailed, true);
    const recoveredTick = await maintenance();
    assert.equal(recoveredTick.uploadCleanup.blobsDeleted, 1);
    assert.equal(recoveredTick.uploadCleanup.blobsPendingRetry, 0);
    assert.equal(objects.size, 0);
    const emptyTick = await maintenance();
    assert.equal(emptyTick.uploadCleanup.blobsDeleted, 0);
    assert.equal(emptyTick.uploadCleanup.blobsPendingRetry, 0);
  });
});

test("unused attachments removed by submission retain a retry target when storage deletion fails", async () => {
  await storageFixture(async ({ objects, failDeletes }) => {
    const { draft, attachment } = await draftWithAttachment();
    const input = { ...state(), hasContract: "nej" };
    input.attachments.contract = [attachment];
    failDeletes(1);
    assert.equal((await submitApplication(owner, draft.id, input, draft.rowVersion)).status, "submitted");
    assert.equal(objects.size, 1);
    await assert.rejects(authorizeAttachmentDownload(owner, attachment.id), { status: 404 });
    assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 1);
    assert.equal(objects.size, 0);
  });
});

test("an audit failure rolls back logical deletion before touching storage", async () => {
  await storageFixture(async ({ objects }) => {
    const { draft, attachment } = await draftWithAttachment();
    await DB.prepare(`CREATE TRIGGER fail_deletion_audit BEFORE INSERT ON portal_audit_events
      WHEN NEW.event_type = 'attachment.deleted'
      BEGIN SELECT RAISE(ABORT, 'Synthetic audit outage'); END`).run();
    try {
      await assert.rejects(deleteApplicationAttachment(owner, draft.id, attachment.id), /Synthetic audit outage/);
      assert.equal((await authorizeAttachmentDownload(owner, attachment.id)).id, attachment.id);
      assert.equal((await getLatestApplicationDraft(owner, draft.caseNumber)).state.attachments.contract.length, 1);
      assert.equal(objects.size, 1);
      assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 0);
    } finally {
      await DB.prepare("DROP TRIGGER fail_deletion_audit").run();
    }
  });
});

test("foreign actors and already submitted attachments cannot enter the deletion queue", async () => {
  await storageFixture(async ({ objects }) => {
    const { draft, attachment } = await draftWithAttachment();
    await assert.rejects(deleteApplicationAttachment({ ...owner, tenantId: "foreign-tenant" }, draft.id, attachment.id), { status: 403 });
    await assert.rejects(deleteApplicationAttachment({ ...owner, userId: "foreign-owner" }, draft.id, attachment.id), { status: 403 });
    const input = { ...state(), hasContract: "ja" };
    input.attachments.contract = [attachment];
    await submitApplication(owner, draft.id, input, draft.rowVersion);
    await assert.rejects(deleteApplicationAttachment(owner, draft.id, attachment.id), { status: 409 });
    assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 0);
    assert.equal((await authorizeAttachmentDownload(owner, attachment.id)).id, attachment.id);
    assert.equal(objects.size, 1);
  });
});

test("a lost database acknowledgement is retried after the object has already been deleted", async () => {
  await storageFixture(async ({ objects }) => {
    const { draft, attachment } = await draftWithAttachment();
    const originalPrepare = DB.prepare;
    let failAcknowledgement = true;
    DB.prepare = function (sql) {
      if (failAcknowledgement && sql.includes("UPDATE portal_attachments SET status = 'deleted'")) {
        failAcknowledgement = false;
        throw new Error("Synthetic acknowledgement outage");
      }
      return originalPrepare.call(this, sql);
    };
    try { assert.equal(await deleteApplicationAttachment(owner, draft.id, attachment.id), true); }
    finally { DB.prepare = originalPrepare; }
    assert.equal(objects.size, 0);
    assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 1);
    assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 0);
  });
});

test("repeated requests and concurrent maintenance safely drain the same queued deletion", async () => {
  await storageFixture(async ({ objects, failDeletes }) => {
    const { draft, attachment } = await draftWithAttachment();
    failDeletes(2);
    assert.deepEqual(await Promise.all([
      deleteApplicationAttachment(owner, draft.id, attachment.id),
      deleteApplicationAttachment(owner, draft.id, attachment.id),
    ]), [true, true]);
    await Promise.all([maintenance(), maintenance()]);
    assert.equal(objects.size, 0);
    assert.equal(await deleteApplicationAttachment(owner, draft.id, attachment.id), true);
    assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 0);
  });
});

test("ordinary queued deletion also runs when Vercel direct Blob upload is enabled", async () => {
  process.env.NEXT_PUBLIC_DGITA_UPLOAD_MODE = "vercel-blob";
  try {
    await storageFixture(async ({ objects, failDeletes }) => {
      const { draft, attachment } = await draftWithAttachment();
      failDeletes(1);
      await deleteApplicationAttachment(owner, draft.id, attachment.id);
      assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 1);
      assert.equal(objects.size, 0);
    });
  } finally { delete process.env.NEXT_PUBLIC_DGITA_UPLOAD_MODE; }
});

test("a slow concurrent correction copy cannot recreate an acknowledged deleted object", async () => {
  const { beginApplicationCorrection } = await import("../features/application/server-repository.ts");
  await storageFixture(async ({ FILES, objects, failDeletes }) => {
    const { draft, attachment } = await rejectedVersionWithAttachment();
    const original = await authorizeAttachmentDownload(owner, attachment.id);
    const originalPut = FILES.put;
    const firstStarted = deferred();
    const secondStarted = deferred();
    const releaseFirst = deferred();
    const releaseSecond = deferred();
    let copyAttempts = 0;
    let first;
    let second;
    FILES.put = async (...args) => {
      const attempt = ++copyAttempts;
      if (attempt === 1) { firstStarted.resolve(); await releaseFirst.promise; }
      if (attempt === 2) { secondStarted.resolve(); await releaseSecond.promise; }
      return originalPut(...args);
    };
    try {
      first = beginApplicationCorrection(owner, draft.caseNumber);
      await firstStarted.promise;
      second = beginApplicationCorrection(owner, draft.caseNumber);
      await secondStarted.promise;
      releaseFirst.resolve();
      const corrected = await first;
      const copy = corrected.state.attachments.contract[0];
      assert.ok(copy);
      await deleteApplicationAttachment(owner, draft.id, copy.id);
      assert.equal(objects.size, 1);
      failDeletes(1);
      releaseSecond.resolve();
      await second;
      assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 1);
      assert.equal(objects.size, 1, "only the original immutable version's object remains");
      assert.ok(objects.has(original.storage_key));
      assert.equal((await authorizeAttachmentDownload(owner, attachment.id)).storage_key, original.storage_key);
    } finally {
      releaseFirst.resolve(); releaseSecond.resolve();
      await Promise.allSettled([first, second].filter(Boolean));
      FILES.put = originalPut;
    }
  });
});

test("a rolled-back correction copy is queued for deletion before a successful retry", async () => {
  const { beginApplicationCorrection } = await import("../features/application/server-repository.ts");
  await storageFixture(async ({ objects, failDeletes }) => {
    const { draft, attachment } = await rejectedVersionWithAttachment();
    const original = await authorizeAttachmentDownload(owner, attachment.id);
    await DB.prepare(`CREATE TRIGGER fail_correction_copy BEFORE INSERT ON portal_attachments
      WHEN NEW.status = 'ready' AND NEW.application_version_id IS NULL
      BEGIN SELECT RAISE(ABORT, 'Synthetic copy registration outage'); END`).run();
    failDeletes(1);
    try {
      await assert.rejects(beginApplicationCorrection(owner, draft.caseNumber), /Synthetic copy registration outage/);
    } finally { await DB.prepare("DROP TRIGGER fail_correction_copy").run(); }
    const corrected = await beginApplicationCorrection(owner, draft.caseNumber);
    const copy = await DB.prepare("SELECT storage_key, status FROM portal_attachments WHERE id = ?")
      .bind(corrected.state.attachments.contract[0].id).first();
    assert.equal(copy.status, "ready");
    assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 1);
    assert.equal(objects.size, 2, "only the immutable original and active correction copy remain");
    assert.ok(objects.has(original.storage_key));
    assert.ok(objects.has(copy.storage_key));
  });
});

test("a lost correction batch reply preserves the committed attachment copy", async () => {
  const { beginApplicationCorrection } = await import("../features/application/server-repository.ts");
  await storageFixture(async ({ FILES, objects }) => {
    const { draft } = await rejectedVersionWithAttachment();
    const originalBatch = DB.batch;
    const originalPut = FILES.put;
    let copied = false;
    FILES.put = async (...args) => { const result = await originalPut(...args); copied = true; return result; };
    DB.batch = async function (statements) {
      const result = await originalBatch.call(this, statements);
      if (copied) throw new Error("Synthetic lost copy batch reply");
      return result;
    };
    try {
      await assert.rejects(beginApplicationCorrection(owner, draft.caseNumber), /Synthetic lost copy batch reply/);
    } finally { DB.batch = originalBatch; FILES.put = originalPut; }
    const corrected = await beginApplicationCorrection(owner, draft.caseNumber);
    const copy = await DB.prepare("SELECT storage_key, status FROM portal_attachments WHERE id = ?")
      .bind(corrected.state.attachments.contract[0].id).first();
    assert.equal(copy.status, "ready");
    assert.equal((await maintenance()).uploadCleanup.blobsDeleted, 0);
    assert.equal(objects.size, 2);
    assert.ok(objects.has(copy.storage_key), "an ambiguous reply must never cause deletion of a committed winner");
  });
});
