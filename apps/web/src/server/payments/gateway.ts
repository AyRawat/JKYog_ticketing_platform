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

export interface PaymentGateway {
  /** The payment for a booking: started on the first call, the same one on every call after. */
  paymentForBooking(input: BookingPaymentInput): Promise<BookingPayment>;
}

/** Stripe failed or couldn't be reached. Safe to retry; nothing was charged by us failing. */
export class PaymentProviderError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "PaymentProviderError";
  }
}

export function stripeGateway(stripe: Stripe): PaymentGateway {
  return {
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
            automatic_payment_methods: { enabled: true },
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
  gateway = stripeGateway(new Stripe(key, { maxNetworkRetries: 2, timeout: 10_000 }));
  return gateway;
}
