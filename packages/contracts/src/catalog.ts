import { z } from "zod";
import { Cents, EventSlug, IsoDate } from "./common";

// GET /api/events/:slug/catalog
//
// Everything the booking form needs to render: the festival, its age rules, and what can be
// bought. Prices here are for display; the quote and booking endpoints always re-price on the
// server. Promo codes are never listed.
//
// The server parses its own response through these schemas before sending it, and z.object
// drops any key not declared here, so internal fields (ids, stock counts, promo data) cannot
// leak even if a query starts returning them.

const Count = z.number().int().nonnegative();

export const Availability = z.enum(["on_sale", "sold_out", "sale_closed"]);
export type Availability = z.infer<typeof Availability>;

const productBase = {
  /** Stable key used in requests. */
  code: z.string(),
  /** Display label; may change at any time. */
  name: z.string(),
  /** `per_day` products are bought for chosen days; `whole_event` products are not. */
  dayScope: z.enum(["per_day", "whole_event"]),
  unitPriceCents: Cents,
  /** The days a per-day product can be chosen for. Whole-event passes list every day. */
  availableDays: z.array(IsoDate),
  availability: Availability,
};

export const CatalogEntryProduct = z.object({
  ...productBase,
  kind: z.literal("entry"),
  /** One unit admits this many adults and children (Family Pass: 2 and 2). */
  admits: z.object({ adults: Count, children: Count }),
});

export const CatalogExtraProduct = z.object({
  ...productBase,
  kind: z.literal("extra"),
  /** Most units one booking may hold, or null for no fixed limit. */
  maxPerBooking: z.number().int().positive().nullable(),
  /** Bought per person per day: no more than the ticketed people coming that day. */
  cappedByDailyHeadcount: z.boolean(),
});

export const CatalogProduct = z.discriminatedUnion("kind", [
  CatalogEntryProduct,
  CatalogExtraProduct,
]);
export type CatalogProduct = z.infer<typeof CatalogProduct>;

export const CatalogResponse = z.object({
  event: z.object({
    slug: EventSlug,
    name: z.string(),
    venue: z.string(),
    /** IANA timezone; every date in the catalog is a calendar date in this zone. */
    timezone: z.string(),
    currency: z.string().length(3),
    /** How long an unpaid booking holds its tickets. */
    holdMinutes: z.number().int().positive(),
    /** False once the day has passed in the event's timezone. */
    days: z.array(z.object({ date: IsoDate, bookable: z.boolean() })),
    ageRules: z.object({
      /** Ages are whole years on this date. */
      referenceDate: IsoDate,
      /** Below this age: no ticket needed. */
      childMinAge: Count,
      /** From this age: adult ticket. */
      adultMinAge: Count,
      /** The person booking must be at least this old. */
      bookerMinAge: Count,
    }),
  }),
  /** In display order. */
  products: z.array(CatalogProduct),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;
