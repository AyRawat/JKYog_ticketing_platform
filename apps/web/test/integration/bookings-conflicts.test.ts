import { ErrorResponse } from "@ticketing/contracts";
import type * as LoadCatalog from "@/server/catalog/load-catalog";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { book, booker, designExample, person, setStock, snapshot } from "./support/bookings";
import { reseed, testDb } from "./support/db";

// Makes the catalog read look stale: it shows plenty of stock and unused promo codes, as if
// another booking took the last units between the price check and the write. This drives the
// guarded updates inside the transaction, deterministically.
vi.mock("@/server/catalog/load-catalog", async (importOriginal) => {
  const original = await importOriginal<typeof LoadCatalog>();
  return {
    ...original,
    loadEventCatalog: async (...args: Parameters<typeof original.loadEventCatalog>) => {
      const loaded = await original.loadEventCatalog(...args);
      if (!loaded) return loaded;
      const { catalog } = loaded;
      return {
        ...loaded,
        catalog: {
          ...catalog,
          products: catalog.products.map((product) => ({ ...product, remaining: 10_000 })),
          promos: catalog.promos.map((promo) => ({ ...promo, timesRedeemed: 0 })),
        },
      };
    },
  };
});

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

describe("POST /api/events/:slug/bookings when the last units go between check and write", () => {
  it("409 SOLD_OUT, and the whole booking rolls back: no row, no stock taken, no code used", async () => {
    // The family needs 3 Garba places; only 2 are really left.
    const cart = {
      booker,
      attendees: ["A", "B", "C"].map((n) =>
        person(`Guest ${n}`, 30, "DAY_PASS_ADULT", ["2026-12-13"]),
      ),
      extras: [
        { productCode: "DINNER_PLATE", day: "2026-12-13", quantity: 3 },
        { productCode: "GARBA_WORKSHOP", day: "2026-12-13", quantity: 3 },
      ],
      promoCode: "SEVA10",
      // 3 x (15 + 12 + 20) = 141.00, less 10% = 126.90
      expectedTotalCents: 12_690,
    };
    const before = await snapshot();

    const result = await book(cart);

    expect(result.status).toBe(409);
    expect(ErrorResponse.parse(result.json).error).toEqual({
      code: "SOLD_OUT",
      message: "Sorry, Garba Workshop has just sold out. Please change your booking.",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("409 PROMO_UNAVAILABLE when the code's last use is gone, and the stock it took is put back", async () => {
    const cart = { ...designExample, promoCode: "MAXEDOUT", expectedTotalCents: 13_600 };
    const before = await snapshot();

    const result = await book(cart);

    expect(result.status).toBe(409);
    expect(ErrorResponse.parse(result.json).error).toEqual({
      code: "PROMO_UNAVAILABLE",
      message: "Sorry, the code MAXEDOUT can no longer be used. Please remove it and try again.",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("the last unit can still be booked: the guard is >=, not >", async () => {
    await setStock("GARBA_WORKSHOP", 1);
    const result = await book({
      booker,
      attendees: [person("Guest", 30, "DAY_PASS_ADULT", ["2026-12-13"])],
      extras: [{ productCode: "GARBA_WORKSHOP", day: "2026-12-13", quantity: 1 }],
      expectedTotalCents: 3_500,
    });
    expect(result.status).toBe(201);
  });
});
