import { BookingResponse } from "@ticketing/contracts";
import { sql } from "kysely";
import Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import type * as Gateway from "@/server/payments/gateway";
import {
  after,
  book,
  booker,
  getBooking,
  person,
  promoUses,
  setStock,
  stock,
} from "./support/bookings";
import { reseed, testDb } from "./support/db";
import { BEFORE_FESTIVAL } from "./support/http";

// The real Stripe signature check with our test secret; only refunds are faked.
// Hoisted: vi.mock runs before the rest of the file.
const fake = vi.hoisted(() => ({
  secret: "whsec_test_secret_for_integration_tests",
  refunds: [] as string[],
  refundsDown: false,
}));
const SECRET = fake.secret;
const refunds = fake.refunds;
const stripe = new Stripe("sk_test_not_used");

vi.mock("@/server/payments/gateway", async (importOriginal) => {
  const original = await importOriginal<typeof Gateway>();
  const { default: StripeClient } = await import("stripe");
  const real = original.stripeGateway(new StripeClient("sk_test_not_used"), fake.secret);
  return {
    ...original,
    getPaymentGateway: (): Gateway.PaymentGateway => ({
      ...real,
      refundPayment: (intentId) => {
        if (fake.refundsDown) return Promise.reject(new original.PaymentProviderError("down"));
        fake.refunds.push(intentId);
        return Promise.resolve();
      },
    }),
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  refunds.length = 0;
  fake.refundsDown = false;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reseed();
});

afterAll(async () => {
  await testDb.destroy();
});

/** One adult on 12 Dec with SEVA10: $15 − $1.50 = $13.50. */
const cart = {
  booker,
  attendees: [person("Asha Patel", 40, "DAY_PASS_ADULT")],
  promoCode: "SEVA10",
  expectedTotalCents: 1350,
};

/** A booking whose payment has been started, as the payment endpoint leaves it. */
async function bookingWithPayment(intentId = "pi_test_1") {
  const { id } = BookingResponse.parse((await book(cart)).json);
  await testDb
    .updateTable("bookings")
    .set({ stripe_payment_intent_id: intentId })
    .where("id", "=", id)
    .execute();
  return id;
}

let eventCounter = 0;
function paymentEvent(
  type: "payment_intent.succeeded" | "payment_intent.payment_failed" | "charge.refunded",
  {
    intentId = "pi_test_1",
    amount = 1350,
    currency = "usd",
    id = `evt_${String(++eventCounter)}`,
  } = {},
) {
  return JSON.stringify({
    id,
    object: "event",
    type,
    api_version: "2026-11-18.endive",
    created: 1_764_000_000,
    livemode: false,
    data: {
      object: {
        id: intentId,
        object: "payment_intent",
        amount,
        amount_received: type === "payment_intent.succeeded" ? amount : 0,
        currency,
        last_payment_error:
          type === "payment_intent.payment_failed" ? { message: "Your card was declined." } : null,
      },
    },
  });
}

async function deliver(
  payload: string,
  { now = BEFORE_FESTIVAL, signature }: { now?: Date; signature?: string | null } = {},
) {
  vi.setSystemTime(now);
  const header =
    signature === undefined
      ? stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })
      : signature;
  const response = await POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: header === null ? {} : { "stripe-signature": header },
      body: payload,
    }),
  );
  return { status: response.status, json: (await response.json()) as unknown };
}

