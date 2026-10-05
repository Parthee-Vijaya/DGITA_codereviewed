import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isAllowedPrivateBlobUrl, isAllowedVercelBlobUploadUrl } from "../../features/application/direct-upload-client.ts";

/** Real Next routes and the browser's HTTP contract, with Blob transport confined to loopback. */
export async function exerciseDirectUpload({ user, consultant, anonymous, applicationId, database, fixtureOrigin }) {
  const fixture = new URL(fixtureOrigin);
  assert.equal(fixture.protocol, "http:");
  assert.equal(fixture.hostname, "127.0.0.1");
  const bytes = (content) => Buffer.from(`%PDF-1.4\nfixture:${content}\n%%EOF`);
  const prepare = (client, content) => client.json("/api/uploads/presign", {
    method: "POST", body: { draftId: applicationId, kind: "contract", name: "direct-synthetic.pdf",
      size: content.length, contentType: "application/pdf", checksum: createHash("sha256").update(content).digest("hex") },
  });
  const expect = (result, status, label) => {
    assert.equal(result.response.status, status, `${label}: ${JSON.stringify(result.payload)}`);
    assert.match(result.response.headers.get("cache-control") || "", /no-store/u);
  };
  const deniedAnonymous = await prepare(anonymous, bytes("clean"));
  expect(deniedAnonymous, 401, "Anonymous presign");
  const deniedOtherOwner = await prepare(consultant, bytes("clean"));
  expect(deniedOtherOwner, 403, "Another user's draft presign");

  async function transfer(original, actual = original) {
    const prepared = await prepare(user, original);
    expect(prepared, 201, "Direct presign");
    const grant = prepared.payload.directUpload;
    assert.ok(isAllowedVercelBlobUploadUrl(grant.uploadUrl));
    const uploadUrl = new URL(grant.uploadUrl);
    assert.equal(uploadUrl.hostname, "vercel.com");
    assert.equal(grant.contentType, "application/pdf");
    assert.ok(Date.parse(grant.expiresAt) > Date.now());
    const pending = await database.execute({ sql: "SELECT status, scan_status FROM portal_attachments WHERE id = ?", args: [grant.attachmentId] });
    assert.equal(pending.rows[0].status, "pending");
    assert.equal(pending.rows[0].scan_status, "pending");
    const pendingFile = await user.request(`/api/files/${grant.attachmentId}`, { redirect: "manual" });
    assert.equal(pendingFile.status, 404, "Unverified bytes must not receive a download delegation.");
    assert.equal(pendingFile.headers.get("location"), null);
    await pendingFile.body?.cancel();
    const uploaded = await fetch(`${fixture.origin}${uploadUrl.pathname}${uploadUrl.search}`, {
      method: "PUT", headers: { "Content-Type": grant.contentType, "x-dgita-fixture-host": uploadUrl.hostname },
      body: actual, redirect: "error", signal: AbortSignal.timeout(5000),
    });
    assert.equal(uploaded.status, 200, "Direct Blob PUT");
    const blob = await uploaded.json();
    assert.ok(isAllowedPrivateBlobUrl(blob.url));
    assert.equal(blob.pathname, uploadUrl.searchParams.get("pathname"));
    return { draftId: applicationId, attachmentId: grant.attachmentId, blobUrl: blob.url };
  }

  for (const [name, original, actual, status, scanStatus] of [
    ["checksum mismatch", bytes("clean"), bytes("other"), 422, "failed"],
    ["infected", bytes("infected"), bytes("infected"), 422, "infected"],
    ["scanner unavailable", bytes("unavailable"), bytes("unavailable"), 503, "failed"],
  ]) {
    const body = await transfer(original, actual);
    const rejected = await user.json("/api/uploads/complete", { method: "POST", body });
    expect(rejected, status, `Direct completion rejects ${name}`);
    const retained = await database.execute({ sql: "SELECT status, scan_status, deleted_at FROM portal_attachments WHERE id = ?", args: [body.attachmentId] });
    assert.notEqual(retained.rows[0].status, "ready");
    assert.equal(retained.rows[0].scan_status, scanStatus);
    assert.ok(retained.rows[0].deleted_at, "Rejected upload must remain inaccessible.");
    const location = new URL(body.blobUrl);
    const removed = await fetch(`${fixture.origin}${location.pathname}`, {
      headers: { "x-dgita-fixture-host": location.hostname, Authorization: "Bearer synthetic-object-probe" },
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    assert.equal(removed.status, 404, "Rejected bytes must be deleted from the fixture store.");
    await removed.body?.cancel();
  }

  const body = await transfer(bytes("clean"));
  expect(await anonymous.json("/api/uploads/complete", { method: "POST", body }), 401, "Anonymous completion");
  expect(await consultant.json("/api/uploads/complete", { method: "POST", body }), 403, "Another user's completion");
  expect(await user.json("/api/uploads/complete", { method: "POST", sameOrigin: false, body }), 403, "Completion without Origin");
  const completed = await user.json("/api/uploads/complete", { method: "POST", body });
  expect(completed, 200, "Clean direct completion");
  assert.equal(completed.payload.attachment.id, body.attachmentId);
  assert.equal(completed.payload.attachment.status, "uploaded");
  const repeated = await user.json("/api/uploads/complete", { method: "POST", body });
  expect(repeated, 200, "Idempotent direct completion");
  assert.deepEqual(repeated.payload, completed.payload);
  const row = await database.execute({ sql: "SELECT status, scan_status, checksum_sha256 FROM portal_attachments WHERE id = ?", args: [body.attachmentId] });
  assert.equal(row.rows[0].status, "ready");
  assert.equal(row.rows[0].scan_status, "clean");
  assert.equal(row.rows[0].checksum_sha256, createHash("sha256").update(bytes("clean")).digest("hex"));
  const audits = await database.execute({ sql: "SELECT COUNT(*) AS total FROM portal_audit_events WHERE id = ?", args: [`attachment-upload:${body.attachmentId}`] });
  assert.equal(Number(audits.rows[0].total), 1, "Repeated completion must not duplicate the publication audit.");
  console.log("Direct upload: presign, PUT, complete, ownership, CSRF, integrity, scan failures, cleanup and idempotency passed.");
  return completed.payload.attachment;
}
