import { CatalogResponse, ErrorResponse } from "@ticketing/contracts";
import { sql } from "kysely";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/events/[slug]/catalog/route";
import { reseed, testDb } from "./support/db";

const SLUG = "sharad-utsav-2026";
const BEFORE_FESTIVAL = new Date("2026-11-25T18:00:00Z");
const DURING_FESTIVAL = new Date("2026-12-12T18:00:00Z"); // noon, 12 Dec, Allen

async function getCatalog(slug: string, now = BEFORE_FESTIVAL) {
  vi.setSystemTime(now);
  const response = await GET(new Request(`http://localhost/api/events/${slug}/catalog`), {
    params: Promise.resolve({ slug }),
  });
  const text = await response.text();
  return { response, text, json: JSON.parse(text) as unknown };
}

async function getOk(now = BEFORE_FESTIVAL) {
  const { response, json } = await getCatalog(SLUG, now);
  expect(response.status).toBe(200);
  return CatalogResponse.parse(json);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await testDb.destroy();
});

describe("GET /api/events/:slug/catalog", () => {
  describe("200: the seeded festival", () => {
    it("returns the event, its days and its age rules", async () => {
      const { event } = await getOk();
      expect(event).toEqual({
        slug: SLUG,
        name: "Sharad Utsav 2026",
        venue: "Radha Krishna Temple, Allen, Texas",
        timezone: "America/Chicago",
        currency: "USD",
        holdMinutes: 15,
        days: ["2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13", "2026-12-14"].map(
          (date) => ({ date, bookable: true }),
        ),
        ageRules: {
          referenceDate: "2026-12-10",
          childMinAge: 5,
          adultMinAge: 12,
          bookerMinAge: 18,
        },
      });
    });

    it("lists every active product in display order with its price in cents", async () => {
      const { products } = await getOk();
      expect(products.map((p) => [p.code, p.kind, p.dayScope, p.unitPriceCents])).toEqual([
        ["DAY_PASS_ADULT", "entry", "per_day", 1500],
        ["DAY_PASS_CHILD", "entry", "per_day", 800],
        ["ALL_DAY_PASS_ADULT", "entry", "whole_event", 6000],
        ["ALL_DAY_PASS_CHILD", "entry", "whole_event", 3000],
        ["FAMILY_PASS", "entry", "per_day", 4000],
        ["DANDIYA_STICKS", "extra", "whole_event", 500],
        ["DINNER_PLATE", "extra", "per_day", 1200],
        ["GARBA_WORKSHOP", "extra", "per_day", 2000],
      ]);
    });

    it("describes each product's rules as data", async () => {
      const { products } = await getOk();
      const byCode = new Map(products.map((p) => [p.code, p]));

      expect(byCode.get("FAMILY_PASS")).toMatchObject({ admits: { adults: 2, children: 2 } });
      expect(byCode.get("DAY_PASS_CHILD")).toMatchObject({ admits: { adults: 0, children: 1 } });
      expect(byCode.get("DANDIYA_STICKS")).toMatchObject({
        maxPerBooking: 20,
        cappedByDailyHeadcount: false,
        availableDays: [],
      });
      expect(byCode.get("DINNER_PLATE")).toMatchObject({
        maxPerBooking: null,
        cappedByDailyHeadcount: true,
      });
      expect(byCode.get("GARBA_WORKSHOP")?.availableDays).toEqual(["2026-12-11", "2026-12-13"]);
      expect(byCode.get("ALL_DAY_PASS_CHILD")?.availableDays).toHaveLength(5);
    });

    it("shows the sold-out All-Day Adult pass as sold out, everything else on sale", async () => {
      const { products } = await getOk();
      expect(Object.fromEntries(products.map((p) => [p.code, p.availability]))).toEqual({
        DAY_PASS_ADULT: "on_sale",
        DAY_PASS_CHILD: "on_sale",
        ALL_DAY_PASS_ADULT: "sold_out",
        ALL_DAY_PASS_CHILD: "on_sale",
        FAMILY_PASS: "on_sale",
        DANDIYA_STICKS: "on_sale",
        DINNER_PLATE: "on_sale",
        GARBA_WORKSHOP: "on_sale",
      });
    });

    it("may be cached by the CDN for a short time only", async () => {
      const { response } = await getCatalog(SLUG);
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
      );
      expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    });
  });

  describe("200: during the festival (12 Dec)", () => {
    it("marks past days as not bookable", async () => {
      const { event } = await getOk(DURING_FESTIVAL);
      expect(event.days.filter((d) => !d.bookable).map((d) => d.date)).toEqual([
        "2026-12-10",
        "2026-12-11",
      ]);
    });

    it("closes sales of whole-event passes", async () => {
      const { products } = await getOk(DURING_FESTIVAL);
      const closed = products.filter((p) => p.availability === "sale_closed").map((p) => p.code);
      expect(closed).toEqual(["ALL_DAY_PASS_ADULT", "ALL_DAY_PASS_CHILD"]);
    });
  });

  describe("200: reflects the database, not code", () => {
    afterEach(reseed);

    it("a product at zero stock shows as sold out", async () => {
      await sql`UPDATE inventory SET remaining = 0
                WHERE product_id = (SELECT id FROM products WHERE code = 'FAMILY_PASS')`.execute(
        testDb,
      );
      const { products } = await getOk();
      expect(products.find((p) => p.code === "FAMILY_PASS")?.availability).toBe("sold_out");
    });

    it("a deactivated product disappears", async () => {
      await testDb
        .updateTable("products")
        .set({ is_active: false })
        .where("code", "=", "DINNER_PLATE")
        .execute();
      const { products } = await getOk();
      expect(products.map((p) => p.code)).not.toContain("DINNER_PLATE");
    });

    it("a new price or name shows immediately", async () => {
      await testDb
        .updateTable("products")
        .set({ unit_price_cents: 1700, display_name: "Day Pass (Adult)" })
        .where("code", "=", "DAY_PASS_ADULT")
        .execute();
      const { products } = await getOk();
      expect(products[0]).toMatchObject({ name: "Day Pass (Adult)", unitPriceCents: 1700 });
    });

    it("only returns the requested event's products", async () => {
      const other = await testDb
        .insertInto("events")
        .values({
          slug: "diwali-2026",
          name: "Diwali 2026",
          venue: "Allen",
          timezone: "America/Chicago",
          age_reference_date: "2026-11-08",
          child_min_age: 5,
          adult_min_age: 12,
          booker_min_age: 18,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await testDb
        .insertInto("products")
        .values({
          event_id: other.id,
          code: "DIYA_KIT",
          display_name: "Diya Kit",
          kind: "extra",
          day_scope: "whole_event",
          unit_price_cents: 900,
        })
        .execute();

      const { products } = await getOk();
      expect(products.map((p) => p.code)).not.toContain("DIYA_KIT");
    });
  });

  describe("never exposes internal data", () => {
    it("has no promo codes, database ids or stock counts", async () => {
      const { text } = await getCatalog(SLUG);
      for (const code of ["SEVA10", "FLAT20", "KIDSFREE", "EXPIRED5", "MAXEDOUT"]) {
        expect(text).not.toContain(code);
      }
      expect(text).not.toMatch(/promo/i);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(text).not.toMatch(/remaining|inventory/);
      // Seeded stock levels that would otherwise be easy to spot.
      expect(text).not.toMatch(/\b(380|260|140|95|900|1700)\b/);
    });
  });

  describe("404 EVENT_NOT_FOUND", () => {
    it("for a slug that matches no event", async () => {
      const { response, json } = await getCatalog("navratri-2030");
      expect(response.status).toBe(404);
      expect(ErrorResponse.parse(json)).toEqual({
        error: { code: "EVENT_NOT_FOUND", message: "We couldn't find that event." },
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it.each([
      "Sharad-Utsav-2026",
      "sharad_utsav_2026",
      "../health",
      "x' OR '1'='1",
      "%00",
      "a".repeat(200),
    ])("for a malformed slug %j, the same way", async (slug) => {
      const { response, json } = await getCatalog(slug);
      expect(response.status).toBe(404);
      expect(ErrorResponse.parse(json).error.code).toBe("EVENT_NOT_FOUND");
    });
  });
});
