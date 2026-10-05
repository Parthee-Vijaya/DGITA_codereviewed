import assert from "node:assert/strict";
import test from "node:test";
import { createOperationalLogger } from "../features/privacy/operational-log.ts";
import { authErrorResponse } from "../features/auth/http.ts";

const CANARY = "SYNTHETIC_PRIVATE_CASE_TOKEN_91a8";
const summary = {
  event: "scheduler.completed", tenants: 2, processed: 5, failed: 0,
  queueAgeSeconds: 60, durationMs: 42, configured: true, cleanupFailed: false,
};

test("operational logs project exact fields and omit nested data, URLs and toJSON", () => {
  const lines = [];
  const log = createOperationalLogger((line) => lines.push(line));
  log({ ...summary, case: CANARY, token: CANARY, error: new Error(CANARY),
    url: `https://example.invalid/?token=${CANARY}`, toJSON() { throw new Error(CANARY); } });
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(record).sort(), [...Object.keys(summary), "at", "eventId", "level"].sort());
  assert.equal(record.processed, 5);
  assert.match(record.eventId, /^[0-9a-f-]{36}$/u);
  assert.equal(lines[0].includes(CANARY), false);
});

test("unknown events, invalid counters and hostile getters never reach log output", () => {
  const lines = [];
  const log = createOperationalLogger((line) => lines.push(line));
  for (const value of [CANARY, -1, Infinity, NaN, 1.5, 1_000_001]) log({ ...summary, processed: value });
  log({ ...summary, get processed() { return CANARY; } });
  log({ event: CANARY });
  log({ get event() { throw new Error(CANARY); } });
  for (const line of lines) {
    assert.equal(JSON.parse(line).event, "operational.invalid_event");
    assert.equal(line.includes(CANARY), false);
  }
});

test("sink failure does not change application behavior", () => {
  assert.doesNotThrow(() => createOperationalLogger(() => { throw new Error(CANARY); })({ event: "auth.unexpected_error" }));
});

test("unknown provider exception cannot leak its name, message or cause to logs or response", async () => {
  const lines = [];
  const original = console.error;
  console.error = (...values) => lines.push(values.join(" "));
  try {
    const error = new Error(CANARY, { cause: { token: CANARY } });
    error.name = CANARY;
    const response = authErrorResponse(error);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes(CANARY), false);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes(CANARY), false);
    assert.equal(JSON.parse(lines[0]).event, "auth.unexpected_error");
  } finally { console.error = original; }
});
