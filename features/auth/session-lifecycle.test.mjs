import assert from "node:assert/strict";
import test from "node:test";
import { readSessionPolicy, sessionTimeBounds } from "./session-lifecycle.ts";

test("pilot keeps test access duration while production gets a bounded idle policy", () => {
  assert.deepEqual(readSessionPolicy({ DGITA_ENVIRONMENT: "pilot" }), { maximumSeconds: 43200, idleSeconds: 43200, activityWriteIntervalSeconds: 60 });
  assert.deepEqual(readSessionPolicy({ DGITA_ENVIRONMENT: "production" }), { maximumSeconds: 43200, idleSeconds: 1800, activityWriteIntervalSeconds: 60 });
  assert.equal(readSessionPolicy({ DGITA_ENVIRONMENT: "typo" }).idleSeconds, 1800);
});

test("invalid, disabled, excessive or contradictory timeouts fail closed", () => {
  for (const value of ["", "0", "-1", "59", "43201", "600 ", " 600", "600.1", "1e3", "Infinity", "NaN"]) {
    assert.throws(() => readSessionPolicy({ DGITA_SESSION_MAX_SECONDS: value }), { code: "SESSION_POLICY_INVALID" });
    assert.throws(() => readSessionPolicy({ DGITA_SESSION_IDLE_SECONDS: value }), { code: "SESSION_POLICY_INVALID" });
  }
  assert.throws(() => readSessionPolicy({ DGITA_SESSION_MAX_SECONDS: "600", DGITA_SESSION_IDLE_SECONDS: "601" }), { code: "SESSION_POLICY_INVALID" });
});

test("time bounds apply changed policy to existing sessions without extending absolute expiry", () => {
  assert.deepEqual(sessionTimeBounds({ DGITA_SESSION_MAX_SECONDS: "3600", DGITA_SESSION_IDLE_SECONDS: "60" }, new Date("2026-10-05T12:00:00.000Z")), {
    maximumSeconds: 3600, idleSeconds: 60, activityWriteIntervalSeconds: 15,
    now: "2026-10-05T12:00:00.000Z", createdAfter: "2026-10-05T11:00:00.000Z",
    activeAfter: "2026-10-05T11:59:00.000Z", touchBefore: "2026-10-05T11:59:45.000Z",
  });
});
