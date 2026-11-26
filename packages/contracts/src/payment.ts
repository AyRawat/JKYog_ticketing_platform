import { z } from "zod";
import { Cents } from "./common";
import { BookingId } from "./booking";

// POST /api/bookings/:id/payment
//
// Starts (or picks up again) the card payment for a booking that is holding its tickets. The
// amount is the booking's stored total, never anything the browser sends, so the body is empty.
// Calling it again for the same booking returns the same payment, so a refresh or a declined
// card retries without charging twice.

/** No fields: the booking id in the path says everything. Sent as JSON so the API stays
 *  unreachable from a cross-site form. */
export const PaymentRequest = z.strictObject({});

export const PaymentResponse = z.object({
  bookingId: BookingId,
  /** For Stripe's Payment Element. It can only confirm this one payment. */
  clientSecret: z.string().min(1),
  amountCents: Cents,
  currency: z.string().length(3),
  /** Pay before this time, or the tickets go back on sale. */
  holdExpiresAt: z.iso.datetime(),
});
export type PaymentResponse = z.infer<typeof PaymentResponse>;
