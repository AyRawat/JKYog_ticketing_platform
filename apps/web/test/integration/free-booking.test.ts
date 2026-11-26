import { BookingResponse } from "@ticketing/contracts";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { after, book, booker, getBooking, person, promoUses, stock } from "./support/bookings";
import { reseed, testDb } from "./support/db";
import { BEFORE_FESTIVAL } from "./support/http";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reseed();
});

afterAll(async () => {
  await testDb.destroy();
});

/** FLAT20 on one $8 child day pass: $8 − $8 = $0. */
const freeCart = {
  booker,
  attendees: [person("Riya Patel", 8, "DAY_PASS_CHILD")],
  promoCode: "FLAT20",
  expectedTotalCents: 0,
};

describe("a booking with nothing to pay", () => {
  it("is confirmed when it is made, with no payment step", async () => {
    const { status, json } = await book(freeCart);
    const booking = BookingResponse.parse(json);

    expect(status).toBe(201);
    expect(booking.status).toBe("confirmed");
    expect(booking.totalCents).toBe(0);
    const row = await testDb
      .selectFrom("bookings")
      .select(["confirmed_at", "stripe_payment_intent_id"])
      .where("id", "=", booking.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ confirmed_at: BEFORE_FESTIVAL, stripe_payment_intent_id: null });
  });

  it("keeps its tickets and code use: no hold runs out on it", async () => {
    const before = { stock: (await stock()).DAY_PASS_CHILD ?? 0, uses: await promoUses("FLAT20") };
    const booking = BookingResponse.parse((await book(freeCart)).json);

    // Long after a hold would have ended.
    const later = BookingResponse.parse(
      (await getBooking(booking.id, after(BEFORE_FESTIVAL, 60))).json,
    );
    expect(later.status).toBe("confirmed");
    expect((await stock()).DAY_PASS_CHILD).toBe(before.stock - 1);
    expect(await promoUses("FLAT20")).toBe(before.uses + 1);
  });

  it("logs its confirmation once, and not again when the request is replayed", async () => {
    const key = "4a6b3d2e-1f0c-4b8e-9d7a-6c5b4a3f2e1d";
    await book(freeCart, { key });
    const replay = await book(freeCart, { key });

    expect(replay.status).toBe(200);
    const confirmations = vi
      .mocked(console.info)
      .mock.calls.flat()
      .filter((line) => typeof line === "string" && line.startsWith("[email]"));
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatch(/confirmed \(total 0 cents\) → a\*\*\*@example\.com/);
  });

  it("is still a normal held booking when there is something to pay", async () => {
    const booking = BookingResponse.parse(
      (
        await book({
          booker,
          attendees: [person("Riya Patel", 8, "DAY_PASS_CHILD")],
          expectedTotalCents: 800,
        })
      ).json,
    );
    expect(booking.status).toBe("pending_payment");
  });
});
