import { describe, expect, it } from "vitest";
import { catalogAvailability } from "./availability";
import { BEFORE_FESTIVAL, DURING_FESTIVAL, makeCatalog } from "./test/fixtures";

const availability = (now: Date, remaining?: Record<string, number>) =>
  catalogAvailability(makeCatalog({ remaining }), now);

describe("catalog availability before the festival", () => {
  const result = availability(BEFORE_FESTIVAL);

  it("every festival day is bookable", () => {
    expect(result.today).toBe("2026-11-25");
    expect(result.days.every((day) => day.bookable)).toBe(true);
    expect(result.days.map((day) => day.date)).toEqual([
      "2026-12-10",
      "2026-12-11",
      "2026-12-12",
      "2026-12-13",
      "2026-12-14",
    ]);
  });

  it("everything is on sale except the sold-out All-Day Adult pass", () => {
    expect(Object.fromEntries(result.products)).toEqual({
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
});

describe("catalog availability during the festival (12 Dec)", () => {
  const result = availability(DURING_FESTIVAL);

  it("days before today can't be booked; today and later can", () => {
    expect(result.days).toEqual([
      { date: "2026-12-10", bookable: false },
      { date: "2026-12-11", bookable: false },
      { date: "2026-12-12", bookable: true },
      { date: "2026-12-13", bookable: true },
      { date: "2026-12-14", bookable: true },
    ]);
  });

  it("whole-event passes close once the festival starts; sale closed wins over sold out", () => {
    expect(result.products.get("ALL_DAY_PASS_CHILD")).toBe("sale_closed");
    expect(result.products.get("ALL_DAY_PASS_ADULT")).toBe("sale_closed");
  });

  it("souvenirs (whole-event extras) are still on sale", () => {
    expect(result.products.get("DANDIYA_STICKS")).toBe("on_sale");
  });

  it("Garba is still on sale while 13 Dec is ahead", () => {
    expect(result.products.get("GARBA_WORKSHOP")).toBe("on_sale");
  });
});

describe("edges", () => {
  it("a per-day product closes when its last day has passed", () => {
    // 14 Dec, Allen time: Garba's days (11 and 13 Dec) are both over.
    const result = availability(new Date("2026-12-14T18:00:00Z"));
    expect(result.products.get("GARBA_WORKSHOP")).toBe("sale_closed");
    expect(result.products.get("DAY_PASS_ADULT")).toBe("on_sale");
  });

  it("uses the event's date, not UTC: 9 Dec 11 pm in Allen is still before the festival", () => {
    const result = availability(new Date("2026-12-10T05:00:00Z"));
    expect(result.today).toBe("2026-12-09");
    expect(result.products.get("ALL_DAY_PASS_CHILD")).toBe("on_sale");
  });

  it("a product at zero stock is sold out", () => {
    expect(availability(BEFORE_FESTIVAL, { FAMILY_PASS: 0 }).products.get("FAMILY_PASS")).toBe(
      "sold_out",
    );
  });
});
