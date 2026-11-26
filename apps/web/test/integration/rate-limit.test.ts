import { ErrorResponse, QuoteResponse } from "@ticketing/contracts";
import { sql } from "kysely";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as quote } from "@/app/api/events/[slug]/quote/route";
import { after, book, booker, person } from "./support/bookings";
import { reseed, testDb } from "./support/db";
import { BEFORE_FESTIVAL, call } from "./support/http";

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

const from = (ip: string) => ({ "x-real-ip": ip });

const cart = (n: number) => ({
  booker,
  attendees: [person(`Guest ${String(n)}`, 40, "DAY_PASS_ADULT")],
  expectedTotalCents: 1500,
});

const quoteCart = {
  attendees: [{ ageYears: 40, entry: { productCode: "DAY_PASS_ADULT", days: ["2026-12-12"] } }],
};

const quoteWith = (promoCode: string | null, ip: string, now = BEFORE_FESTIVAL) =>
  call(quote, "quote", { json: { ...quoteCart, promoCode }, headers: from(ip), now });

describe("rate limits", () => {
  describe("bookings: 10 per visitor per 10 minutes", () => {
    it("refuses the 11th with 429 and Retry-After, and holds nothing for it", async () => {
      for (let n = 0; n < 10; n++) {
        expect((await book(cart(n), { headers: from("203.0.113.7") })).status).toBe(201);
      }
      const refused = await book(cart(10), { headers: from("203.0.113.7") });

      expect(refused.status).toBe(429);
      expect(ErrorResponse.parse(refused.json).error.code).toBe("RATE_LIMITED");
      expect(Number(refused.response.headers.get("Retry-After"))).toBeGreaterThan(0);
      const { rows } = await sql<{ n: string }>`SELECT count(*)::text AS n FROM bookings`.execute(
        testDb,
      );
      expect(rows[0]?.n).toBe("10");
    });

    it("counts each visitor separately", async () => {
      for (let n = 0; n < 10; n++) await book(cart(n), { headers: from("203.0.113.7") });
      expect((await book(cart(99), { headers: from("198.51.100.4") })).status).toBe(201);
    });

    it("lets the visitor book again once the window has passed", async () => {
      for (let n = 0; n < 11; n++) await book(cart(n), { headers: from("203.0.113.7") });
      const later = await book(cart(50), {
        headers: from("203.0.113.7"),
        now: after(BEFORE_FESTIVAL, 10),
      });
      expect(later.status).toBe(201);
    });

    it("never stores the visitor's IP address", async () => {
      await book(cart(0), { headers: from("203.0.113.7") });
      const { rows } = await sql<{ bucket: string }>`SELECT bucket FROM rate_limit_hits`.execute(
        testDb,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const { bucket } of rows) expect(bucket).not.toContain("203.0.113.7");
    });
  });

  describe("guessing promo codes: 10 codes that don't exist per 10 minutes", () => {
    it("then refuses any quote with a code, real ones included, until the window passes", async () => {
      for (let n = 0; n < 10; n++) {
        const { json } = await quoteWith(`GUESS${String(n)}`, "203.0.113.9");
        expect(QuoteResponse.parse(json).promo?.status).toBe("rejected");
      }
      const blocked = await quoteWith("SEVA10", "203.0.113.9");
      expect(blocked.status).toBe(429);
      expect(ErrorResponse.parse(blocked.json).error.message).toMatch(
        /codes tried that don't exist/,
      );

      const later = await quoteWith("SEVA10", "203.0.113.9", after(BEFORE_FESTIVAL, 10));
      expect(QuoteResponse.parse(later.json).promo?.status).toBe("applied");
    });

    it("doesn't stop quotes without a code, so the form keeps working", async () => {
      for (let n = 0; n < 11; n++) await quoteWith(`GUESS${String(n)}`, "203.0.113.9");
      expect((await quoteWith(null, "203.0.113.9")).status).toBe(200);
    });

    it("doesn't count real codes, even rejected ones (expired, used up)", async () => {
      for (let n = 0; n < 12; n++) await quoteWith(n % 2 ? "MAXEDOUT" : "SEVA10", "203.0.113.9");
      expect((await quoteWith("SEVA10", "203.0.113.9")).status).toBe(200);
    });
  });

  it("quotes: refuses the 121st in a minute from one visitor", async () => {
    for (let n = 0; n < 120; n++) {
      expect((await quoteWith(null, "203.0.113.11")).status).toBe(200);
    }
    expect((await quoteWith(null, "203.0.113.11")).status).toBe(429);
  });

  it("does not limit requests with no visitor address (local runs)", async () => {
    for (let n = 0; n < 12; n++) expect((await book(cart(n))).status).toBe(201);
  });
});
