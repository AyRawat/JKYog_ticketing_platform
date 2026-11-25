import { describe, expect, it } from "vitest";
import { ageBand, checkBooker, isValidAge, productAdmitsBand } from "./age";
import { adultDayPass, issueCodes, makeCatalog, quote } from "./test/fixtures";
import type { AgeRules, EntryProduct } from "./types";

const rules: AgeRules = makeCatalog().event.ageRules;

describe("age bands (age on 10 Dec, thresholds from the event)", () => {
  it.each([
    [0, "infant"],
    [4, "infant"],
    [5, "child"],
    [11, "child"],
    [12, "adult"],
    [17, "adult"],
    [18, "adult"],
    [120, "adult"],
  ] as const)("age %i is %s", (age, band) => {
    expect(ageBand(age, rules)).toBe(band);
  });

  it("follows the event's thresholds rather than fixed numbers", () => {
    const nextYear: AgeRules = { ...rules, childMinAge: 3, adultMinAge: 13 };
    expect(ageBand(3, nextYear)).toBe("child");
    expect(ageBand(12, nextYear)).toBe("child");
    expect(ageBand(13, nextYear)).toBe("adult");
  });
});

describe("typed-in ages", () => {
  it.each([0, 1, 18, 120])("accepts %s", (age) => {
    expect(isValidAge(age)).toBe(true);
  });

  it.each([-1, 4.5, 121, Number.NaN, Number.POSITIVE_INFINITY, 1e9])("rejects %s", (age) => {
    expect(isValidAge(age)).toBe(false);
  });

  it("reports a nonsense attendee age against that attendee", () => {
    const q = quote({ attendees: [adultDayPass(), { ageYears: -3, entry: null }] });
    expect(q.issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_AGE", path: "attendees[1].ageYears" }),
    );
    expect(q.canBook).toBe(false);
  });
});

describe("the person booking", () => {
  it.each([
    [17, ["BOOKER_TOO_YOUNG"]],
    [18, []],
    [65, []],
    [-1, ["INVALID_AGE"]],
    [30.5, ["INVALID_AGE"]],
  ])("age %s -> %j", (age, expected) => {
    expect(checkBooker({ ageYears: age }, rules).map((i) => i.code)).toEqual(expected);
  });

  it("does not have to attend (a grandparent booking for the family)", () => {
    const q = quote({ booker: { ageYears: 70 }, attendees: [adultDayPass(["2026-12-12"], 30)] });
    expect(q.issues).toEqual([]);
    expect(q.canBook).toBe(true);
  });

  it("can also attend, listed as an attendee like anyone else", () => {
    const q = quote({ booker: { ageYears: 40 }, attendees: [adultDayPass(["2026-12-12"], 40)] });
    expect(q.issues).toEqual([]);
    expect(q.canBook).toBe(true);
  });

  it("a 17-year-old cannot book, even for themselves", () => {
    const q = quote({ booker: { ageYears: 17 }, attendees: [adultDayPass(["2026-12-12"], 17)] });
    expect(issueCodes(q)).toEqual(["BOOKER_TOO_YOUNG"]);
    expect(q.canBook).toBe(false);
  });

  it("is optional while the form is half filled, but then the cart can't be booked yet", () => {
    const q = quote({ booker: null, attendees: [adultDayPass()] });
    expect(q.issues).toEqual([]);
    expect(q.totalCents).toBe(1_500);
    expect(q.canBook).toBe(false);
  });
});

describe("which bands a ticket can hold (by who it admits)", () => {
  const entryProduct = (code: string): EntryProduct => {
    const product = makeCatalog().products.find((p) => p.code === code);
    if (product?.kind !== "entry") throw new Error(`No entry product ${code}`);
    return product;
  };

  it.each([
    ["DAY_PASS_ADULT", { adult: true, child: false }],
    ["DAY_PASS_CHILD", { adult: false, child: true }],
    ["FAMILY_PASS", { adult: true, child: true }],
  ])("%s", (code, expected) => {
    const product = entryProduct(code);
    expect(productAdmitsBand(product, "adult")).toBe(expected.adult);
    expect(productAdmitsBand(product, "child")).toBe(expected.child);
  });
});
