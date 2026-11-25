import { ISSUE_CODES, NOTICE_CODES, PROMO_REJECTIONS } from "@ticketing/domain";
import { z } from "zod";
import { Cents, IsoDate } from "./common";

// POST /api/events/:slug/quote
//
// The family's cart in, the server's price out. Called on every change to the form, so it is
// side-effect free and fast.
//
// Two layers of checking, on purpose:
// - This schema checks the SHAPE: types, required fields, size limits, and no unknown fields
//   (a client-sent `price` is a 400). Breaking it means a broken client, not a family's mistake.
// - The booking rules check everything else (ages, ticket fit, days, limits, stock, promo) and
//   report it as `issues` in a 200, each pointing at the part of the form to fix.

/** Upper bounds that keep a request small. Far above any real family booking. */
export const QUOTE_LIMITS = {
  attendees: 50,
  extras: 50,
  daysPerEntry: 31,
  codeLength: 64,
  promoCodeLength: 32,
} as const;

const ProductCode = z.string().min(1).max(QUOTE_LIMITS.codeLength);

/** A whole number. Whether it is a sensible age or quantity is a booking rule, reported as an issue. */
const WholeNumber = z.int();

export const QuoteRequest = z.strictObject({
  /** The person paying. Optional while the form is being filled in; required to book. */
  booker: z.strictObject({ ageYears: WholeNumber }).nullable().default(null),
  /** Everyone coming, including children under the free age. */
  attendees: z
    .array(
      z.strictObject({
        /** Age in whole years on the event's age reference date. */
        ageYears: WholeNumber,
        /** The person's ticket, or null for a child under the free age. */
        entry: z
          .strictObject({
            productCode: ProductCode,
            /** Days for a per-day ticket; leave empty for a whole-event pass. */
            days: z.array(IsoDate).max(QUOTE_LIMITS.daysPerEntry).default([]),
          })
          .nullable(),
      }),
    )
    .max(QUOTE_LIMITS.attendees),
  extras: z
    .array(
      z.strictObject({
        productCode: ProductCode,
        /** The day for a per-day extra; null for a whole-event extra. */
        day: IsoDate.nullable().default(null),
        quantity: WholeNumber,
      }),
    )
    .max(QUOTE_LIMITS.extras)
    .default([]),
  promoCode: z.string().max(QUOTE_LIMITS.promoCodeLength).nullable().default(null),
});
/** What a client sends (defaults may be left out). */
export type QuoteRequestInput = z.input<typeof QuoteRequest>;
/** What the server works with (defaults filled in). */
export type QuoteRequest = z.output<typeof QuoteRequest>;

export const QuoteLine = z.object({
  productCode: z.string(),
  productName: z.string(),
  /** Null for whole-event products. */
  day: IsoDate.nullable(),
  quantity: z.int().positive(),
  unitPriceCents: Cents,
  lineTotalCents: Cents,
});

export const QuotePromo = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("applied"),
    code: z.string(),
    discountCents: Cents,
    message: z.string(),
  }),
  z.object({
    status: z.literal("rejected"),
    code: z.string(),
    reason: z.enum(PROMO_REJECTIONS),
    message: z.string(),
  }),
]);

export const QuoteIssue = z.object({
  code: z.enum(ISSUE_CODES),
  /** Where in the request the problem is, e.g. "attendees[1].entry.days". */
  path: z.string(),
  message: z.string(),
});

export const QuoteNotice = z.object({
  code: z.enum(NOTICE_CODES),
  path: z.string(),
  message: z.string(),
  savingsCents: Cents,
});

export const QuoteResponse = z.object({
  /** The bill, in catalog order. Parts of the cart with issues are left off. */
  lines: z.array(QuoteLine),
  subtotalCents: Cents,
  discountCents: Cents,
  totalCents: Cents,
  /** Null when no code was entered. */
  promo: QuotePromo.nullable(),
  /** Problems that block booking. */
  issues: z.array(QuoteIssue),
  /** Savings tips. Never block booking. */
  notices: z.array(QuoteNotice),
  /** True when this exact cart can be booked: no issues, a booker, and no rejected code. */
  canBook: z.boolean(),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;
