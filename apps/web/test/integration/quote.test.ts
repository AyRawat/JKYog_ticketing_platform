import { ErrorResponse, QuoteResponse, type QuoteRequestInput } from "@ticketing/contracts";
import { sql } from "kysely";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/[slug]/quote/route";
import { reseed, testDb } from "./support/db";
import { call, DURING_FESTIVAL, type CallOptions } from "./support/http";

const quote = (json: unknown, options: Omit<CallOptions, "json"> = {}) =>
  call(POST, "quote", { json, ...options });

async function quoteOk(cart: QuoteRequestInput, options: Omit<CallOptions, "json"> = {}) {
  const result = await quote(cart, options);
  expect(result.status).toBe(200);
  return QuoteResponse.parse(result.json);
}

async function quoteError(json: unknown, options: Omit<CallOptions, "json"> = {}) {
  const result = await quote(json, options);
  return {
    status: result.status,
    body: ErrorResponse.parse(result.json),
    response: result.response,
  };
}

const booker = { ageYears: 40 };
const dayPass = (code: string, ageYears: number, days = ["2026-12-12"]) => ({
  ageYears,
  entry: { productCode: code, days },
});
const adultDay = (days?: string[]) => dayPass("DAY_PASS_ADULT", 35, days);
const childDay = (days?: string[]) => dayPass("DAY_PASS_CHILD", 8, days);
const family = (ageYears: number) => dayPass("FAMILY_PASS", ageYears);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await testDb.destroy();
});

