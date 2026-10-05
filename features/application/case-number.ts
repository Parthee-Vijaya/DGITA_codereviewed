export function newCaseNumber() {
  while (true) {
    const value = crypto.getRandomValues(new Uint32Array(1))[0];
    // 2^32 is not divisible by 100,000,000. Reject the remainder so each
    // eight-digit case number has exactly 42 equally likely source values.
    if (value >= 4_200_000_000) continue;
    return `ITA-${String(value % 100_000_000).padStart(8, "0")}`;
  }
}
