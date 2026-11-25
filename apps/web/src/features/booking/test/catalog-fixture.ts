import { CatalogResponse } from "@ticketing/contracts";

const DAYS = ["2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13", "2026-12-14"];
const GARBA_DAYS = ["2026-12-11", "2026-12-13"];
const ADULT = { adults: 1, children: 0 };
const CHILD = { adults: 0, children: 1 };

/** The seeded catalog as GET /api/events/sharad-utsav-2026/catalog returns it. */
export const catalog: CatalogResponse = CatalogResponse.parse({
  event: {
    slug: "sharad-utsav-2026",
    name: "Sharad Utsav 2026",
    venue: "Radha Krishna Temple, Allen, Texas",
    timezone: "America/Chicago",
    currency: "USD",
    holdMinutes: 15,
    days: DAYS.map((date) => ({ date, bookable: true })),
    ageRules: { referenceDate: "2026-12-10", childMinAge: 5, adultMinAge: 12, bookerMinAge: 18 },
  },
  products: [
    entry("DAY_PASS_ADULT", "Day Pass – Adult", "per_day", 1500, ADULT),
    entry("DAY_PASS_CHILD", "Day Pass – Child", "per_day", 800, CHILD),
    entry("ALL_DAY_PASS_ADULT", "All-Day Pass – Adult", "whole_event", 6000, ADULT, "sold_out"),
    entry("ALL_DAY_PASS_CHILD", "All-Day Pass – Child", "whole_event", 3000, CHILD),
    entry("FAMILY_PASS", "Family Pass", "per_day", 4000, { adults: 2, children: 2 }),
    extra("DANDIYA_STICKS", "Dandiya Sticks (pair)", "whole_event", 500, DAYS, 20, false),
    extra("DINNER_PLATE", "Dinner Plate", "per_day", 1200, DAYS, null, true),
    extra("GARBA_WORKSHOP", "Garba Workshop", "per_day", 2000, GARBA_DAYS, null, true),
  ],
});

function entry(
  code: string,
  name: string,
  dayScope: "per_day" | "whole_event",
  unitPriceCents: number,
  admits: { adults: number; children: number },
  availability = "on_sale",
) {
  return {
    kind: "entry",
    code,
    name,
    dayScope,
    unitPriceCents,
    availableDays: DAYS,
    availability,
    admits,
  };
}

function extra(
  code: string,
  name: string,
  dayScope: "per_day" | "whole_event",
  unitPriceCents: number,
  availableDays: string[],
  maxPerBooking: number | null,
  cappedByDailyHeadcount: boolean,
) {
  return {
    kind: "extra",
    code,
    name,
    dayScope,
    unitPriceCents,
    availableDays,
    availability: "on_sale",
    maxPerBooking,
    cappedByDailyHeadcount,
  };
}
