// Child-process test fixture: JSON is data, never generated JavaScript source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mode = process.argv[2];
assert.ok(["source", "deployment"].includes(mode), "Unknown fixture mode.");
const responses = JSON.parse(readFileSync(0, "utf8"));
assert.ok(Array.isArray(responses));
globalThis.fetch = async (url) => {
  const expectedHost = mode === "source" ? "api.github.com" : "api.vercel.com";
  assert.equal(new URL(url).hostname, expectedHost, "Unexpected network host.");
  assert.ok(responses.length > 0, "Unexpected network request.");
  return Response.json(responses.shift());
};
await import("./ci-release.mjs");
