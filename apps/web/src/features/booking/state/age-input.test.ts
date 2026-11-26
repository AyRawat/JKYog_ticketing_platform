import { describe, expect, it } from "vitest";
import { bandForAgeText, parseAgeText } from "./age-input";

const rules = { referenceDate: "2026-12-10", childMinAge: 5, adultMinAge: 12, bookerMinAge: 18 };

describe("parseAgeText", () => {
  it.each([
    ["0", 0],
    ["9", 9],
    [" 42 ", 42],
    ["120", 120],
    // Out of range but a whole number: the server reports it, so the family sees why.
    ["200", 200],
  ])("reads %j as %i", (text, expected) => {
    expect(parseAgeText(text)).toBe(expected);
  });

  it.each(["", "  ", "4.5", "-1", "ten", "1e2", "0x10", "1000", "12a"])("rejects %j", (text) => {
    expect(parseAgeText(text)).toBeNull();
  });
});

describe("bandForAgeText", () => {
  it.each([
    ["0", "infant"],
    ["4", "infant"],
    ["5", "child"],
    ["11", "child"],
    ["12", "adult"],
    ["120", "adult"],
  ])("puts %j in the %s band", (text, band) => {
    expect(bandForAgeText(text, rules)).toBe(band);
  });

  it.each(["", "4.5", "121", "ten"])("has no band for %j", (text) => {
    expect(bandForAgeText(text, rules)).toBeNull();
  });
});
