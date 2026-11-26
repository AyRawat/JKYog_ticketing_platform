import "server-only";
import type { Database } from "@ticketing/db";
import { releaseExpiredHolds } from "../bookings/release-holds";
import type { PaymentGateway } from "./gateway";

export type StartPaymentResult =
  | {
      readonly kind: "ready";
      readonly bookingId: string;
      readonly clientSecret: string;
      readonly amountCents: number;
      readonly currency: string;
      readonly holdExpiresAt: Date;
    }
  | { readonly kind: "not_found" }
  /** Nothing to pay: already paid, hold ended, cancelled, or a free booking. */
  | {
      readonly kind: "not_payable";
      readonly reason: "confirmed" | "expired" | "cancelled" | "free";
    };

/**
 * The payment for a booking that is holding its tickets. The amount is the booking's stored
 * total. The payment's id is saved on the booking, so the webhook can match it back and a second
 * call returns the same payment.
 */
export async function startPayment(
  db: Database,
  gateway: PaymentGateway,
  { bookingId, now }: { bookingId: string; now: Date },
): Promise<StartPaymentResult> {
  await releaseExpiredHolds(db, { now, bookingId });

  const booking = await db
    .selectFrom("bookings as b")
    .innerJoin("events as e", "e.id", "b.event_id")
    .select([
      "b.id",
      "b.reference",
      "b.status",
      "b.total_cents",
      "b.hold_expires_at",
      "b.stripe_payment_intent_id",
      "e.currency",
    ])
    .where("b.id", "=", bookingId)
    .executeTakeFirst();
  if (!booking) return { kind: "not_found" };
  if (booking.status === "confirmed") return { kind: "not_payable", reason: "confirmed" };
  if (booking.status === "expired") return { kind: "not_payable", reason: "expired" };
  if (booking.status === "cancelled") return { kind: "not_payable", reason: "cancelled" };
  if (booking.total_cents === 0) return { kind: "not_payable", reason: "free" };

  const payment = await gateway.paymentForBooking({
    bookingId: booking.id,
    reference: booking.reference,
    amountCents: booking.total_cents,
    currency: booking.currency,
    existingIntentId: booking.stripe_payment_intent_id,
  });

  // Only while it is still waiting for payment: if the hold ended meanwhile, don't take money.
  const saved = await db
    .updateTable("bookings")
    .set({ stripe_payment_intent_id: payment.intentId })
    .where("id", "=", booking.id)
    .where("status", "=", "pending_payment")
    .returning("id")
    .executeTakeFirst();
  if (!saved) return { kind: "not_payable", reason: "expired" };

  return {
    kind: "ready",
    bookingId: booking.id,
    clientSecret: payment.clientSecret,
    amountCents: booking.total_cents,
    currency: booking.currency,
    holdExpiresAt: booking.hold_expires_at,
  };
}
