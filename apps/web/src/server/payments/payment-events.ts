import "server-only";
import type { Database } from "@ticketing/db";
import { HoldGone, retakeHold } from "../bookings/retake-hold";
import type { PaymentEvent, PaymentGateway } from "./gateway";

export type PaymentEventOutcome =
  /** Paid while the tickets were held. */
  | "confirmed"
  /** Paid after the hold ran out; the tickets were still there and were taken again. */
  | "late_confirmed"
  /** Paid after the hold ran out and the tickets had gone: the payment was given back. */
  | "refunded"
  | "already_confirmed"
  /** Stripe sent this event before; nothing done twice. */
  | "duplicate"
  /** A declined card: the booking keeps waiting, the family can try again. */
  | "failure_noted"
  /** Not a payment this app started. Recorded and logged. */
  | "unknown_payment"
  /** The amount paid isn't the booking's total. Not confirmed; logged for a person to check. */
  | "amount_mismatch"
  | "ignored";

interface Options {
  readonly now: Date;
  /** Runs after a booking is confirmed and committed. */
  readonly onConfirmed: (bookingId: string) => Promise<void>;
}

/** Thrown out of the transaction (rolling it back) when the payment must be given back. */
class RefundNeeded extends Error {
  constructor(readonly bookingId: string) {
    super("refund needed");
  }
}

/**
 * Applies one Stripe payment event to its booking, exactly once.
 *
 * The event id is recorded in the same transaction as the booking change, so a retried or
 * repeated delivery finds it and does nothing. The booking row is locked while it is checked
 * and updated, so a hold release running at the same moment can't expire a booking being paid.
 *
 * A refund happens before the event is recorded: if Stripe can't be reached the handler throws,
 * the webhook answers 500, and Stripe delivers the event again later.
 */
export async function handlePaymentEvent(
  db: Database,
  gateway: PaymentGateway,
  event: PaymentEvent,
  { now, onConfirmed }: Options,
): Promise<{ outcome: PaymentEventOutcome; bookingId: string | null }> {
  if (event.kind === "other") return { outcome: "ignored", bookingId: null };

  let result: { outcome: PaymentEventOutcome; bookingId: string | null };
  try {
    result = await db.transaction().execute(async (trx) => {
      const fresh = await trx
        .insertInto("processed_stripe_events")
        .values({ stripe_event_id: event.eventId })
        .onConflict((conflict) => conflict.column("stripe_event_id").doNothing())
        .returning("stripe_event_id")
        .executeTakeFirst();
      if (!fresh) return { outcome: "duplicate", bookingId: null };

      const booking = await trx
        .selectFrom("bookings")
        .select(["id", "status", "total_cents", "promo_code_id", "event_id"])
        .where("stripe_payment_intent_id", "=", event.intentId)
        .forUpdate()
        .executeTakeFirst();
      if (!booking) return { outcome: "unknown_payment", bookingId: null };
      if (event.kind === "payment_failed")
        return { outcome: "failure_noted", bookingId: booking.id };

      const { currency } = await trx
        .selectFrom("events")
        .select("currency")
        .where("id", "=", booking.event_id)
        .executeTakeFirstOrThrow();
      if (event.amountCents !== booking.total_cents || event.currency !== currency.toLowerCase()) {
        return { outcome: "amount_mismatch", bookingId: booking.id };
      }

      switch (booking.status) {
        case "confirmed":
          return { outcome: "already_confirmed", bookingId: booking.id };
        case "pending_payment":
          // Paid in time. Even if the hold ended a moment ago, nobody has released it yet, so
          // the tickets are still this booking's.
          await confirm(trx, booking.id, now);
          return { outcome: "confirmed", bookingId: booking.id };
        case "expired":
          try {
            await retakeHold(trx, { id: booking.id, promoCodeId: booking.promo_code_id });
          } catch (error) {
            if (error instanceof HoldGone) throw new RefundNeeded(booking.id);
            throw error;
          }
          await confirm(trx, booking.id, now);
          return { outcome: "late_confirmed", bookingId: booking.id };
        case "cancelled":
          throw new RefundNeeded(booking.id);
      }
    });
  } catch (error) {
    if (!(error instanceof RefundNeeded) || event.kind !== "payment_succeeded") throw error;
    await gateway.refundPayment(event.intentId);
    await db
      .insertInto("processed_stripe_events")
      .values({ stripe_event_id: event.eventId })
      .onConflict((conflict) => conflict.column("stripe_event_id").doNothing())
      .execute();
    result = { outcome: "refunded", bookingId: error.bookingId };
  }

  if ((result.outcome === "confirmed" || result.outcome === "late_confirmed") && result.bookingId) {
    await onConfirmed(result.bookingId);
  }
  return result;
}

async function confirm(trx: Parameters<typeof retakeHold>[0], bookingId: string, now: Date) {
  await trx
    .updateTable("bookings")
    .set({ status: "confirmed", confirmed_at: now })
    .where("id", "=", bookingId)
    .execute();
}
