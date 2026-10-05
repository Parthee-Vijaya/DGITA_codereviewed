import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudit } from "./ci-audit.mjs";

function fixture() {
  const advisory = { url: "https://github.com/advisories/GHSA-test", source: 7, name: "leaf", range: "<2", severity: "high" };
  return {
    full: { vulnerabilities: { parent: { via: ["leaf"], nodes: ["node_modules/parent"] }, leaf: { via: [advisory], nodes: ["node_modules/leaf"] } } },
    production: { vulnerabilities: {} },
    lock: { packages: { "node_modules/parent": { version: "1.0.0", dev: true }, "node_modules/leaf": { version: "1.0.0", dev: true } } },
    policy: { schemaVersion: 1, exceptions: [{ ...advisory, advisory: "GHSA-test", vulnerablePackage: "leaf", expiresAt: "2026-11-04T00:00:00Z", allowedAffectedNodes: [{ package: "parent", path: "node_modules/parent", version: "1.0.0" }, { package: "leaf", path: "node_modules/leaf", version: "1.0.0" }] }] },
  };
}
const check = (f, date = "2026-10-05T12:00:00Z") => evaluateAudit(f.full, f.production, f.lock, f.policy, new Date(date));

test("accepts only the reviewed development chain and records both nodes", () => {
  const result = check(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.accepted.length, 2);
});
test("rejects a production finding even when the advisory has an exception", () => {
  const f = fixture(); f.production.vulnerabilities.leaf = f.full.vulnerabilities.leaf;
  assert.match(check(f).errors.join(), /Production dependency/u);
});
test("rejects expiry, version changes, newly reachable nodes and runtime reclassification", () => {
  assert.match(check(fixture(), "2026-11-04T00:00:00Z").errors.join(), /No current/u);
  for (const mutate of [
    (f) => { f.lock.packages["node_modules/leaf"].version = "1.0.1"; },
    (f) => { f.full.vulnerabilities.leaf.nodes.push("node_modules/other/node_modules/leaf"); },
    (f) => { f.lock.packages["node_modules/leaf"].dev = false; },
  ]) {
    const f = fixture(); mutate(f); assert.match(check(f).errors.join(), /Unapproved dependency node/u);
  }
});
test("rejects unknown or changed advisory in a transitive chain", () => {
  const f = fixture(); f.full.vulnerabilities.leaf.via[0].source = 8;
  assert.equal(check(f).errors.length, 2);
});
test("rejects failed audit responses and incomplete dependency chains", () => {
  const f = fixture(); f.full.error = { code: "NETWORK_ERROR" };
  assert.match(check(f).errors.join(), /invalid audit/u);
  delete f.full.error; delete f.full.vulnerabilities.leaf;
  assert.match(check(f).errors.join(), /Unresolved audit/u);
});
