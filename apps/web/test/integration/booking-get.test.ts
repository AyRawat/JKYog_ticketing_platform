import { BookingResponse, ErrorResponse } from "@ticketing/contracts";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { book, booker, designExample, getBooking } from "./support/bookings";
import { reseed, testDb } from "./support/db";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  await reseed();
});

afterAll(async () => {
  await testDb.destroy();
});

describe("GET /api/bookings/:id", () => {
  it("200: the booking exactly as it was returned when it was made", async () => {
    const created = await book(designExample);
    const { id } = BookingResponse.parse(created.json);

    const { status, json, response } = await getBooking(id);

    expect(status).toBe(200);
    expect(json).toEqual(created.json);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("shows the prices it was booked at, not today's", async () => {
    const { id } = BookingResponse.parse((await book(designExample)).json);
    await testDb.updateTable("products").set({ unit_price_cents: 9_999 }).execute();

    const booking = BookingResponse.parse((await getBooking(id)).json);
    expect(booking.totalCents).toBe(14_400);
    expect(booking.lines.map((l) => l.unitPriceCents)).toEqual([1500, 1500, 4000, 500, 1200, 2000]);
  });

  it("never returns the booker's contact details", async () => {
    const { id } = BookingResponse.parse((await book(designExample)).json);
    const { text } = await getBooking(id);
    expect(text).not.toContain(booker.email);
    expect(text).not.toContain("214-555-0100");
  });

  describe("404 BOOKING_NOT_FOUND", () => {
    it("for an id that isn't a booking", async () => {
      const { status, json, response } = await getBooking("8b1c6c1e-6d0c-4b41-9b7a-2f8d5d6e2a11");
      expect(status).toBe(404);
      expect(ErrorResponse.parse(json)).toEqual({
        error: { code: "BOOKING_NOT_FOUND", message: "We couldn't find that booking." },
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it.each(["1", "SU26-ZAVQ5Q", "../health", "' OR '1'='1", "8b1c6c1e6d0c4b419b7a2f8d5d6e2a11"])(
      "for a malformed id %j, the same way",
      async (id) => {
        const { status, json } = await getBooking(id);
        expect(status).toBe(404);
        expect(ErrorResponse.parse(json).error.code).toBe("BOOKING_NOT_FOUND");
      },
    );

    it("a booking reference is not an id: references are for the door, not for lookups", async () => {
      const { reference } = BookingResponse.parse((await book(designExample)).json);
      expect((await getBooking(reference)).status).toBe(404);
    });
  });
});
