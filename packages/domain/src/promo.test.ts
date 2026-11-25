import { describe, expect, it } from "vitest";
import { promoValidityProblem } from "./promo";
import { adultDayPass, makeCatalog, promo, quote } from "./test/fixtures";

const attendees = [adultDayPass()];

describe("entering a code", () => {
  it.each(["SEVA10", "seva10", "Seva10", "  seva10  "])("%j matches SEVA10", (input) => {
    const q = quote({ attendees, promoCode: input });
    expect(q.promo).toMatchObject({ status: "applied", code: "SEVA10", discountCents: 150 });
  });

  it.each([null, "", "   "])("%j means no code", (input) => {
    const q = quote({ attendees, promoCode: input });
    expect(q.promo).toBeNull();
    expect(q.canBook).toBe(true);
  });

  it("an unknown code is refused, nothing is taken off, and the cart can't be booked with it", () => {
    const q = quote({ attendees, promoCode: "free100" });
    expect(q.promo).toEqual({
      status: "rejected",
      code: "FREE100",
      reason: "PROMO_NOT_FOUND",
      message: "We don't recognise that code. Please check the spelling.",
    });
    expect(q.totalCents).toBe(1_500);
    expect(q.canBook).toBe(false);
  });

  it("does not report a refused code as a cart issue (the form shows it by the code field)", () => {
    expect(quote({ attendees, promoCode: "NOPE" }).issues).toEqual([]);
  });
});

describe("EXPIRED5 (valid until the end of 30 Nov 2026, Allen time)", () => {
  it("still works on 25 Nov", () => {
    const q = quote(
      { attendees, promoCode: "EXPIRED5" },
      { now: new Date("2026-11-25T18:00:00Z") },
    );
    expect(q.promo).toMatchObject({ status: "applied", discountCents: 500 });
  });

  it("works up to the last second of 30 Nov", () => {
    const q = quote(
      { attendees, promoCode: "EXPIRED5" },
      { now: new Date("2026-12-01T05:59:59Z") },
    );
    expect(q.promo).toMatchObject({ status: "applied" });
  });

  it("is refused from 1 Dec, with the date it expired", () => {
    const q = quote(
      { attendees, promoCode: "EXPIRED5" },
      { now: new Date("2026-12-01T06:00:01Z") },
    );
    expect(q.promo).toEqual({
      status: "rejected",
      code: "EXPIRED5",
      reason: "PROMO_EXPIRED",
      message: "This code expired on 30 Nov.",
    });
    expect(q.discountCents).toBe(0);
  });
});

describe("MAXEDOUT (50 of 50 uses taken)", () => {
  it("is refused as exhausted", () => {
    const q = quote({ attendees, promoCode: "MAXEDOUT" });
    expect(q.promo).toMatchObject({
      status: "rejected",
      reason: "PROMO_EXHAUSTED",
      message: "This code has reached its usage limit.",
    });
  });

  it("works while uses remain", () => {
    const catalog = makeCatalog({
      promos: [
        promo(
          "MAXEDOUT",
          { type: "percent_off_total", percentBps: 1500 },
          { maxRedemptions: 50, timesRedeemed: 49 },
        ),
      ],
    });
    expect(quote({ attendees, promoCode: "MAXEDOUT" }, { catalog }).promo).toMatchObject({
      status: "applied",
      discountCents: 225,
    });
  });
});

describe("why a code can't be used (one distinct reason each)", () => {
  const now = new Date("2026-11-25T18:00:00Z");
  const base = promo("TEST", { type: "amount_off_total", amountCents: 100 });

  it.each([
    ["valid", base, null],
    ["switched off", { ...base, isActive: false }, "PROMO_INACTIVE"],
    [
      "not started",
      { ...base, validFrom: new Date("2026-12-01T00:00:00Z") },
      "PROMO_NOT_YET_VALID",
    ],
    ["ended", { ...base, validUntil: new Date("2026-11-01T00:00:00Z") }, "PROMO_EXPIRED"],
    ["used up", { ...base, maxRedemptions: 3, timesRedeemed: 3 }, "PROMO_EXHAUSTED"],
    ["no limit", { ...base, maxRedemptions: null, timesRedeemed: 10_000 }, null],
    [
      "switched off and ended: inactive wins",
      { ...base, isActive: false, validUntil: new Date("2026-11-01T00:00:00Z") },
      "PROMO_INACTIVE",
    ],
  ])("%s -> %s", (_, candidate, expected) => {
    expect(promoValidityProblem(candidate, now)).toBe(expected);
  });

  it("a code that hasn't started says when it can be used", () => {
    const catalog = makeCatalog({
      promos: [
        promo(
          "EARLY",
          { type: "amount_off_total", amountCents: 100 },
          { validFrom: new Date("2026-12-05T06:00:00Z") },
        ),
      ],
    });
    expect(quote({ attendees, promoCode: "EARLY" }, { catalog }).promo?.message).toBe(
      "This code can be used from 5 Dec.",
    );
  });
});
