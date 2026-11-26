import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { PaymentProviderError, stripeGateway } from "./gateway";

const input = {
  bookingId: "6b0f7a5e-3f0c-4a8e-9a7e-0d3f6b1c2a44",
  reference: "SU26-7K3QX",
  amountCents: 14_400,
  currency: "USD",
  existingIntentId: null,
};

const intent = (fields: Partial<Stripe.PaymentIntent> = {}) => ({
  id: "pi_new",
  amount: 14_400,
  currency: "usd",
  status: "requires_payment_method",
  client_secret: "pi_new_secret_1",
  ...fields,
});

/** Just the two Stripe calls the gateway makes. */
function fakeStripe(existing?: ReturnType<typeof intent>) {
  const create = vi.fn().mockResolvedValue(intent());
  const retrieve = vi.fn().mockResolvedValue(existing ?? intent());
  const stripe = { paymentIntents: { create, retrieve } } as unknown as Stripe;
  return { stripe, create, retrieve };
}

describe("stripeGateway.paymentForBooking", () => {
  it("creates the payment for the booking's stored total, once per booking", async () => {
    const { stripe, create } = fakeStripe();
    const payment = await stripeGateway(stripe, undefined).paymentForBooking(input);

    expect(payment).toEqual({ intentId: "pi_new", clientSecret: "pi_new_secret_1" });
    expect(create).toHaveBeenCalledWith(
      {
        amount: 14_400,
        currency: "usd",
        allowed_payment_method_types: ["card"],
        description: "Sharad Utsav booking SU26-7K3QX",
        metadata: { booking_id: input.bookingId, reference: "SU26-7K3QX" },
      },
      { idempotencyKey: `booking-payment-${input.bookingId}` },
    );
  });

  it("reuses the payment already started for the booking", async () => {
    const { stripe, create, retrieve } = fakeStripe(
      intent({ id: "pi_old", client_secret: "pi_old_secret" }),
    );
    const payment = await stripeGateway(stripe, undefined).paymentForBooking({
      ...input,
      existingIntentId: "pi_old",
    });

    expect(retrieve).toHaveBeenCalledWith("pi_old");
    expect(create).not.toHaveBeenCalled();
    expect(payment).toEqual({ intentId: "pi_old", clientSecret: "pi_old_secret" });
  });

  it.each([
    ["a different amount", { amount: 999 }],
    ["a different currency", { currency: "eur" }],
    ["a cancelled payment", { status: "canceled" as const }],
  ])("starts again instead of reusing %s", async (_, fields) => {
    const { stripe, create } = fakeStripe(intent({ id: "pi_old", ...fields }));
    await stripeGateway(stripe, undefined).paymentForBooking({
      ...input,
      existingIntentId: "pi_old",
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("reports any Stripe failure as a provider error", async () => {
    const { stripe, create } = fakeStripe();
    create.mockRejectedValue(new Error("connection reset"));
    await expect(stripeGateway(stripe, undefined).paymentForBooking(input)).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
  });

  it("refuses a payment with no client secret", async () => {
    const { stripe, create } = fakeStripe();
    create.mockResolvedValue(intent({ client_secret: null }));
    await expect(stripeGateway(stripe, undefined).paymentForBooking(input)).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
  });
});
