import { describe, expect, it } from "vitest";
import { catalog } from "../test/catalog-fixture";
import { daysFor, entryForAge, findEntryProduct } from "./ticket-for-age";

const twoDays = ["2026-12-11", "2026-12-12"];
const adultDay = { productCode: "DAY_PASS_ADULT", days: twoDays };
const childDay = { productCode: "DAY_PASS_CHILD", days: twoDays };
const childAllDay = { productCode: "ALL_DAY_PASS_CHILD", days: [] };
const family = { productCode: "FAMILY_PASS", days: ["2026-12-12"] };

describe("entryForAge", () => {
  it("keeps a ticket that still fits", () => {
    expect(entryForAge(adultDay, 40, catalog)).toBe(adultDay);
    expect(entryForAge(childDay, 5, catalog)).toBe(childDay);
  });

  it("swaps to the same kind of pass for the new band, keeping the days", () => {
    expect(entryForAge(adultDay, 7, catalog)).toEqual(childDay);
    expect(entryForAge(childDay, 12, catalog)).toEqual(adultDay);
  });

  it("clears a whole-event pass when the counterpart is sold out", () => {
    // ALL_DAY_PASS_ADULT is sold out, so a child pass can't become one.
    expect(entryForAge(childAllDay, 30, catalog)).toBeNull();
  });

  it("keeps a Family Pass for adults and children alike", () => {
    expect(entryForAge(family, 40, catalog)).toBe(family);
    expect(entryForAge(family, 8, catalog)).toBe(family);
  });

  it("removes the ticket below the free age", () => {
    expect(entryForAge(childDay, 4, catalog)).toBeNull();
    expect(entryForAge(family, 0, catalog)).toBeNull();
  });

  it("leaves an unchosen ticket unchosen", () => {
    expect(entryForAge(null, 30, catalog)).toBeNull();
  });

  it.each([null, -1, 121])("changes nothing for an age that isn't valid (%s)", (age) => {
    expect(entryForAge(adultDay, age, catalog)).toBe(adultDay);
  });

  it("uses the event's age thresholds, not fixed numbers", () => {
    const olderAdults = {
      ...catalog,
      event: { ...catalog.event, ageRules: { ...catalog.event.ageRules, adultMinAge: 14 } },
    };
    expect(entryForAge(adultDay, 13, olderAdults)).toEqual(childDay);
  });
});

describe("daysFor", () => {
  it("drops every day for a whole-event pass", () => {
    const product = findEntryProduct(catalog, "ALL_DAY_PASS_CHILD");
    expect(product && daysFor(product, twoDays)).toEqual([]);
  });

  it("keeps only the days the ticket is sold for", () => {
    const product = findEntryProduct(catalog, "DAY_PASS_ADULT");
    expect(product && daysFor(product, ["2026-12-12", "2026-12-20"])).toEqual(["2026-12-12"]);
  });
});