const statusOf = async (id: string) =>
  await testDb
    .selectFrom("bookings")
    .select(["status", "confirmed_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

const eventsRecorded = async () =>
  Number(
    (
      await sql<{ n: string }>`SELECT count(*)::text AS n FROM processed_stripe_events`.execute(
        testDb,
      )
    ).rows[0]?.n,
  );

describe("POST /api/webhooks/stripe", () => {
  it("confirms a booking when its payment succeeds", async () => {
    const id = await bookingWithPayment();
    const { status, json } = await deliver(paymentEvent("payment_intent.succeeded"));

    expect(status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(await statusOf(id)).toEqual({ status: "confirmed", confirmed_at: BEFORE_FESTIVAL });
    expect(BookingResponse.parse((await getBooking(id)).json).status).toBe("confirmed");
  });

  it("logs the confirmation message, with the email address masked", async () => {
    await bookingWithPayment();
    await deliver(paymentEvent("payment_intent.succeeded"));
    const logged = vi.mocked(console.info).mock.calls.flat().join("\n");
    expect(logged).toMatch(
      /\[email\] Booking SU26-\w+ confirmed \(total 1350 cents\) → a\*\*\*@example\.com/,
    );
    expect(logged).not.toContain(booker.email);
  });

  it("applies a repeated event once", async () => {
    const id = await bookingWithPayment();
    const payload = paymentEvent("payment_intent.succeeded", { id: "evt_repeat" });
    await deliver(payload);
    await deliver(payload, { now: after(BEFORE_FESTIVAL, 5) });

    // Still confirmed at the first delivery's time.
    expect((await statusOf(id)).confirmed_at).toEqual(BEFORE_FESTIVAL);
    expect(await eventsRecorded()).toBe(1);
  });

  it("applies two simultaneous deliveries of the same event once", async () => {
    const id = await bookingWithPayment();
    const payload = paymentEvent("payment_intent.succeeded", { id: "evt_race" });
    const results = await Promise.all([deliver(payload), deliver(payload)]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await statusOf(id)).status).toBe("confirmed");
    expect(await eventsRecorded()).toBe(1);
  });

  it("confirms a payment that lands a moment after the hold ended, before any release", async () => {
    const id = await bookingWithPayment();
    await deliver(paymentEvent("payment_intent.succeeded"), { now: after(BEFORE_FESTIVAL, 16) });
    expect((await statusOf(id)).status).toBe("confirmed");
  });

  describe("a payment after the hold was released", () => {
    async function expiredBooking() {
      const id = await bookingWithPayment();
      // Reading the booking after its hold releases it: stock and the code use go back.
      await getBooking(id, after(BEFORE_FESTIVAL, 16));
      expect((await statusOf(id)).status).toBe("expired");
      return id;
    }

    it("takes the tickets and the code use again, and confirms", async () => {
      const id = await expiredBooking();
      const before = { stock: (await stock()).DAY_PASS_ADULT, uses: await promoUses("SEVA10") };

      await deliver(paymentEvent("payment_intent.succeeded"), { now: after(BEFORE_FESTIVAL, 20) });

      expect((await statusOf(id)).status).toBe("confirmed");
      expect((await stock()).DAY_PASS_ADULT).toBe((before.stock ?? 0) - 1);
      expect(await promoUses("SEVA10")).toBe(before.uses + 1);
      expect(refunds).toEqual([]);
    });

    it("gives the money back when the tickets have gone, and leaves the booking expired", async () => {
      const id = await expiredBooking();
      await setStock("DAY_PASS_ADULT", 0);
      const usesBefore = await promoUses("SEVA10");

      const { status } = await deliver(paymentEvent("payment_intent.succeeded"), {
        now: after(BEFORE_FESTIVAL, 20),
      });

      expect(status).toBe(200);
      expect(refunds).toEqual(["pi_test_1"]);
      expect((await statusOf(id)).status).toBe("expired");
      expect((await stock()).DAY_PASS_ADULT).toBe(0);
      expect(await promoUses("SEVA10")).toBe(usesBefore);
      expect(await eventsRecorded()).toBe(1);
    });

    it("answers 500 without recording the event if the refund fails, so Stripe sends it again", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await expiredBooking();
      await setStock("DAY_PASS_ADULT", 0);
      const payload = paymentEvent("payment_intent.succeeded", { id: "evt_refund_retry" });

      fake.refundsDown = true;
      expect((await deliver(payload, { now: after(BEFORE_FESTIVAL, 20) })).status).toBe(500);
      expect(await eventsRecorded()).toBe(0);

      fake.refundsDown = false;
      expect((await deliver(payload, { now: after(BEFORE_FESTIVAL, 25) })).status).toBe(200);
      expect(refunds).toEqual(["pi_test_1"]);
      expect(await eventsRecorded()).toBe(1);
    });
  });

  it("does not confirm when the amount paid isn't the booking's total", async () => {
    const id = await bookingWithPayment();
    await deliver(paymentEvent("payment_intent.succeeded", { amount: 100 }));
    expect((await statusOf(id)).status).toBe("pending_payment");
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not confirm a payment in another currency", async () => {
    const id = await bookingWithPayment();
    await deliver(paymentEvent("payment_intent.succeeded", { currency: "eur" }));
    expect((await statusOf(id)).status).toBe("pending_payment");
  });

  it("keeps the booking waiting after a declined card, so the family can try again", async () => {
    const id = await bookingWithPayment();
    const { status } = await deliver(paymentEvent("payment_intent.payment_failed"));
    expect(status).toBe(200);
    expect((await statusOf(id)).status).toBe("pending_payment");
  });

  it("records a payment this app didn't start, and changes nothing", async () => {
    const id = await bookingWithPayment();
    await deliver(paymentEvent("payment_intent.succeeded", { intentId: "pi_someone_else" }));
    expect((await statusOf(id)).status).toBe("pending_payment");
    expect(await eventsRecorded()).toBe(1);
  });

  it("acknowledges other event types without doing anything", async () => {
    const { status } = await deliver(paymentEvent("charge.refunded"));
    expect(status).toBe(200);
    expect(await eventsRecorded()).toBe(0);
  });

  describe("400 WEBHOOK_SIGNATURE_INVALID", () => {
    it.each([
      ["no signature", null],
      ["a made-up signature", "t=1764000000,v1=deadbeef"],
      ["a signature from another secret", "other"],
    ])("for %s, changing nothing", async (_, signature) => {
      const id = await bookingWithPayment();
      const payload = paymentEvent("payment_intent.succeeded");
      const header =
        signature === "other"
          ? stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" })
          : signature;
      const { status, json } = await deliver(payload, { signature: header });

      expect(status).toBe(400);
      expect(json).toEqual({
        error: { code: "WEBHOOK_SIGNATURE_INVALID", message: "The webhook signature is invalid." },
      });
      expect((await statusOf(id)).status).toBe("pending_payment");
      expect(await eventsRecorded()).toBe(0);
    });

    it("for a body changed after signing (a higher amount)", async () => {
      const id = await bookingWithPayment();
      const payload = paymentEvent("payment_intent.succeeded");
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
      const { status } = await deliver(payload.replace("1350", "9999"), { signature: header });
      expect(status).toBe(400);
      expect((await statusOf(id)).status).toBe("pending_payment");
    });
  });
});
