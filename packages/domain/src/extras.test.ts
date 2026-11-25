import { describe, expect, it } from "vitest";
import {
  adultDayPass,
  childDayPass,
  DURING_FESTIVAL,
  extra,
  infant,
  issueCodes,
  lineSummary,
  quote,
} from "./test/fixtures";

const onTwelfth = [adultDayPass(["2026-12-12"]), childDayPass(["2026-12-12"])];

describe("Dandiya Sticks (whole-event, max 20 per booking)", () => {
  it("20 pairs is fine", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DANDIYA_STICKS", 20)] });
    expect(q.issues).toEqual([]);
    expect(lineSummary(q)).toContain("DANDIYA_STICKS@all x20 = 10000");
  });

  it("21 pairs is over the limit", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DANDIYA_STICKS", 21)] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "QUANTITY_LIMIT", path: "extras[0].quantity" }),
    ]);
    expect(q.lines.map((l) => l.productCode)).not.toContain("DANDIYA_STICKS");
  });

  it("is not tied to a day", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DANDIYA_STICKS", 1, "2026-12-12")] });
    expect(issueCodes(q)).toEqual(["DAYS_NOT_ALLOWED"]);
  });

  it("is not limited by how many people are coming", () => {
    const q = quote({ attendees: [adultDayPass()], extras: [extra("DANDIYA_STICKS", 6)] });
    expect(q.issues).toEqual([]);
  });
});

describe("quantities", () => {
  it.each([0, -1, 1.5, Number.NaN])("refuses quantity %s", (quantity) => {
    const q = quote({
      attendees: onTwelfth,
      extras: [extra("DINNER_PLATE", quantity, "2026-12-12")],
    });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "INVALID_QUANTITY", path: "extras[0].quantity" }),
    ]);
  });

  it("refuses the same extra listed twice for the same day", () => {
    const q = quote({
      attendees: onTwelfth,
      extras: [extra("DINNER_PLATE", 1, "2026-12-12"), extra("DINNER_PLATE", 1, "2026-12-12")],
    });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "DUPLICATE_EXTRA", path: "extras[1]" }),
    ]);
  });

  it("refuses an unknown extra", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("FREE_SAREE", 1)] });
    expect(issueCodes(q)).toEqual(["UNKNOWN_PRODUCT"]);
  });

  it("refuses a ticket listed as an extra", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DAY_PASS_ADULT", 1, "2026-12-12")] });
    expect(issueCodes(q)).toEqual(["WRONG_PRODUCT_KIND"]);
  });
});

describe("Dinner Plate (per person, per day)", () => {
  it("needs a day", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DINNER_PLATE", 1)] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "DAYS_REQUIRED", path: "extras[0].day" }),
    ]);
  });

  it("one plate per ticketed person attending that day", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DINNER_PLATE", 2, "2026-12-12")] });
    expect(q.issues).toEqual([]);
    expect(lineSummary(q)).toContain("DINNER_PLATE@2026-12-12 x2 = 2400");
  });

  it("no more plates than ticketed people that day", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DINNER_PLATE", 3, "2026-12-12")] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "EXCEEDS_DAILY_HEADCOUNT", path: "extras[0].quantity" }),
    ]);
    expect(q.issues[0]?.message).toBe(
      "2 people in your group have a ticket for 12 Dec, so you can add up to 2 Dinner Plate for that day.",
    );
  });

  it("under-5s don't count towards the plates", () => {
    const q = quote({
      attendees: [...onTwelfth, infant(2)],
      extras: [extra("DINNER_PLATE", 3, "2026-12-12")],
    });
    expect(issueCodes(q)).toEqual(["EXCEEDS_DAILY_HEADCOUNT"]);
  });

  it("no plates on a day nobody has a ticket for", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("DINNER_PLATE", 1, "2026-12-13")] });
    expect(q.issues[0]?.message).toBe(
      "Nobody in your group has a ticket for 13 Dec, so Dinner Plate can't be added for that day.",
    );
  });

  it("counts all-day pass holders on every day", () => {
    const q = quote({
      attendees: [{ ageYears: 9, entry: { productCode: "ALL_DAY_PASS_CHILD", days: [] } }],
      extras: [extra("DINNER_PLATE", 1, "2026-12-10"), extra("DINNER_PLATE", 1, "2026-12-14")],
    });
    expect(q.issues).toEqual([]);
  });

  it("counts each Family Pass holder", () => {
    const family = [
      { ageYears: 40, entry: { productCode: "FAMILY_PASS", days: ["2026-12-12"] } },
      { ageYears: 38, entry: { productCode: "FAMILY_PASS", days: ["2026-12-12"] } },
      { ageYears: 9, entry: { productCode: "FAMILY_PASS", days: ["2026-12-12"] } },
      { ageYears: 6, entry: { productCode: "FAMILY_PASS", days: ["2026-12-12"] } },
    ];
    const q = quote({ attendees: family, extras: [extra("DINNER_PLATE", 4, "2026-12-12")] });
    expect(q.issues).toEqual([]);
  });

  it("can't be bought for a day that has passed", () => {
    const q = quote(
      {
        attendees: [adultDayPass(["2026-12-12"])],
        extras: [extra("DINNER_PLATE", 1, "2026-12-11")],
      },
      { now: DURING_FESTIVAL },
    );
    expect(issueCodes(q)).toEqual(["DAY_IN_PAST"]);
  });
});

describe("Garba Workshop (11 and 13 Dec only, per person attending that day)", () => {
  const onThirteenth = [adultDayPass(["2026-12-13"])];

  it("is available on 13 Dec for someone attending that day", () => {
    const q = quote({
      attendees: onThirteenth,
      extras: [extra("GARBA_WORKSHOP", 1, "2026-12-13")],
    });
    expect(q.issues).toEqual([]);
    expect(q.totalCents).toBe(1_500 + 2_000);
  });

  it("is not available on 12 Dec", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("GARBA_WORKSHOP", 1, "2026-12-12")] });
    expect(q.issues).toEqual([
      expect.objectContaining({
        code: "DAY_NOT_AVAILABLE",
        path: "extras[0].day",
        message: "Garba Workshop is only available on 11 Dec and 13 Dec.",
      }),
    ]);
  });

  it("can't be bought for 13 Dec without an entry ticket for 13 Dec", () => {
    const q = quote({ attendees: onTwelfth, extras: [extra("GARBA_WORKSHOP", 1, "2026-12-13")] });
    expect(issueCodes(q)).toEqual(["EXCEEDS_DAILY_HEADCOUNT"]);
  });

  it("a toddler doesn't take a workshop place", () => {
    const q = quote({
      attendees: [...onThirteenth, infant(3)],
      extras: [extra("GARBA_WORKSHOP", 2, "2026-12-13")],
    });
    expect(issueCodes(q)).toEqual(["EXCEEDS_DAILY_HEADCOUNT"]);
  });
});
