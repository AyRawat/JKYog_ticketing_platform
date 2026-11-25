import { z } from "zod";
import { Cents, IsoDate } from "./common";
import { AgeYears, CartEntry, CartExtras, PromoCodeInput, QUOTE_LIMITS, QuoteLine } from "./quote";

// POST /api/events/:slug/bookings
//
// Turns a cart into a booking that holds its tickets while the family pays. The server prices
// the cart again from live data and charges only that price; `expectedTotalCents` is what the
// family saw, so a total that has changed since is refused rather than charged.
//
// Header `Idempotency-Key: <uuid>`: generated once per checkout by the client. Sending the same
// request again with the same key returns the same booking instead of making a second one.

/** Sent in the `Idempotency-Key` header. */
export const IdempotencyKey = z.uuid({ error: "Send a UUID in the Idempotency-Key header." });

/** Printable text only: no control characters, so names are safe in emails, PDFs and logs. */
export const PersonName = z
  .string()
  .trim()
  .min(1, { error: "Please enter a name." })
  .max(100, { error: "Please keep names under 100 characters." })
  .regex(/^[^\p{Cc}]*$/u, { error: "Please use letters, spaces and punctuation only." });

export const Email = z
  .email({ error: "Please enter a valid email address." })
  .max(254, { error: "Please enter a valid email address." });

/** Digits with optional +, spaces, dots, dashes and brackets; 7 to 15 digits. */
export const Phone = z
  .string()
  .trim()
  .refine((value) => /^\+?[0-9 ().-]{7,24}$/.test(value) && /^(\D*\d){7,15}\D*$/.test(value), {
    error: "Please enter a valid phone number.",
  });

export const BookingRequest = z.strictObject({
  /** The person paying, and who we contact. They don't have to be attending. */
  booker: z.strictObject({
    fullName: PersonName,
    email: Email,
    phone: Phone,
    ageYears: AgeYears,
  }),
  /** Everyone coming, including children under the free age. */
  attendees: z
    .array(
      z.strictObject({
        fullName: PersonName,
        ageYears: AgeYears,
        /** Optional, adults only. */
        phone: Phone.nullable().default(null),
        entry: CartEntry,
      }),
    )
    .max(QUOTE_LIMITS.attendees),
  extras: CartExtras,
  promoCode: PromoCodeInput,
  /** The total the family was shown. The booking is refused if the price is now different. */
  expectedTotalCents: Cents,
});
export type BookingRequestInput = z.input<typeof BookingRequest>;
export type BookingRequest = z.output<typeof BookingRequest>;

export const BookingStatus = z.enum(["pending_payment", "confirmed", "expired", "cancelled"]);

/** A booking as the family sees it. Contact details are not echoed back. */
export const BookingResponse = z.object({
  /** Unguessable; the confirmation page's address. */
  id: z.uuid(),
  /** Short code read out at the door, e.g. "SU26-7K3QX". */
  reference: z.string(),
  status: BookingStatus,
  /** Until then the tickets are held for this booking; unpaid after that, they are released. */
  holdExpiresAt: z.iso.datetime(),
  currency: z.string().length(3),
  lines: z.array(QuoteLine),
  subtotalCents: Cents,
  discountCents: Cents,
  totalCents: Cents,
  promoCode: z.string().nullable(),
  /** Everyone coming, in form order, with their ticket (null for under-5s) and admitted days. */
  attendees: z.array(
    z.object({
      fullName: z.string(),
      ageYears: AgeYears,
      productCode: z.string().nullable(),
      days: z.array(IsoDate),
    }),
  ),
});
export type BookingResponse = z.infer<typeof BookingResponse>;
