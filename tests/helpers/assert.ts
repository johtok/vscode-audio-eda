import assert from "node:assert/strict";

export function assertApproximatelyEqual(
  actual: number,
  expected: number,
  tolerance: number,
  message?: string
): void {
  assert.ok(
    Number.isFinite(actual),
    message ? `${message} | value is not finite` : "value is not finite"
  );
  const delta = Math.abs(actual - expected);
  assert.ok(
    delta <= tolerance,
    message
      ? `${message} | expected ${expected} ± ${tolerance}, got ${actual} (|delta|=${delta})`
      : `expected ${expected} ± ${tolerance}, got ${actual} (|delta|=${delta})`
  );
}

export function assertInRange(
  actual: number,
  min: number,
  max: number,
  message?: string
): void {
  assert.ok(
    Number.isFinite(actual) && actual >= min && actual <= max,
    message
      ? `${message} | expected in [${min}, ${max}], got ${actual}`
      : `expected in [${min}, ${max}], got ${actual}`
  );
}