describe("POST /api/events/:slug/quote", () => {
  describe("200: prices the cart from the database", () => {
    it("the design note example: family of 6 with extras and SEVA10 comes to $144.00", async () => {
      const q = await quoteOk({
        booker,
        attendees: [
          family(38),
          family(36),
          family(9),
          family(7),
          dayPass("DAY_PASS_ADULT", 68, ["2026-12-12", "2026-12-13"]),
          { ageYears: 2, entry: null },
        ],
        extras: [
          { productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 5 },
          { productCode: "GARBA_WORKSHOP", day: "2026-12-13", quantity: 1 },
          { productCode: "DANDIYA_STICKS", quantity: 2 },
        ],
        promoCode: "seva10",
      });

      expect(q).toEqual({
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
        promo: {
          status: "applied",
          code: "SEVA10",
          discountCents: 1_600,
          message: expect.any(String) as string,
        },
        issues: [],
        notices: [],
        canBook: true,
      });
    });

    it("the brief's KIDSFREE example: $79 comes to $55", async () => {
      const q = await quoteOk({
        booker,
        attendees: [
          family(38),
          family(36),
          family(9),
          family(7),
          childDay(),
          childDay(),
          childDay(),
          adultDay(),
        ],
        promoCode: "KIDSFREE",
      });
      expect([q.subtotalCents, q.discountCents, q.totalCents]).toEqual([7_900, 2_400, 5_500]);
    });

    it("FLAT20 never takes the total below zero", async () => {
      const q = await quoteOk({ booker, attendees: [adultDay()], promoCode: "FLAT20" });
      expect([q.subtotalCents, q.discountCents, q.totalCents]).toEqual([1_500, 1_500, 0]);
      expect(q.canBook).toBe(true);
    });

    it("suggests a cheaper way to buy the same tickets without changing the cart", async () => {
      const q = await quoteOk({
        booker,
        attendees: [adultDay(), adultDay(), childDay(), childDay()],
      });
      expect(q.totalCents).toBe(4_600);
      expect(q.notices).toEqual([
        expect.objectContaining({ code: "CHEAPER_BUNDLE_AVAILABLE", savingsCents: 600 }),
      ]);
      expect(q.canBook).toBe(true);
    });

    it("is never cached", async () => {
      const { response } = await quote({ attendees: [adultDay()] });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });
  });

  describe("200: booking-rule problems come back as issues, each at its path", () => {
    it("reports every problem, prices the valid parts, and can't be booked", async () => {
      const q = await quoteOk({
        booker: { ageYears: 16 },
        attendees: [
          adultDay(),
          dayPass("DAY_PASS_CHILD", 30),
          { ageYears: 8, entry: { productCode: "DAY_PASS_CHILD", days: [] } },
        ],
        extras: [{ productCode: "DANDIYA_STICKS", quantity: 25 }],
      });
      expect(q.issues.map((i) => `${i.code} @ ${i.path}`)).toEqual([
        "BOOKER_TOO_YOUNG @ booker.ageYears",
        "AGE_TICKET_MISMATCH @ attendees[1].entry.productCode",
        "DAYS_REQUIRED @ attendees[2].entry.days",
        "QUANTITY_LIMIT @ extras[0].quantity",
      ]);
      expect(q.totalCents).toBe(1_500);
      expect(q.canBook).toBe(false);
    });

    it("needs a booker before it can be booked", async () => {
      const q = await quoteOk({ attendees: [adultDay()] });
      expect(q.issues).toEqual([]);
      expect(q.canBook).toBe(false);
    });

    it("dinners can't outnumber the ticketed people that day", async () => {
      const q = await quoteOk({
        booker,
        attendees: [adultDay(), { ageYears: 3, entry: null }],
        extras: [{ productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 2 }],
      });
      expect(q.issues.map((i) => i.code)).toEqual(["EXCEEDS_DAILY_HEADCOUNT"]);
    });

    it("the sold-out All-Day Adult pass is reported, not priced", async () => {
      const q = await quoteOk({
        booker,
        attendees: [{ ageYears: 40, entry: { productCode: "ALL_DAY_PASS_ADULT" } }],
      });
      expect(q.issues).toEqual([
        {
          code: "SOLD_OUT",
          path: "attendees[0].entry.productCode",
          message: "All-Day Pass – Adult is sold out.",
        },
      ]);
    });

    it("an unknown product code is an issue, not an error", async () => {
      const q = await quoteOk({ booker, attendees: [dayPass("VIP_PASS", 35)] });
      expect(q.issues.map((i) => `${i.code} @ ${i.path}`)).toEqual([
        "UNKNOWN_PRODUCT @ attendees[0].entry.productCode",
      ]);
    });
  });

  describe("200: uses the event's clock", () => {
    it("EXPIRED5 works on 30 Nov and is refused from 1 Dec in Allen", async () => {
      const cart = { booker, attendees: [adultDay()], promoCode: "EXPIRED5" };
      const lastDay = await quoteOk(cart, { now: new Date("2026-12-01T05:59:59Z") });
      expect(lastDay.promo).toMatchObject({ status: "applied", discountCents: 500 });

      const after = await quoteOk(cart, { now: new Date("2026-12-01T06:00:00Z") });
      expect(after.promo).toMatchObject({ status: "rejected", reason: "PROMO_EXPIRED" });
      expect(after.canBook).toBe(false);
    });

    it("during the festival, past days and whole-event passes can't be bought", async () => {
      const q = await quoteOk(
        {
          booker,
          attendees: [
            adultDay(["2026-12-11"]),
            { ageYears: 8, entry: { productCode: "ALL_DAY_PASS_CHILD" } },
          ],
        },
        { now: DURING_FESTIVAL },
      );
      expect(q.issues.map((i) => i.code)).toEqual(["DAY_IN_PAST", "SALE_CLOSED"]);
    });
  });

  describe("200: promo codes", () => {
    it.each([
      ["NOPE", "PROMO_NOT_FOUND"],
      ["MAXEDOUT", "PROMO_EXHAUSTED"],
      ["KIDSFREE", "PROMO_NOT_APPLICABLE"],
    ])("%s is refused with %s and blocks booking", async (promoCode, reason) => {
      const q = await quoteOk({ booker, attendees: [adultDay()], promoCode });
      expect(q.promo).toMatchObject({ status: "rejected", reason });
      expect(q.discountCents).toBe(0);
      expect(q.canBook).toBe(false);
    });

    it("an empty code means no code", async () => {
      const q = await quoteOk({ booker, attendees: [adultDay()], promoCode: "  " });
      expect(q.promo).toBeNull();
      expect(q.canBook).toBe(true);
    });
  });

  describe("200: reads live data", () => {
    afterEach(reseed);

    it("a price change applies to the next quote", async () => {
      await testDb
        .updateTable("products")
        .set({ unit_price_cents: 1700 })
        .where("code", "=", "DAY_PASS_ADULT")
        .execute();
      expect((await quoteOk({ booker, attendees: [adultDay()] })).totalCents).toBe(1_700);
    });

    it("stock that runs short is reported with what's left", async () => {
      await sql`UPDATE inventory SET remaining = 1
                WHERE product_id = (SELECT id FROM products WHERE code = 'DAY_PASS_CHILD')`.execute(
        testDb,
      );
      const q = await quoteOk({ booker, attendees: [childDay(), childDay()] });
      expect(q.issues).toEqual([
        expect.objectContaining({
          code: "INSUFFICIENT_STOCK",
          path: "attendees[0].entry.productCode",
        }),
      ]);
    });

    it("a switched-off promo code is refused", async () => {
      await testDb
        .updateTable("promo_codes")
        .set({ is_active: false })
        .where("code", "=", "SEVA10")
        .execute();
      const q = await quoteOk({ booker, attendees: [adultDay()], promoCode: "SEVA10" });
      expect(q.promo).toMatchObject({ status: "rejected", reason: "PROMO_INACTIVE" });
    });
  });

  describe("changes nothing", () => {
    it("leaves stock, promo usage and bookings untouched", async () => {
      const snapshot = () =>
        sql<{ stock: string; redeemed: string; bookings: string }>`
          SELECT (SELECT sum(remaining) FROM inventory)::text AS stock,
                 (SELECT sum(times_redeemed) FROM promo_codes)::text AS redeemed,
                 (SELECT count(*) FROM bookings)::text AS bookings`.execute(testDb);
      const before = (await snapshot()).rows;
      await quoteOk({ booker, attendees: [adultDay(), childDay()], promoCode: "SEVA10" });
      expect((await snapshot()).rows).toEqual(before);
    });
  });

  describe("never exposes internal data", () => {
    it("has no door list, database ids or stock counts", async () => {
      const { text } = await quote({ booker, attendees: [adultDay()] });
      expect(text).not.toMatch(/admissions|attendeeIndex|remaining/);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    });
  });

  describe("400 INVALID_REQUEST", () => {
    it("when the client sends a price: the server decides prices", async () => {
      const { status, body } = await quoteError({
        attendees: [{ ...adultDay(), entry: { ...adultDay().entry, unitPriceCents: 1 } }],
        totalCents: 0,
      });
      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: "INVALID_REQUEST",
        message: "Some fields are missing or have the wrong type.",
        details: [
          { path: "attendees[0].entry.unitPriceCents", message: "This field is not allowed." },
          { path: "totalCents", message: "This field is not allowed." },
        ],
      });
    });

    it("lists every field with the wrong type", async () => {
      const { status, body } = await quoteError({
        attendees: [{ ageYears: "8", entry: null }],
        extras: [{ productCode: "DINNER_PLATE", day: "12 Dec", quantity: 1 }],
      });
      expect(status).toBe(400);
      expect(body.error.details?.map((d) => d.path)).toEqual([
        "attendees[0].ageYears",
        "extras[0].day",
      ]);
    });

    it.each([
      ["not JSON", "{attendees:"],
      ["empty", ""],
    ])("when the body is %s", async (_, rawBody) => {
      const { status, body } = await quoteError(undefined, { rawBody });
      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: "INVALID_REQUEST",
        message: "The request body is not valid JSON.",
      });
    });

    it.each([null, [], "cart"])("when the body is %j", async (json) => {
      const { status } = await quoteError(json);
      expect(status).toBe(400);
    });

    it("when there are more attendees than the limit", async () => {
      const { status, body } = await quoteError({
        attendees: Array.from({ length: 51 }, adultDay),
      });
      expect(status).toBe(400);
      expect(body.error.details?.[0]?.path).toBe("attendees");
    });
  });

  describe("415 UNSUPPORTED_MEDIA_TYPE", () => {
    it.each([
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/jsonp",
    ])("for %s, so a cross-site form can't post here", async (contentType) => {
      const { status, body, response } = await quoteError(
        { attendees: [adultDay()] },
        { headers: { "content-type": contentType } },
      );
      expect(status).toBe(415);
      expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("accepts application/json with a charset", async () => {
      const result = await quote(
        { attendees: [adultDay()] },
        { headers: { "content-type": "Application/JSON; charset=utf-8" } },
      );
      expect(result.status).toBe(200);
    });
  });

  describe("413 PAYLOAD_TOO_LARGE", () => {
    const big = JSON.stringify({ attendees: [], promoCode: null, padding: "x".repeat(70_000) });

    it("for a body over 64 KB", async () => {
      const { status, body } = await quoteError(undefined, { rawBody: big });
      expect(status).toBe(413);
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("for a streamed body with no Content-Length, stopping once the limit is passed", async () => {
      let sent = 0;
      const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 1;
          if (sent > 100) controller.close();
          else controller.enqueue(chunk);
        },
      });
      const { status } = await quoteError(undefined, { rawBody: stream });
      expect(status).toBe(413);
      // 64 KB is 4 chunks; it gives up long before reading all 100 (1.6 MB).
      expect(sent).toBeLessThan(10);
    });
  });

  describe("404 EVENT_NOT_FOUND", () => {
    it("for an unknown event", async () => {
      const { status, body } = await quoteError({ attendees: [adultDay()] }, { slug: "nope-2026" });
      expect(status).toBe(404);
      expect(body.error.code).toBe("EVENT_NOT_FOUND");
    });

    it("for a malformed slug, before the body is even read", async () => {
      const { status } = await quoteError(undefined, { slug: "../catalog", rawBody: "not json" });
      expect(status).toBe(404);
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
