import { describe, expect, it } from "vitest";
import { formatCents, percentOfCents } from "./money";

describe("percentOfCents (round half up, integer cents)", () => {
  it.each([
    // amount, bps, expected
    [10_000, 1_000, 1_000], // 10% of $100.00
    [12_800, 1_000, 1_280],
    [1_005, 1_000, 101], //   100.5  -> 101 (half rounds up)
    [1_004, 1_000, 100], //   100.4  -> 100
    [1_015, 1_000, 102], //   101.5  -> 102
    [15, 1_000, 2], //        1.5    -> 2
    [14, 1_000, 1], //        1.4    -> 1
    [4_999, 1_500, 750], //   749.85 -> 750
    [0, 1_000, 0],
    [12_345, 10_000, 12_345], // 100%
  ])("%i cents at %i bps = %i", (amount, bps, expected) => {
    const result = percentOfCents(amount, bps);
    expect(result).toBe(expected);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [1_005, "$10.05"],
    [14_670, "$146.70"],
    [-2_000, "-$20.00"],
  ])("%i -> %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});
