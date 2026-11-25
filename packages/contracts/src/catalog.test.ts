import { describe, expect, it } from "vitest";
import { CatalogResponse, type CatalogResponse as CatalogResponseType } from "./catalog";
import { ErrorResponse, EventSlug } from "./common";

const valid: CatalogResponseType = {
  event: {
    slug: "sharad-utsav-2026",
    name: "Sharad Utsav 2026",
    venue: "Radha Krishna Temple, Allen, Texas",
    timezone: "America/Chicago",
    currency: "USD",
    holdMinutes: 15,
    days: [{ date: "2026-12-10", bookable: true }],
    ageRules: { referenceDate: "2026-12-10", childMinAge: 5, adultMinAge: 12, bookerMinAge: 18 },
  },
  products: [
    {
      code: "FAMILY_PASS",
      name: "Family Pass",
      kind: "entry",
      dayScope: "per_day",
      unitPriceCents: 4000,
      availableDays: ["2026-12-10"],
      availability: "on_sale",
      admits: { adults: 2, children: 2 },
    },
    {
      code: "DANDIYA_STICKS",
      name: "Dandiya Sticks (pair)",
      kind: "extra",
      dayScope: "whole_event",
      unitPriceCents: 500,
      availableDays: [],
      availability: "on_sale",
      maxPerBooking: 20,
      cappedByDailyHeadcount: false,
    },
  ],
};

describe("CatalogResponse", () => {
  it("accepts a well-formed catalog", () => {
    expect(CatalogResponse.parse(valid)).toEqual(valid);
  });

  it("drops anything not in the contract, so internal fields can't leak", () => {
    const [entry, extraProduct] = valid.products;
    const leaky = {
      ...valid,
      promos: [{ code: "SEVA10" }],
      event: { ...valid.event, id: "uuid", ageReferenceDate: "2026-12-10" },
      products: [
        { ...entry, id: "uuid", remaining: 95, isActive: true },
        { ...extraProduct, remaining: 900 },
      ],
    };
    expect(CatalogResponse.parse(leaky)).toEqual(valid);
  });

  it.each([
    ["a fractional price", { unitPriceCents: 40.5 }],
    ["a negative price", { unitPriceCents: -1 }],
    ["a price sent as a string", { unitPriceCents: "40.00" }],
    ["a timestamp instead of a date", { availableDays: ["2026-12-10T00:00:00Z"] }],
    ["an unknown availability", { availability: "maybe" }],
    ["an entry product without `admits`", { admits: undefined }],
  ])("rejects %s", (_, change) => {
    const [entry] = valid.products;
    const broken = { ...valid, products: [{ ...entry, ...change }] };
    expect(CatalogResponse.safeParse(broken).success).toBe(false);
  });
});

describe("EventSlug", () => {
  it.each(["sharad-utsav-2026", "a", "event-1"])("accepts %j", (slug) => {
    expect(EventSlug.safeParse(slug).success).toBe(true);
  });

  it.each([
    "",
    "Sharad-Utsav",
    "sharad_utsav",
    "-leading",
    "trailing-",
    "double--hyphen",
    "../etc/passwd",
    "a".repeat(65),
  ])("rejects %j", (slug) => {
    expect(EventSlug.safeParse(slug).success).toBe(false);
  });
});

describe("ErrorResponse", () => {
  it("accepts a known code with a message", () => {
    const body = { error: { code: "EVENT_NOT_FOUND", message: "No such event." } };
    expect(ErrorResponse.parse(body)).toEqual(body);
  });

  it("rejects a code that isn't in the list", () => {
    expect(ErrorResponse.safeParse({ error: { code: "OOPS", message: "x" } }).success).toBe(false);
  });
});
