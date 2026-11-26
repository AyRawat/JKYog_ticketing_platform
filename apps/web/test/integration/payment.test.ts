import { BookingResponse, ErrorResponse, PaymentResponse } from "@ticketing/contracts";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/bookings/[id]/payment/route";
import type * as Gateway from "@/server/payments/gateway";
import { after, book, booker, designExample, person } from "./support/bookings";
import { reseed, testDb } from "./support/db";
import { BEFORE_FESTIVAL } from "./support/http";

// Stripe is replaced by a fake that records what it was asked for. Each booking gets one
// payment id, as Stripe's idempotency key gives in real life.
const stripeCalls: Gateway.BookingPaymentInput[] = [];
let stripeDown = false;

vi.mock("@/server/payments/gateway", async (importOriginal) => {
  const original = await importOriginal<typeof Gateway>();
  return {
    ...original,
    getPaymentGateway: (): Gateway.PaymentGateway => ({
      paymentForBooking: (input) => {
        stripeCalls.push(input);
        if (stripeDown) return Promise.reject(new original.PaymentProviderError("down"));
        const intentId = input.existingIntentId ?? `pi_${input.bookingId.slice(0, 8)}`;
        return Promise.resolve({ intentId, clientSecret: `${intentId}_secret_test` });
      },
    }),
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  stripeCalls.length = 0;
  stripeDown = false;
});

afterEach(async () => {
  vi.useRealTimers();
  await reseed();
});

afterAll(async () => {
  await testDb.destroy();
});

async function pay(
  id: string,
  { now = BEFORE_FESTIVAL, body = "{}", contentType = "application/json" } = {},
) {
  vi.setSystemTime(now);
  const response = await POST(
    new Request(`http://localhost/api/bookings/${id}/payment`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
  const text = await response.text();
  return { response, status: response.status, json: JSON.parse(text) as unknown };
}

async function newBooking(json: unknown = designExample) {
  return BookingResponse.parse((await book(json)).json);
}

const storedIntent = async (id: string) =>
  (
    await testDb
      .selectFrom("bookings")
      .select("stripe_payment_intent_id")
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
  ).stripe_payment_intent_id;

describe("POST /api/bookings/:id/payment", () => {
  it("200: starts the payment for the booking's stored total", async () => {
    const booking = await newBooking();
    const { status, json, response } = await pay(booking.id);

    expect(status).toBe(200);
    expect(PaymentResponse.parse(json)).toEqual({
      bookingId: booking.id,
      clientSecret: `pi_${booking.id.slice(0, 8)}_secret_test`,
      amountCents: 14_400,
      currency: "USD",
      holdExpiresAt: booking.holdExpiresAt,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(stripeCalls).toEqual([
      {
        bookingId: booking.id,
        reference: booking.reference,
        amountCents: 14_400,
        currency: "USD",
        existingIntentId: null,
      },
    ]);
    expect(await storedIntent(booking.id)).toBe(`pi_${booking.id.slice(0, 8)}`);
  });

  it("charges what was stored, even if prices changed since", async () => {
    const booking = await newBooking();
    await testDb.updateTable("products").set({ unit_price_cents: 1 }).execute();
    await pay(booking.id);
    expect(stripeCalls[0]?.amountCents).toBe(14_400);
  });

  it("returns the same payment when asked again (refresh, declined card)", async () => {
    const booking = await newBooking();
    const first = PaymentResponse.parse((await pay(booking.id)).json);
    const second = PaymentResponse.parse((await pay(booking.id)).json);

    expect(second.clientSecret).toBe(first.clientSecret);
    expect(stripeCalls[1]?.existingIntentId).toBe(`pi_${booking.id.slice(0, 8)}`);
  });

  describe("409 BOOKING_NOT_PAYABLE", () => {
    it("once the hold has ended (the booking is expired on the way)", async () => {
      const booking = await newBooking();
      const { status, json } = await pay(booking.id, { now: after(BEFORE_FESTIVAL, 15) });

      expect(status).toBe(409);
      expect(ErrorResponse.parse(json).error.code).toBe("BOOKING_NOT_PAYABLE");
      expect(stripeCalls).toEqual([]);
      const row = await testDb
        .selectFrom("bookings")
        .select("status")
        .where("id", "=", booking.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("expired");
    });

    it("for a booking already paid", async () => {
      const booking = await newBooking();
      await testDb
        .updateTable("bookings")
        .set({ status: "confirmed", confirmed_at: BEFORE_FESTIVAL })
        .where("id", "=", booking.id)
        .execute();
      const { status, json } = await pay(booking.id);
      expect(status).toBe(409);
      expect(ErrorResponse.parse(json).error.message).toBe("This booking is already paid.");
      expect(stripeCalls).toEqual([]);
    });

    it("for a booking with nothing to pay", async () => {
      // FLAT20 on one $8 child day pass: total $0.
      const free = await newBooking({
        booker,
        attendees: [person("Riya Patel", 8, "DAY_PASS_CHILD")],
        promoCode: "FLAT20",
        expectedTotalCents: 0,
      });
      const { status, json } = await pay(free.id);
      expect(status).toBe(409);
      expect(ErrorResponse.parse(json).error.message).toBe("This booking has nothing to pay.");
      expect(stripeCalls).toEqual([]);
    });
  });

  describe("404 BOOKING_NOT_FOUND", () => {
    it.each(["8b1c6c1e-6d0c-4b41-9b7a-2f8d5d6e2a11", "SU26-ZAVQ5Q", "' OR '1'='1"])(
      "for %j, without calling Stripe",
      async (id) => {
        const { status, json } = await pay(id);
        expect(status).toBe(404);
        expect(ErrorResponse.parse(json).error.code).toBe("BOOKING_NOT_FOUND");
        expect(stripeCalls).toEqual([]);
      },
    );
  });

  it("400: refuses any field in the body, such as an amount", async () => {
    const booking = await newBooking();
    const { status, json } = await pay(booking.id, { body: JSON.stringify({ amountCents: 1 }) });
    expect(status).toBe(400);
    expect(ErrorResponse.parse(json).error.details).toEqual([
      { path: "amountCents", message: "This field is not allowed." },
    ]);
    expect(stripeCalls).toEqual([]);
  });

  it("415: refuses a body that isn't JSON (a cross-site form)", async () => {
    const booking = await newBooking();
    const { status } = await pay(booking.id, {
      body: "x=1",
      contentType: "application/x-www-form-urlencoded",
    });
    expect(status).toBe(415);
    expect(stripeCalls).toEqual([]);
  });

  it("503: says the tickets are still held when Stripe is down, and saves nothing", async () => {
    const booking = await newBooking();
    stripeDown = true;
    const { status, json } = await pay(booking.id);
    expect(status).toBe(503);
    expect(ErrorResponse.parse(json).error).toEqual({
      code: "PAYMENT_UNAVAILABLE",
      message:
        "We couldn't reach the payment service. Your tickets are still held; please try again.",
    });
    expect(await storedIntent(booking.id)).toBeNull();
  });
});
