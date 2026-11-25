import { randomUUID } from "node:crypto";
import type { BookingRequestInput } from "@ticketing/contracts";
import { sql } from "kysely";
import { vi } from "vitest";
import { GET } from "@/app/api/bookings/[id]/route";
import { POST } from "@/app/api/events/[slug]/bookings/route";
import { testDb } from "./db";
import { BEFORE_FESTIVAL, call, type CallOptions } from "./http";

/** POSTs a booking with its own Idempotency-Key unless one is given. */
export function book(
  json: unknown,
  options: Omit<CallOptions, "json"> & { key?: string | null } = {},
) {
  const { key = randomUUID(), headers, ...rest } = options;
  return call(POST, "bookings", {
    json,
    ...rest,
    headers: { ...(key === null ? {} : { "idempotency-key": key }), ...headers },
  });
}

export const booker = {
  fullName: "Asha Patel",
  email: "asha.patel@example.com",
  phone: "+1 214-555-0100",
  ageYears: 40,
};

export const person = (
  fullName: string,
  ageYears: number,
  productCode: string | null,
  days: string[] = ["2026-12-12"],
) => ({
  fullName,
  ageYears,
  entry: productCode === null ? null : { productCode, days },
});

/** The design note's family of six: Family Pass, grandparent on two days, a toddler, extras. */
export const designExample: BookingRequestInput = {
  booker,
  attendees: [
    person("Asha Patel", 40, "FAMILY_PASS"),
    person("Raj Patel", 42, "FAMILY_PASS"),
    person("Dev Patel", 9, "FAMILY_PASS"),
    person("Isha Patel", 7, "FAMILY_PASS"),
    person("Kamla Patel", 68, "DAY_PASS_ADULT", ["2026-12-12", "2026-12-13"]),
    person("Mira Patel", 2, null),
  ],
  extras: [
    { productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 5 },
    { productCode: "GARBA_WORKSHOP", day: "2026-12-13", quantity: 1 },
    { productCode: "DANDIYA_STICKS", quantity: 2 },
  ],
  promoCode: "SEVA10",
  expectedTotalCents: 14_400,
};

/** Stock left per product code. */
export async function stock(): Promise<Record<string, number>> {
  const rows = await testDb
    .selectFrom("inventory as i")
    .innerJoin("products as p", "p.id", "i.product_id")
    .select(["p.code", "i.remaining"])
    .execute();
  return Object.fromEntries(rows.map((row) => [row.code, row.remaining]));
}

/** Everything a booking attempt could change, to prove a refused one changed nothing. */
export async function snapshot() {
  const { rows } = await sql<{ bookings: string; attendees: string; redeemed: string }>`
    SELECT (SELECT count(*) FROM bookings)::text AS bookings,
           (SELECT count(*) FROM attendees)::text AS attendees,
           (SELECT sum(times_redeemed) FROM promo_codes)::text AS redeemed`.execute(testDb);
  return { ...rows[0], stock: await stock() };
}

export async function setStock(code: string, remaining: number): Promise<void> {
  await sql`UPDATE inventory SET remaining = ${remaining}
            WHERE product_id = (SELECT id FROM products WHERE code = ${code})`.execute(testDb);
}

/** GET /api/bookings/:id with the clock set to `now`. */
export async function getBooking(id: string, now: Date = BEFORE_FESTIVAL) {
  vi.setSystemTime(now);
  const response = await GET(new Request(`http://localhost/api/bookings/${id}`), {
    params: Promise.resolve({ id }),
  });
  const text = await response.text();
  return { response, status: response.status, text, json: JSON.parse(text) as unknown };
}

/** `minutes` after `from`. */
export const after = (from: Date, minutes: number, seconds = 0) =>
  new Date(from.getTime() + (minutes * 60 + seconds) * 1000);

export async function promoUses(code: string): Promise<number> {
  const row = await testDb
    .selectFrom("promo_codes")
    .select("times_redeemed")
    .where("code", "=", code)
    .executeTakeFirstOrThrow();
  return row.times_redeemed;
}
