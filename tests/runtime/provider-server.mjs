import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

export async function startProviderFixtures(applicationOrigin) {
  const objects = new Map();
  const evidence = { blobWrites: 0, blobReads: 0, scanClean: 0, scanRejected: 0, scanUnavailable: 0, mailAccepted: 0, approvalLinks: 0, unexpectedRequests: 0 };
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const host = request.headers["x-dgita-fixture-host"];
      const url = new URL(request.url, "http://fixture.invalid");
      const json = (status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
      if (host !== "login.microsoftonline.com" && !url.searchParams.has("vercel-blob-delegation")) assert.ok(request.headers.authorization, "Provider authentication is required.");
      if (host === "scanner.example.invalid" && request.method === "POST" && url.pathname === "/scan") {
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        assert.equal(request.headers["x-content-sha256"], sha256);
        if (bytes.includes("fixture:unavailable")) { evidence.scanUnavailable += 1; return json(503, {}); }
        const infected = bytes.includes("fixture:infected");
        evidence[infected ? "scanRejected" : "scanClean"] += 1;
        return json(200, { verdict: infected ? "infected" : "clean", sha256 });
      }
      if (host === "login.microsoftonline.com" && url.pathname.endsWith("/oauth2/v2.0/token")) {
        return json(200, { access_token: "synthetic-graph-token", token_type: "Bearer", expires_in: 3600 });
      }
      if (host === "graph.microsoft.com" && url.pathname.endsWith("/sendMail")) {
        const payload = JSON.parse(bytes.toString());
        assert.ok(payload.message.toRecipients.every((recipient) => recipient.emailAddress.address.endsWith("@example.invalid")));
        for (const match of payload.message.body.content.matchAll(/href="([^"]+\/approve\/[^"]+)"/gu)) {
          assert.equal(new URL(match[1]).origin, applicationOrigin);
          evidence.approvalLinks += 1;
        }
        evidence.mailAccepted += 1;
        response.writeHead(202, { "request-id": `fixture-${evidence.mailAccepted}` }); return response.end();
      }
      if (host === "vercel.com" && url.pathname === "/api/blob/signed-token") {
        const scope = JSON.parse(bytes.toString());
        assert.ok(scope.pathname && scope.validUntil > Date.now());
        return json(200, { delegationToken: `${Buffer.from(JSON.stringify({ ...scope, storeId: "fixture" })).toString("base64url")}.synthetic`, clientSigningToken: "synthetic-signing-token" });
      }
      if (host === "vercel.com" && url.pathname === "/api/blob/" && request.method === "PUT") {
        const pathname = url.searchParams.get("pathname");
        assert.ok(pathname);
        const contentType = request.headers["x-content-type"] || "application/octet-stream";
        objects.set(pathname, { bytes, contentType }); evidence.blobWrites += 1;
        const blobUrl = `https://fixture.private.blob.vercel-storage.com/${pathname}`;
        return json(200, { url: blobUrl, downloadUrl: blobUrl, pathname, contentType, contentDisposition: "attachment", etag: createHash("sha256").update(bytes).digest("hex") });
      }
      if (host === "fixture.private.blob.vercel-storage.com" && request.method === "GET") {
        const object = objects.get(decodeURIComponent(url.pathname.slice(1)));
        if (!object) return json(404, {});
        evidence.blobReads += 1;
        response.writeHead(200, { "content-type": object.contentType, "content-length": object.bytes.length, "last-modified": new Date().toUTCString(), etag: '"fixture"' });
        return response.end(object.bytes);
      }
      if (host === "vercel.com" && url.pathname === "/api/blob/delete") {
        for (const value of JSON.parse(bytes.toString()).urls) objects.delete(value.startsWith("https:") ? new URL(value).pathname.slice(1) : value);
        return json(200, {});
      }
      evidence.unexpectedRequests += 1; return json(400, { error: { code: "bad_request", message: "Unexpected fixture request" } });
    } catch { evidence.unexpectedRequests += 1; response.writeHead(500); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, evidence, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}
