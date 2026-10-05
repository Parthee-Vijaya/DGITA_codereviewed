import assert from "node:assert/strict";
import test from "node:test";
import { applicationOrigin, assertSameOrigin } from "../features/auth/http.ts";

test("Next internal request URLs use the configured public origin without trusting forwarded headers", (t) => {
  const previous = process.env.DGITA_APP_ORIGIN;
  process.env.DGITA_APP_ORIGIN = "https://portal.example.invalid";
  t.after(() => { if (previous === undefined) delete process.env.DGITA_APP_ORIGIN; else process.env.DGITA_APP_ORIGIN = previous; });
  const request = (origin) => new Request("http://localhost:3000/api/drafts", {
    method: "POST", headers: { origin, "x-forwarded-host": "attacker.invalid" },
  });
  assert.equal(applicationOrigin(request("https://portal.example.invalid")), "https://portal.example.invalid");
  assert.equal(applicationOrigin(request("https://portal.example.invalid"), { DGITA_APP_ORIGIN: "https://worker.example.invalid" }), "https://worker.example.invalid");
  assert.doesNotThrow(() => assertSameOrigin(request("https://portal.example.invalid")));
  for (const origin of ["https://attacker.invalid", "http://localhost:3000", "null"]) {
    assert.throws(() => assertSameOrigin(request(origin)), (error) => error.status === 403);
  }
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/drafts", { method: "POST" })), (error) => error.code === "INVALID_ORIGIN");
  assert.doesNotThrow(() => assertSameOrigin(request("https://worker.example.invalid"), { DGITA_APP_ORIGIN: "https://worker.example.invalid" }));
});
