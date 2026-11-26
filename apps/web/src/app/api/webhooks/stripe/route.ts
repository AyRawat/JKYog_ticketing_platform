import { getDb } from "@/server/db";
import { errorResponse, internalError, readTextWithLimit } from "@/server/http";
import { logConfirmation } from "@/server/notifications/booking-confirmation";
import { getPaymentGateway, WebhookSignatureError } from "@/server/payments/gateway";
import { handlePaymentEvent } from "@/server/payments/payment-events";

export const runtime = "nodejs";

/** Far above any Stripe event this endpoint listens for. */
const MAX_WEBHOOK_BYTES = 512 * 1024;

/**
 * POST /api/webhooks/stripe   (called by Stripe, not by the app)
 *
 * 200 { received: true } | 400 WEBHOOK_SIGNATURE_INVALID | 413 | 500 (Stripe retries)
 *
 * Confirms a booking when its payment succeeds. The signature is checked over the exact raw
 * body before anything is read from it. Every event is applied once, however often Stripe sends
 * it. A 500 makes Stripe deliver the event again later, so it is only returned when the event
 * could not be applied.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await readTextWithLimit(request, MAX_WEBHOOK_BYTES);
  if (rawBody === null) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }

  try {
    const gateway = getPaymentGateway();
    let event;
    try {
      event = gateway.parsePaymentEvent(rawBody, request.headers.get("stripe-signature"));
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        return errorResponse(400, "WEBHOOK_SIGNATURE_INVALID", "The webhook signature is invalid.");
      }
      throw error;
    }

    const db = getDb();
    const { outcome, bookingId } = await handlePaymentEvent(db, gateway, event, {
      now: new Date(),
      onConfirmed: async (id) => {
        // The booking is already confirmed; a failed email must not make Stripe resend.
        try {
          await logConfirmation(db, id);
        } catch (error) {
          console.error("webhook: confirmation message failed", error);
        }
      },
    });

    const log =
      outcome === "amount_mismatch" || outcome === "unknown_payment" ? console.warn : console.info;
    log(`stripe webhook ${event.eventId}: ${outcome}${bookingId ? ` (booking ${bookingId})` : ""}`);
    return Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return internalError("webhook: could not apply the event", error);
  }
}
