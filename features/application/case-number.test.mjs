import assert from "node:assert/strict";
import test from "node:test";
import { newCaseNumber } from "./case-number.ts";

function randomSequence(t, values) {
  const remaining = [...values];
  return t.mock.method(crypto, "getRandomValues", (buffer) => {
    assert.ok(buffer instanceof Uint32Array);
    assert.equal(buffer.length, 1);
    assert.ok(remaining.length > 0, "Generator requested an unexpected random value.");
    buffer[0] = remaining.shift();
    return buffer;
  });
}

test("case numbers retain leading zeroes and the full eight-digit range", (t) => {
  randomSequence(t, [0, 99_999_999, 100_000_000, 4_199_999_999]);
  assert.deepEqual(Array.from({ length: 4 }, () => newCaseNumber()), [
    "ITA-00000000", "ITA-99999999", "ITA-00000000", "ITA-99999999",
  ]);
});

test("case numbers discard every sampled value outside the evenly divisible range", (t) => {
  const random = randomSequence(t, [4_200_000_000, 4_294_967_295, 23]);
  assert.equal(newCaseNumber(), "ITA-00000023");
  assert.equal(random.mock.callCount(), 3);
});

test("case numbers fail when the secure random source is unavailable", (t) => {
  t.mock.method(crypto, "getRandomValues", () => { throw new Error("Random source unavailable"); });
  assert.throws(() => newCaseNumber(), /Random source unavailable/u);
});
