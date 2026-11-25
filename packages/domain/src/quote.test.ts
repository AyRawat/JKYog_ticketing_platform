import { describe, expect, it } from "vitest";
import {
  adultDayPass,
  BEFORE_FESTIVAL,
  childDayPass,
  extra,
  infant,
  issueCodes,
  makeCart,
  makeCatalog,
  person,
  quote,
} from "./test/fixtures";
import { quoteCart } from "./quote";

describe("who is coming", () => {
  it("needs at least one person", () => {
    const q = quote({ attendees: [] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "NO_ATTENDEES", path: "attendees" }),
    ]);
    expect(q.canBook).toBe(false);
  });

  it("can't be only under-5s: someone has to hold a ticket", () => {
    const q = quote({ attendees: [infant(2), infant(4)] });
    expect(issueCodes(q)).toEqual(["NO_TICKETED_ATTENDEE"]);
    expect(q.canBook).toBe(false);
  });

  it("a child-only booking is fine (no supervision rule)", () => {
    const q = quote({ attendees: [childDayPass(), childDayPass()] });
    expect(q.issues).toEqual([]);
    expect(q.canBook).toBe(true);
  });
});

describe("a running total while the form is being filled", () => {
  it("prices the valid parts and reports the rest", () => {
    const q = quote({
      attendees: [adultDayPass(), person(7, "DAY_PASS_ADULT", ["2026-12-12"])],
    });
    expect(q.totalCents).toBe(1_500);
    expect(issueCodes(q)).toEqual(["AGE_TICKET_MISMATCH"]);
    expect(q.canBook).toBe(false);
  });

  it("reports several problems at once, each at its own path", () => {
    const q = quote({
      booker: { ageYears: 16 },
      attendees: [person(30, "DAY_PASS_CHILD", ["2026-12-12"]), adultDayPass([])],
      extras: [extra("DANDIYA_STICKS", 25)],
    });
    expect(q.issues.map((i) => `${i.code} @ ${i.path}`)).toEqual([
      "BOOKER_TOO_YOUNG @ booker.ageYears",
      "AGE_TICKET_MISMATCH @ attendees[0].entry.productCode",
      "DAYS_REQUIRED @ attendees[1].entry.days",
      "QUANTITY_LIMIT @ extras[0].quantity",
    ]);
  });
});

describe("the price comes only from the server's catalog", () => {
  it("is the same for the same cart, catalog and clock", () => {
    const catalog = makeCatalog();
    const cart = makeCart({ attendees: [adultDayPass(), childDayPass()], promoCode: "SEVA10" });
    const first = quoteCart({ catalog, cart, now: BEFORE_FESTIVAL });
    const second = quoteCart({ catalog, cart, now: BEFORE_FESTIVAL });
    expect(second).toEqual(first);
  });

  it("changes when the catalog price changes, whatever the cart says", () => {
    const base = makeCatalog();
    const repriced = {
      ...base,
      products: base.products.map((p) =>
        p.code === "DAY_PASS_ADULT" ? { ...p, unitPriceCents: 1_700 } : p,
      ),
    };
    expect(quote({ attendees: [adultDayPass()] }, { catalog: repriced }).totalCents).toBe(1_700);
  });

  it("doesn't depend on product names: renaming a ticket changes nothing but the label", () => {
    const base = makeCatalog();
    const renamed = {
      ...base,
      products: base.products.map((p) => ({ ...p, name: `Renamed ${p.code}` })),
    };
    const cart = { attendees: [adultDayPass(), childDayPass()], promoCode: "KIDSFREE" };
    const before = quote(cart, { catalog: base });
    const after = quote(cart, { catalog: renamed });
    expect(after.totalCents).toBe(before.totalCents);
    expect(after.lines.map((l) => l.productName)).toEqual([
      "Renamed DAY_PASS_ADULT",
      "Renamed DAY_PASS_CHILD",
    ]);
  });
});
