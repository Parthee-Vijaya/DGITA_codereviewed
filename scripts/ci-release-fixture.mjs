// Child-process test fixture: JSON is data, never generated JavaScript source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mode = process.argv[2];
assert.ok(["source", "deployment"].includes(mode), "Unknown fixture mode.");
const responses = JSON.parse(readFileSync(0, "utf8"));
assert.ok(Array.isArray(responses));
globalThis.fetch = async (url, options) => {
  const expectedHost = mode === "source" ? "api.github.com" : "api.vercel.com";
  assert.equal(new URL(url).hostname, expectedHost, "Unexpected network host.");
  assert.ok(responses.length > 0, "Unexpected network request.");
  if (/\/code-scanning\/analyses\/\d+$/u.test(new URL(url).pathname)) {
    assert.equal(options.headers.Accept, "application/sarif+json");
  }
  const response = responses.shift();
  if (response?.__httpStatus) return new Response(null, { status: response.__httpStatus });
  if (response?.__rawBody) return new Response(response.__rawBody);
  return Response.json(response);
};
await import("./ci-release.mjs");
