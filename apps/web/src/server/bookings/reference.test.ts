import { describe, expect, it } from "vitest";
import { newReference, referencePrefix } from "./reference";

describe("booking references", () => {
  it.each([
    ["sharad-utsav-2026", "SU26"],
    ["diwali-2027", "D27"],
    ["navratri-garba-night", "NGN"],
    ["a-b-c-d-e-2026", "ABCD26"],
    ["2026", "26"],
  ])("%s -> prefix %s", (slug, prefix) => {
    expect(referencePrefix(slug)).toBe(prefix);
  });

  it("is the prefix and 6 characters that are easy to read out", () => {
    expect(newReference("sharad-utsav-2026")).toMatch(/^SU26-[2-9A-HJKMNP-TV-Z]{6}$/);
  });

  it("is random: 200 references don't repeat", () => {
    const references = new Set(
      Array.from({ length: 200 }, () => newReference("sharad-utsav-2026")),
    );
    expect(references.size).toBe(200);
  });
});
