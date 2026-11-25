import { quoteCart, type Quote } from "../quote";
import type { Cart, CartAttendee, CartExtra, Catalog, Product, Promo } from "../types";

/** Mirrors packages/db/seeds/sharad-utsav-2026.sql. */
export const FESTIVAL_DAYS = [
  "2026-12-10",
  "2026-12-11",
  "2026-12-12",
  "2026-12-13",
  "2026-12-14",
] as const;
export const GARBA_DAYS = ["2026-12-11", "2026-12-13"] as const;

/** Before the festival, when every day is still bookable (noon in Allen, Texas). */
export const BEFORE_FESTIVAL = new Date("2026-11-25T18:00:00Z");
/** Midway through: 12 Dec, noon local time. */
export const DURING_FESTIVAL = new Date("2026-12-12T18:00:00Z");

const allDays = [...FESTIVAL_DAYS];

const PRODUCTS: readonly Product[] = [
  entryProduct("DAY_PASS_ADULT", "Day Pass – Adult", "per_day", 1500, 1, 0, 380),
  entryProduct("DAY_PASS_CHILD", "Day Pass – Child", "per_day", 800, 0, 1, 260),
  entryProduct("ALL_DAY_PASS_ADULT", "All-Day Pass – Adult", "whole_event", 6000, 1, 0, 0),
  entryProduct("ALL_DAY_PASS_CHILD", "All-Day Pass – Child", "whole_event", 3000, 0, 1, 140),
  entryProduct("FAMILY_PASS", "Family Pass", "per_day", 4000, 2, 2, 95),
  extraProduct("DANDIYA_STICKS", "Dandiya Sticks (pair)", "whole_event", 500, 900, [], 20, false),
  extraProduct("DINNER_PLATE", "Dinner Plate", "per_day", 1200, 1700, allDays, null, true),
  extraProduct("GARBA_WORKSHOP", "Garba Workshop", "per_day", 2000, 2, [...GARBA_DAYS], null, true),
];

const PROMOS: readonly Promo[] = [
  promo("SEVA10", { type: "percent_off_total", percentBps: 1000 }),
  promo("FLAT20", { type: "amount_off_total", amountCents: 2000 }),
  promo("KIDSFREE", { type: "child_entry_free" }),
  promo(
    "EXPIRED5",
    { type: "amount_off_total", amountCents: 500 },
    {
      validFrom: new Date("2026-10-01T00:00:00-05:00"), // CDT
      validUntil: new Date("2026-11-30T23:59:59.999-06:00"), // end of 30 Nov, CST
    },
  ),
  promo(
    "MAXEDOUT",
    { type: "percent_off_total", percentBps: 1500 },
    { maxRedemptions: 50, timesRedeemed: 50 },
  ),
];

export function makeCatalog(
  overrides: { remaining?: Record<string, number>; promos?: readonly Promo[] } = {},
): Catalog {
  return {
    event: {
      slug: "sharad-utsav-2026",
      timezone: "America/Chicago",
      days: allDays,
      ageRules: { referenceDate: "2026-12-10", childMinAge: 5, adultMinAge: 12, bookerMinAge: 18 },
    },
    products: PRODUCTS.map((product) => ({
      ...product,
      remaining: overrides.remaining?.[product.code] ?? product.remaining,
    })),
    promos: overrides.promos ?? PROMOS,
  };
}

export function promo(
  code: string,
  discount: Promo["discount"],
  overrides: Partial<Promo> = {},
): Promo {
  return {
    code,
    discount,
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    timesRedeemed: 0,
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cart builders
// ---------------------------------------------------------------------------

export const person = (
  ageYears: number,
  productCode: string | null,
  days: readonly string[] = [],
): CartAttendee => ({ ageYears, entry: productCode ? { productCode, days } : null });

export const adultDayPass = (days: readonly string[] = ["2026-12-12"], ageYears = 35) =>
  person(ageYears, "DAY_PASS_ADULT", days);
export const childDayPass = (days: readonly string[] = ["2026-12-12"], ageYears = 8) =>
  person(ageYears, "DAY_PASS_CHILD", days);
export const familyAdult = (days: readonly string[] = ["2026-12-12"], ageYears = 38) =>
  person(ageYears, "FAMILY_PASS", days);
export const familyChild = (days: readonly string[] = ["2026-12-12"], ageYears = 9) =>
  person(ageYears, "FAMILY_PASS", days);
export const infant = (ageYears = 2) => person(ageYears, null);

export const extra = (
  productCode: string,
  quantity: number,
  day: string | null = null,
): CartExtra => ({
  productCode,
  quantity,
  day,
});

export function makeCart(partial: Partial<Cart> = {}): Cart {
  return { booker: { ageYears: 40 }, attendees: [], extras: [], promoCode: null, ...partial };
}

export function quote(
  partial: Partial<Cart>,
  options: { now?: Date; catalog?: Catalog } = {},
): Quote {
  return quoteCart({
    catalog: options.catalog ?? makeCatalog(),
    cart: makeCart(partial),
    now: options.now ?? BEFORE_FESTIVAL,
  });
}

export const issueCodes = (q: Quote) => q.issues.map((i) => i.code);

/** Lines as compact strings, e.g. "FAMILY_PASS@2026-12-12 x1 = 4000". */
export const lineSummary = (q: Quote) =>
  q.lines.map((l) => `${l.productCode}@${l.day ?? "all"} x${l.quantity} = ${l.lineTotalCents}`);

// ---------------------------------------------------------------------------

function entryProduct(
  code: string,
  name: string,
  dayScope: Product["dayScope"],
  unitPriceCents: number,
  adults: number,
  children: number,
  remaining: number,
): Product {
  return {
    kind: "entry",
    code,
    name,
    dayScope,
    unitPriceCents,
    availableDays: allDays,
    remaining,
    admits: { adults, children },
  };
}

function extraProduct(
  code: string,
  name: string,
  dayScope: Product["dayScope"],
  unitPriceCents: number,
  remaining: number,
  availableDays: string[],
  maxPerBooking: number | null,
  cappedByDailyHeadcount: boolean,
): Product {
  return {
    kind: "extra",
    code,
    name,
    dayScope,
    unitPriceCents,
    availableDays,
    remaining,
    maxPerBooking,
    cappedByDailyHeadcount,
  };
}
