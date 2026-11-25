import { randomUUID } from "node:crypto";
import { BookingResponse, ErrorResponse, QuoteResponse } from "@ticketing/contracts";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postQuote } from "@/app/api/events/[slug]/quote/route";
import { book, booker, designExample, person, snapshot, stock } from "./support/bookings";
import { reseed, testDb } from "./support/db";
import { call } from "./support/http";

async function bookOk(json: unknown, options: Parameters<typeof book>[1] = {}) {
  const result = await book(json, options);
  expect(result.status, result.text).toBe(201);
  return { ...result, booking: BookingResponse.parse(result.json) };
}

async function bookError(json: unknown, options: Parameters<typeof book>[1] = {}) {
  const result = await book(json, options);
  return { ...result, error: ErrorResponse.parse(result.json).error };
}

const SEEDED_STOCK = {
  DAY_PASS_ADULT: 380,
  DAY_PASS_CHILD: 260,
  ALL_DAY_PASS_ADULT: 0,
  ALL_DAY_PASS_CHILD: 140,
  FAMILY_PASS: 95,
  DANDIYA_STICKS: 900,
  DINNER_PLATE: 1700,
  GARBA_WORKSHOP: 2,
};

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

describe("POST /api/events/:slug/bookings", () => {
  describe("201: a new booking", () => {
    it("returns the booking, held for 15 minutes, at the price the quote showed", async () => {
      const { booking, response } = await bookOk(designExample);

      expect(booking).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        reference: expect.stringMatching(/^SU26-[2-9A-HJKMNP-TV-Z]{6}$/) as string,
        status: "pending_payment",
        holdExpiresAt: "2026-11-25T18:15:00.000Z",
        currency: "USD",
        lines: [
          line("DAY_PASS_ADULT", "Day Pass – Adult", "2026-12-12", 1, 1500),
          line("DAY_PASS_ADULT", "Day Pass – Adult", "2026-12-13", 1, 1500),
          line("FAMILY_PASS", "Family Pass", "2026-12-12", 1, 4000),
          line("DANDIYA_STICKS", "Dandiya Sticks (pair)", null, 2, 500),
          line("DINNER_PLATE", "Dinner Plate", "2026-12-12", 5, 1200),
          line("GARBA_WORKSHOP", "Garba Workshop", "2026-12-13", 1, 2000),
        ],
        subtotalCents: 16_000,
        discountCents: 1_600,
        totalCents: 14_400,
        promoCode: "SEVA10",
        attendees: [
          {
            fullName: "Asha Patel",
            ageYears: 40,
            productCode: "FAMILY_PASS",
            days: ["2026-12-12"],
          },
          { fullName: "Raj Patel", ageYears: 42, productCode: "FAMILY_PASS", days: ["2026-12-12"] },
          { fullName: "Dev Patel", ageYears: 9, productCode: "FAMILY_PASS", days: ["2026-12-12"] },
          { fullName: "Isha Patel", ageYears: 7, productCode: "FAMILY_PASS", days: ["2026-12-12"] },
          {
            fullName: "Kamla Patel",
            ageYears: 68,
            productCode: "DAY_PASS_ADULT",
            days: ["2026-12-12", "2026-12-13"],
          },
          { fullName: "Mira Patel", ageYears: 2, productCode: null, days: [] },
        ],
      });
      expect(response.headers.get("Location")).toBe(`/api/bookings/${booking.id}`);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("charges exactly what the quote endpoint shows for the same cart", async () => {
      // The same cart, in the quote's shape: ages and tickets only.
      const quoted = QuoteResponse.parse(
        (
          await call(postQuote, "quote", {
            json: {
              booker: { ageYears: designExample.booker.ageYears },
              attendees: designExample.attendees.map(({ ageYears, entry }) => ({
                ageYears,
                entry,
              })),
              extras: designExample.extras,
              promoCode: designExample.promoCode,
            },
          })
        ).json,
      );
      const { booking } = await bookOk(designExample);
      expect(booking.lines).toEqual(quoted.lines);
      expect(booking.totalCents).toBe(quoted.totalCents);
    });

    it("takes the stock and one use of the promo code", async () => {
      await bookOk(designExample);
      expect(await stock()).toEqual({
        ...SEEDED_STOCK,
        FAMILY_PASS: 94,
        DAY_PASS_ADULT: 378,
        DANDIYA_STICKS: 898,
        DINNER_PLATE: 1695,
        GARBA_WORKSHOP: 1,
      });
      const seva = await testDb
        .selectFrom("promo_codes")
        .select("times_redeemed")
        .where("code", "=", "SEVA10")
        .executeTakeFirstOrThrow();
      expect(seva.times_redeemed).toBe(1);
    });

    it("stores the contact details, the price snapshot and the door list", async () => {
      const { booking } = await bookOk(designExample);
      const row = await testDb
        .selectFrom("bookings")
        .selectAll()
        .where("id", "=", booking.id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        status: "pending_payment",
        contact_name: "Asha Patel",
        contact_email: "asha.patel@example.com",
        contact_phone: "+1 214-555-0100",
        contact_age_years: 40,
        subtotal_cents: 16_000,
        discount_cents: 1_600,
        total_cents: 14_400,
        stripe_payment_intent_id: null,
        confirmed_at: null,
      });
      expect(row.idempotency_request_hash).toMatch(/^[0-9a-f]{64}$/);

      const doorList = await testDb
        .selectFrom("admissions as ad")
        .innerJoin("attendees as a", "a.id", "ad.attendee_id")
        .innerJoin("event_days as d", "d.id", "ad.event_day_id")
        .select(["a.full_name", "d.day_date"])
        .where("ad.booking_id", "=", booking.id)
        .orderBy("d.day_date")
        .orderBy("a.position")
        .execute();
      expect(doorList.map((r) => `${r.day_date} ${r.full_name}`)).toEqual([
        "2026-12-12 Asha Patel",
        "2026-12-12 Raj Patel",
        "2026-12-12 Dev Patel",
        "2026-12-12 Isha Patel",
        "2026-12-12 Kamla Patel",
        "2026-12-13 Kamla Patel",
      ]);
    });

    it("never echoes the booker's contact details", async () => {
      const { text } = await bookOk(designExample);
      expect(text).not.toContain(booker.email);
      expect(text).not.toContain("214-555-0100");
    });
  });

  describe("Idempotency-Key: a retry never books twice", () => {
    it("the same request with the same key returns the same booking (200) and takes nothing", async () => {
      const key = randomUUID();
      const first = await bookOk(designExample, { key });
      const before = await snapshot();

      const retry = await book(designExample, { key });
      expect(retry.status).toBe(200);
      expect(retry.json).toEqual(first.json);
      expect(await snapshot()).toEqual(before);
    });

    it("the same request with its fields in another order is still the same request", async () => {
      const key = randomUUID();
      await bookOk(designExample, { key });
      const reordered = Object.fromEntries(Object.entries(designExample).reverse());
      expect((await book(reordered, { key })).status).toBe(200);
    });

    it("a retry after the price changed still returns the original booking", async () => {
      const key = randomUUID();
      const first = await bookOk(designExample, { key });
      await testDb.updateTable("products").set({ unit_price_cents: 9_999 }).execute();
      const retry = await book(designExample, { key });
      expect(retry.status).toBe(200);
      expect(BookingResponse.parse(retry.json).totalCents).toBe(first.booking.totalCents);
    });

    it("a different request with a used key is refused (409) and changes nothing", async () => {
      const key = randomUUID();
      await bookOk(designExample, { key });
      const before = await snapshot();

      const { status, error } = await bookError({ ...designExample, promoCode: null }, { key });
      expect(status).toBe(409);
      expect(error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await snapshot()).toEqual(before);
    });

    it("five simultaneous submits with one key make one booking", async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => book(designExample, { key })),
      );

      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
      const ids = new Set(results.map((r) => BookingResponse.parse(r.json).id));
      expect(ids.size).toBe(1);
      expect((await snapshot()).bookings).toBe("1");
      expect((await stock()).GARBA_WORKSHOP).toBe(1);
    });
  });

  describe("races for the last units", () => {
    const garbaFamily = (n: number) => ({
      booker,
      attendees: [person(`Guest ${n}`, 30, "DAY_PASS_ADULT", ["2026-12-13"])],
      extras: [{ productCode: "GARBA_WORKSHOP", day: "2026-12-13", quantity: 1 }],
      expectedTotalCents: 3_500,
    });

    it("8 families, 2 Garba places: exactly 2 bookings, stock never below zero", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, (_, n) => book(garbaFamily(n))));

      const created = results.filter((r) => r.status === 201);
      expect(created).toHaveLength(2);
      for (const loser of results.filter((r) => r.status !== 201)) {
        // Lost at the stock update (409), or the catalog it read already showed none left (422).
        const { error } = ErrorResponse.parse(loser.json);
        const reason = loser.status === 409 ? error.code : error.details?.[0]?.code;
        expect([409, 422]).toContain(loser.status);
        expect(["SOLD_OUT", "INSUFFICIENT_STOCK"]).toContain(reason);
      }
      expect((await stock()).GARBA_WORKSHOP).toBe(0);
      expect((await snapshot()).bookings).toBe("2");
    });

    it("6 families, 1 use of a code left: exactly 1 gets the discount", async () => {
      await testDb
        .updateTable("promo_codes")
        .set({ times_redeemed: 49 })
        .where("code", "=", "MAXEDOUT")
        .execute();
      const cart = (n: number) => ({
        booker,
        attendees: [person(`Guest ${n}`, 30, "DAY_PASS_ADULT")],
        promoCode: "MAXEDOUT",
        expectedTotalCents: 1_275,
      });

      const results = await Promise.all(Array.from({ length: 6 }, (_, n) => book(cart(n))));

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const loser of results.filter((r) => r.status !== 201)) {
        const { error } = ErrorResponse.parse(loser.json);
        const reason = loser.status === 409 ? error.code : error.details?.[0]?.code;
        expect(["PROMO_UNAVAILABLE", "PROMO_EXHAUSTED"]).toContain(reason);
      }
      const code = await testDb
        .selectFrom("promo_codes")
        .select("times_redeemed")
        .where("code", "=", "MAXEDOUT")
        .executeTakeFirstOrThrow();
      expect(code.times_redeemed).toBe(50);
    });
  });

  describe("409 PRICE_CHANGED: never charge a total the family didn't see", () => {
    it("when the expected total is not the server's total", async () => {
      const before = await snapshot();
      const { status, error } = await bookError({ ...designExample, expectedTotalCents: 14_000 });
      expect(status).toBe(409);
      expect(error).toEqual({
        code: "PRICE_CHANGED",
        message: "The total is now $144.00. Please check your booking and try again.",
      });
      expect(await snapshot()).toEqual(before);
    });

    it("when a price went up after the family's quote", async () => {
      await testDb
        .updateTable("products")
        .set({ unit_price_cents: 1_600 })
        .where("code", "=", "DAY_PASS_ADULT")
        .execute();
      const { status, error } = await bookError(designExample);
      expect(status).toBe(409);
      // 16,000 + 2 x 100 = 16,200, less 10% = 14,580
      expect(error.message).toContain("$145.80");
    });
  });

  describe("422 BOOKING_INVALID: booking rules, each at its path", () => {
    it("lists every problem and writes nothing", async () => {
      const before = await snapshot();
      const { status, error } = await bookError({
        booker: { ...booker, ageYears: 17 },
        attendees: [
          person("Asha Patel", 40, "DAY_PASS_ADULT"),
          { ...person("Dev Patel", 9, "DAY_PASS_CHILD"), phone: "214 555 0199" },
        ],
        promoCode: "KIDSFREE",
        expectedTotalCents: 1_500,
      });

      expect(status).toBe(422);
      expect(error.code).toBe("BOOKING_INVALID");
      expect(error.details?.map((d) => `${d.code ?? ""} @ ${d.path}`)).toEqual([
        "BOOKER_TOO_YOUNG @ booker.ageYears",
        "PHONE_NOT_ALLOWED @ attendees[1].phone",
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it("a refused promo code blocks the booking", async () => {
      const { status, error } = await bookError(
        { ...designExample, promoCode: "EXPIRED5", expectedTotalCents: 15_500 },
        { now: new Date("2026-12-01T06:00:00Z") },
      );
      expect(status).toBe(422);
      expect(error.details).toEqual([
        { code: "PROMO_EXPIRED", path: "promoCode", message: "This code expired on 30 Nov." },
      ]);
    });

    it("a sold-out product is refused before any write", async () => {
      const { status, error } = await bookError({
        booker,
        attendees: [
          { fullName: "Asha Patel", ageYears: 40, entry: { productCode: "ALL_DAY_PASS_ADULT" } },
        ],
        expectedTotalCents: 6_000,
      });
      expect(status).toBe(422);
      expect(error.details?.[0]).toMatchObject({
        code: "SOLD_OUT",
        path: "attendees[0].entry.productCode",
      });
    });

    it("during the festival, a day that has passed can't be booked", async () => {
      const { status, error } = await bookError(
        {
          booker,
          attendees: [person("Asha Patel", 40, "DAY_PASS_ADULT", ["2026-12-11"])],
          expectedTotalCents: 1_500,
        },
        { now: new Date("2026-12-12T18:00:00Z") },
      );
      expect(status).toBe(422);
      expect(error.details?.[0]?.code).toBe("DAY_IN_PAST");
    });
  });

  describe("400 INVALID_REQUEST", () => {
    it.each([
      ["missing", null],
      ["not a UUID", "retry-1"],
    ])("when the Idempotency-Key is %s", async (_, key) => {
      const { status, error } = await bookError(designExample, { key });
      expect(status).toBe(400);
      expect(error.details).toEqual([
        { path: "headers.Idempotency-Key", message: "Send a UUID in the Idempotency-Key header." },
      ]);
    });

    it("when the client sends a price or a status", async () => {
      const { status, error } = await bookError({
        ...designExample,
        totalCents: 0,
        status: "confirmed",
      });
      expect(status).toBe(400);
      expect(error.details?.map((d) => d.path)).toEqual(["totalCents", "status"]);
    });

    it("when contact details are missing or invalid, each field is listed", async () => {
      const { status, error } = await bookError({
        ...designExample,
        booker: { ...booker, email: "asha@", phone: "12" },
        attendees: [{ fullName: " ", ageYears: 40, entry: null }],
      });
      expect(status).toBe(400);
      expect(error.details?.map((d) => d.path)).toEqual([
        "booker.email",
        "booker.phone",
        "attendees[0].fullName",
      ]);
    });

    it("when the expected total is missing", async () => {
      const withoutTotal = { ...designExample, expectedTotalCents: undefined };
      const { status, error } = await bookError(withoutTotal);
      expect(status).toBe(400);
      expect(error.details?.map((d) => d.path)).toEqual(["expectedTotalCents"]);
    });
  });

  describe("other errors", () => {
    it("415 for a non-JSON body", async () => {
      const { status } = await book(designExample, { headers: { "content-type": "text/plain" } });
      expect(status).toBe(415);
    });

    it("404 for an unknown event, with nothing written", async () => {
      const before = await snapshot();
      const { status } = await book(designExample, { slug: "nope-2026" });
      expect(status).toBe(404);
      expect(await snapshot()).toEqual(before);
    });
  });
});

function line(
  productCode: string,
  productName: string,
  day: string | null,
  quantity: number,
  unitPriceCents: number,
) {
  return {
    productCode,
    productName,
    day,
    quantity,
    unitPriceCents,
    lineTotalCents: unitPriceCents * quantity,
  };
}
