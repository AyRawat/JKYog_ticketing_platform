import "server-only";
import Stripe from "stripe";

// The only code that talks to Stripe. Everything else goes through `PaymentGateway`, so the
// booking services stay testable without a network and the provider could change.

export interface BookingPaymentInput {
  readonly bookingId: string;
  readonly reference: string;
  /** The booking's stored total: the only amount ever charged. */
  readonly amountCents: number;
  /** ISO 4217, any case. */
  readonly currency: string;
  /** The payment already started for this booking, if any. */
  readonly existingIntentId: string | null;
}

export interface BookingPayment {
  readonly intentId: string;
  readonly clientSecret: string;
}

/** What a Stripe webhook told us, reduced to what the bookings need. */
export type PaymentEvent =
  | {
      readonly kind: "payment_succeeded";
      readonly eventId: string;
      readonly intentId: string;
      readonly amountCents: number;
      /** Lower case, as Stripe sends it. */
      readonly currency: string;
    }
  | {
      readonly kind: "payment_failed";
      readonly eventId: string;
      readonly intentId: string;
      readonly reason: string | null;
    }
  | { readonly kind: "other"; readonly eventId: string; readonly type: string };

export interface PaymentGateway {
  /** The payment for a booking: started on the first call, the same one on every call after. */
  paymentForBooking(input: BookingPaymentInput): Promise<BookingPayment>;
  /**
   * Checks a webhook really came from Stripe (signature over the exact raw body) and reads it.
   * Throws WebhookSignatureError otherwise.
   */
  parsePaymentEvent(rawBody: string, signature: string | null): PaymentEvent;
  /** Gives the whole payment back. Safe to call twice for the same payment. */
  refundPayment(intentId: string): Promise<void>;
}

/** The webhook wasn't signed by Stripe with our secret, or the body was altered. */
export class WebhookSignatureError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "WebhookSignatureError";
  }
}

/** Stripe failed or couldn't be reached. Safe to retry; nothing was charged by us failing. */
export class PaymentProviderError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "PaymentProviderError";
  }
}

export function stripeGateway(stripe: Stripe, webhookSecret: string | undefined): PaymentGateway {
  return {
    parsePaymentEvent(rawBody, signature) {
      if (!webhookSecret) throw new PaymentProviderError("STRIPE_WEBHOOK_SECRET is not set.");
      if (!signature) throw new WebhookSignatureError("No Stripe-Signature header.");
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (error) {
        throw new WebhookSignatureError("The webhook signature doesn't match.", { cause: error });
      }
      switch (event.type) {
        case "payment_intent.succeeded": {
          const intent = event.data.object;
          return {
            kind: "payment_succeeded",
            eventId: event.id,
            intentId: intent.id,
            amountCents: intent.amount_received,
            currency: intent.currency,
          };
        }
        case "payment_intent.payment_failed": {
          const intent = event.data.object;
          return {
            kind: "payment_failed",
            eventId: event.id,
            intentId: intent.id,
            reason: intent.last_payment_error?.message ?? null,
          };
        }
        default:
          return { kind: "other", eventId: event.id, type: event.type };
      }
    },

    async refundPayment(intentId) {
      try {
        await stripe.refunds.create(
          { payment_intent: intentId, reason: "requested_by_customer" },
          { idempotencyKey: `refund-${intentId}` },
        );
      } catch (error) {
        throw new PaymentProviderError("Stripe refund failed.", { cause: error });
      }
    },

    async paymentForBooking({ bookingId, reference, amountCents, currency, existingIntentId }) {
      const code = currency.toLowerCase();
      try {
        if (existingIntentId) {
          const existing = await stripe.paymentIntents.retrieve(existingIntentId);
          // Reused only if it is still this booking's payment and can still be paid.
          if (
            existing.amount === amountCents &&
            existing.currency === code &&
            existing.status !== "canceled" &&
            existing.client_secret
          ) {
            return { intentId: existing.id, clientSecret: existing.client_secret };
          }
        }

        const intent = await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: code,
            // Cards only: one clear way to pay, the same in every Stripe account's settings.
            allowed_payment_method_types: ["card"],
            description: `Sharad Utsav booking ${reference}`,
            metadata: { booking_id: bookingId, reference },
          },
          // Two calls for the same booking (a double click, two tabs) get one payment.
          { idempotencyKey: `booking-payment-${bookingId}` },
        );
        if (!intent.client_secret) throw new Error("Stripe returned no client secret.");
        return { intentId: intent.id, clientSecret: intent.client_secret };
      } catch (error) {
        throw new PaymentProviderError("Stripe payment could not be started.", { cause: error });
      }
    },
  };
}

let gateway: PaymentGateway | undefined;

/** The app's gateway, created on first use from STRIPE_SECRET_KEY. */
export function getPaymentGateway(): PaymentGateway {
  if (gateway) return gateway;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new PaymentProviderError("STRIPE_SECRET_KEY is not set.");
  gateway = stripeGateway(
    new Stripe(key, { maxNetworkRetries: 2, timeout: 10_000 }),
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  return gateway;
}
