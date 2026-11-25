import { describe, expect, it } from "vitest";
import {
  adultDayPass,
  childDayPass,
  extra,
  familyAdult,
  familyChild,
  infant,
  lineSummary,
  person,
  quote,
} from "./test/fixtures";
import type { Quote } from "./quote";

const totals = (q: Quote) => ({
  subtotal: q.subtotalCents,
  discount: q.discountCents,
  total: q.totalCents,
});

const familyOf4 = [familyAdult(), familyAdult(), familyChild(), familyChild()];

describe("subtotal and total, always in integer cents", () => {
  it("the design note example: family of 6 with extras and SEVA10 = $144.00", () => {
    const q = quote({
      attendees: [...familyOf4, adultDayPass(["2026-12-12", "2026-12-13"], 68), infant(2)],
      extras: [
        extra("DINNER_PLATE", 5, "2026-12-12"),
        extra("GARBA_WORKSHOP", 1, "2026-12-13"),
        extra("DANDIYA_STICKS", 2),
      ],
      promoCode: "SEVA10",
    });
    expect(q.issues).toEqual([]);
    expect(lineSummary(q)).toEqual([
      "DAY_PASS_ADULT@2026-12-12 x1 = 1500",
      "DAY_PASS_ADULT@2026-12-13 x1 = 1500",
      "FAMILY_PASS@2026-12-12 x1 = 4000",
      "DANDIYA_STICKS@all x2 = 1000",
      "DINNER_PLATE@2026-12-12 x5 = 6000",
      "GARBA_WORKSHOP@2026-12-13 x1 = 2000",
    ]);
    expect(totals(q)).toEqual({ subtotal: 16_000, discount: 1_600, total: 14_400 });
    expect(q.canBook).toBe(true);
  });

  it("every line is unit price x quantity, and the subtotal is their sum", () => {
    const q = quote({
      attendees: [adultDayPass(["2026-12-10", "2026-12-11"]), childDayPass(["2026-12-10"])],
      extras: [extra("DANDIYA_STICKS", 3)],
    });
    for (const line of q.lines) {
      expect(line.lineTotalCents).toBe(line.unitPriceCents * line.quantity);
    }
    expect(totals(q)).toEqual({ subtotal: 1_500 * 2 + 800 + 500 * 3, discount: 0, total: 5_300 });
  });

  it("never produces fractional cents", () => {
    const q = quote({
      attendees: [adultDayPass(["2026-12-10", "2026-12-11", "2026-12-12"])],
      extras: [extra("DINNER_PLATE", 1, "2026-12-10")],
      promoCode: "SEVA10",
    });
    // 4500 + 1200 = 5700 -> 10% = 570
    expect(totals(q)).toEqual({ subtotal: 5_700, discount: 570, total: 5_130 });
    expect([q.subtotalCents, q.discountCents, q.totalCents].every(Number.isInteger)).toBe(true);
  });
});

describe("SEVA10: 10% off the whole booking", () => {
  it("includes extras", () => {
    const q = quote({
      attendees: [adultDayPass()],
      extras: [extra("DINNER_PLATE", 1, "2026-12-12")],
      promoCode: "SEVA10",
    });
    expect(totals(q)).toEqual({ subtotal: 2_700, discount: 270, total: 2_430 });
  });

  it("applies to Family Pass pricing too", () => {
    const q = quote({ attendees: familyOf4, promoCode: "SEVA10" });
    expect(totals(q)).toEqual({ subtotal: 4_000, discount: 400, total: 3_600 });
  });
});

describe("FLAT20: $20 off the whole booking, never below zero", () => {
  it("takes $20 off", () => {
    const q = quote({ attendees: familyOf4, promoCode: "FLAT20" });
    expect(totals(q)).toEqual({ subtotal: 4_000, discount: 2_000, total: 2_000 });
  });

  it("on a $15 booking the total stops at $0", () => {
    const q = quote({ attendees: [adultDayPass()], promoCode: "FLAT20" });
    expect(totals(q)).toEqual({ subtotal: 1_500, discount: 1_500, total: 0 });
    expect(q.canBook).toBe(true);
  });

  it("on exactly $20 the total is $0", () => {
    const q = quote({
      attendees: [childDayPass(["2026-12-10", "2026-12-11"])],
      extras: [],
      promoCode: "FLAT20",
    });
    expect(q.subtotalCents).toBe(1_600);
    expect(q.totalCents).toBe(0);
  });
});

describe("KIDSFREE: child-only entry tickets are free", () => {
  it("the brief's example: Family Pass + 3 Child Day + 1 Adult Day = $79 -> $55", () => {
    const q = quote({
      attendees: [...familyOf4, childDayPass(), childDayPass(), childDayPass(), adultDayPass()],
      promoCode: "KIDSFREE",
    });
    expect(totals(q)).toEqual({ subtotal: 7_900, discount: 2_400, total: 5_500 });
  });

  it("makes All-Day Child passes free, the full $30 each", () => {
    const q = quote({
      attendees: [
        person(8, "ALL_DAY_PASS_CHILD"),
        person(10, "ALL_DAY_PASS_CHILD"),
        adultDayPass(),
      ],
      promoCode: "KIDSFREE",
    });
    expect(totals(q)).toEqual({ subtotal: 7_500, discount: 6_000, total: 1_500 });
  });

  it("does not discount the Family Pass", () => {
    const q = quote({ attendees: familyOf4, promoCode: "KIDSFREE" });
    expect(q.discountCents).toBe(0);
    expect(q.promo).toMatchObject({ status: "rejected", reason: "PROMO_NOT_APPLICABLE" });
    expect(q.canBook).toBe(false);
  });

  it("does not discount extras", () => {
    const q = quote({
      attendees: [childDayPass()],
      extras: [extra("DINNER_PLATE", 1, "2026-12-12")],
      promoCode: "KIDSFREE",
    });
    expect(totals(q)).toEqual({ subtotal: 2_000, discount: 800, total: 1_200 });
  });

  it("with no child tickets it doesn't apply", () => {
    const q = quote({ attendees: [adultDayPass()], promoCode: "KIDSFREE" });
    expect(q.promo).toEqual({
      status: "rejected",
      code: "KIDSFREE",
      reason: "PROMO_NOT_APPLICABLE",
      message: "This code makes child tickets free, but there are none in this booking.",
    });
    expect(totals(q)).toEqual({ subtotal: 1_500, discount: 0, total: 1_500 });
  });

  it("a child-only booking can come to $0", () => {
    const q = quote({ attendees: [childDayPass(), childDayPass()], promoCode: "KIDSFREE" });
    expect(q.totalCents).toBe(0);
    expect(q.canBook).toBe(true);
  });
});
