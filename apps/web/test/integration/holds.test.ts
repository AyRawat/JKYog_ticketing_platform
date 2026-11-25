import { BookingResponse, QuoteResponse } from "@ticketing/contracts";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postQuote } from "@/app/api/events/[slug]/quote/route";
import {
  after,
  book,
  booker,
  designExample,
  getBooking,
  person,
  promoUses,
  stock,
} from "./support/bookings";
import { reseed, testDb } from "./support/db";
import { BEFORE_FESTIVAL, call } from "./support/http";

// Bookings are made at BEFORE_FESTIVAL and held for the event's 15 minutes.
const HELD_UNTIL = after(BEFORE_FESTIVAL, 15);

const garbaFor = (name: string, quantity: number) => ({
  booker,
  attendees: Array.from({ length: quantity }, (_, n) =>
    person(`${name} ${n}`, 30, "DAY_PASS_ADULT", ["2026-12-13"]),
  ),
  extras: [{ productCode: "GARBA_WORKSHOP", day: "2026-12-13", quantity }],
  expectedTotalCents: quantity * 3_500,
});

async function bookAt(now: Date, json: unknown) {
  const result = await book(json, { now });
  expect(result.status, result.text).toBe(201);
  return BookingResponse.parse(result.json);
}

const statusOf = async (id: string, now: Date) =>
  BookingResponse.parse((await getBooking(id, now)).json).status;

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

describe("holds on unpaid bookings", () => {
  it("hold tickets for 15 minutes, then expire and give back stock and the code use", async () => {
    const { id, holdExpiresAt } = await bookAt(BEFORE_FESTIVAL, designExample);
    expect(holdExpiresAt).toBe(HELD_UNTIL.toISOString());

    expect(await statusOf(id, after(BEFORE_FESTIVAL, 14, 59))).toBe("pending_payment");
    expect((await stock()).GARBA_WORKSHOP).toBe(1);
    expect(await promoUses("SEVA10")).toBe(1);

    expect(await statusOf(id, HELD_UNTIL)).toBe("expired");
    expect(await stock()).toMatchObject({
      GARBA_WORKSHOP: 2,
      FAMILY_PASS: 95,
      DAY_PASS_ADULT: 380,
      DINNER_PLATE: 1700,
      DANDIYA_STICKS: 900,
    });
    expect(await promoUses("SEVA10")).toBe(0);
  });

  it("are released once, however many requests see the expiry at the same time", async () => {
    const { id } = await bookAt(BEFORE_FESTIVAL, designExample);
    const later = after(BEFORE_FESTIVAL, 20);

    const statuses = await Promise.all(Array.from({ length: 6 }, () => statusOf(id, later)));

    expect(statuses).toEqual(Array.from({ length: 6 }, () => "expired"));
    expect((await stock()).GARBA_WORKSHOP).toBe(2);
    expect(await promoUses("SEVA10")).toBe(0);
  });

  it("an expired family's places can be booked by the next family", async () => {
    const first = await bookAt(BEFORE_FESTIVAL, garbaFor("First", 2));
    expect((await stock()).GARBA_WORKSHOP).toBe(0);

    // Before the hold runs out, the places are taken.
    const tooSoon = await book(garbaFor("Second", 2), { now: after(BEFORE_FESTIVAL, 10) });
    expect(tooSoon.status).toBe(422);

    // After it runs out, booking releases it first, then takes the places.
    await bookAt(after(BEFORE_FESTIVAL, 16), garbaFor("Second", 2));
    expect((await stock()).GARBA_WORKSHOP).toBe(0);
    expect(await statusOf(first.id, after(BEFORE_FESTIVAL, 16))).toBe("expired");
  });

  it("a quote after the hold runs out sees the stock back on sale", async () => {
    await bookAt(BEFORE_FESTIVAL, garbaFor("First", 2));
    const cart = {
      attendees: [{ ageYears: 30, entry: { productCode: "DAY_PASS_ADULT", days: ["2026-12-13"] } }],
      extras: [{ productCode: "GARBA_WORKSHOP", day: "2026-12-13", quantity: 1 }],
    };

    const held = await call(postQuote, "quote", { json: cart, now: after(BEFORE_FESTIVAL, 5) });
    expect(QuoteResponse.parse(held.json).issues.map((i) => i.code)).toEqual(["SOLD_OUT"]);

    const released = await call(postQuote, "quote", {
      json: cart,
      now: after(BEFORE_FESTIVAL, 15),
    });
    expect(QuoteResponse.parse(released.json).issues).toEqual([]);
  });

  it("only unpaid bookings expire: a confirmed booking keeps its tickets", async () => {
    const { id } = await bookAt(BEFORE_FESTIVAL, designExample);
    await testDb
      .updateTable("bookings")
      .set({ status: "confirmed", confirmed_at: BEFORE_FESTIVAL })
      .where("id", "=", id)
      .execute();

    expect(await statusOf(id, after(BEFORE_FESTIVAL, 60))).toBe("confirmed");
    expect((await stock()).GARBA_WORKSHOP).toBe(1);
    expect(await promoUses("SEVA10")).toBe(1);
  });

  it("reading one booking releases only that booking", async () => {
    const mine = await bookAt(BEFORE_FESTIVAL, garbaFor("Mine", 1));
    const theirs = await bookAt(BEFORE_FESTIVAL, garbaFor("Theirs", 1));

    expect(await statusOf(mine.id, after(BEFORE_FESTIVAL, 30))).toBe("expired");
    const other = await testDb
      .selectFrom("bookings")
      .select("status")
      .where("id", "=", theirs.id)
      .executeTakeFirstOrThrow();
    expect(other.status).toBe("pending_payment");
    expect((await stock()).GARBA_WORKSHOP).toBe(1);
  });
});
