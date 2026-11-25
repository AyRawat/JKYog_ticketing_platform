import { describe, expect, it } from "vitest";
import { parseAgeText } from "./age-input";

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
