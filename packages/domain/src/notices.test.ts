import { describe, expect, it } from "vitest";
import {
  adultDayPass,
  childDayPass,
  DURING_FESTIVAL,
  familyAdult,
  familyChild,
  FESTIVAL_DAYS,
  makeCatalog,
  quote,
} from "./test/fixtures";

const allDays = [...FESTIVAL_DAYS];

describe("cheaper Family Pass notice", () => {
  it("2 adults + 2 children on day passes for one day: a Family Pass saves $6", () => {
    const q = quote({
      attendees: [adultDayPass(), adultDayPass(), childDayPass(), childDayPass()],
    });
    expect(q.notices).toEqual([
      {
        code: "CHEAPER_BUNDLE_AVAILABLE",
        path: "attendees",
        savingsCents: 600,
        message:
          "Switching 2 adults and 2 children to Family Pass on 12 Dec would cost $40.00 instead of $46.00, saving $6.00.",
      },
    ]);
  });

  it("is advice only: the cart, total and canBook are unchanged", () => {
    const q = quote({
      attendees: [adultDayPass(), adultDayPass(), childDayPass(), childDayPass()],
    });
    expect(q.totalCents).toBe(4_600);
    expect(q.issues).toEqual([]);
    expect(q.canBook).toBe(true);
  });

  it("4 adults + 4 children on day passes: two Family Passes save $12", () => {
    const q = quote({
      attendees: [
        ...[1, 2, 3, 4].map(() => adultDayPass()),
        ...[1, 2, 3, 4].map(() => childDayPass()),
      ],
    });
    expect(q.notices.map((n) => n.savingsCents)).toEqual([1_200]);
  });

  it("one notice per day that could save", () => {
    const days = ["2026-12-12", "2026-12-13"];
    const q = quote({
      attendees: [adultDayPass(days), adultDayPass(days), childDayPass(days), childDayPass(days)],
    });
    expect(q.notices).toHaveLength(2);
  });

  it.each([
    ["2 adults + 1 child", [adultDayPass(), adultDayPass(), childDayPass()]],
    ["already on a Family Pass", [familyAdult(), familyAdult(), familyChild(), familyChild()]],
    [
      "on different days",
      [
        adultDayPass(["2026-12-12"]),
        adultDayPass(["2026-12-12"]),
        childDayPass(["2026-12-13"]),
        childDayPass(["2026-12-13"]),
      ],
    ],
  ])("none for %s", (_, attendees) => {
    expect(quote({ attendees }).notices).toEqual([]);
  });

  it("none when Family Passes are sold out", () => {
    const catalog = makeCatalog({ remaining: { FAMILY_PASS: 0 } });
    const q = quote(
      { attendees: [adultDayPass(), adultDayPass(), childDayPass(), childDayPass()] },
      { catalog },
    );
    expect(q.notices).toEqual([]);
  });
});

describe("cheaper all-day pass notice", () => {
  it("a child on day passes for all 5 days: the All-Day Child pass saves $10", () => {
    const q = quote({ attendees: [childDayPass(allDays)] });
    expect(q.notices).toEqual([
      {
        code: "CHEAPER_WHOLE_EVENT_PASS",
        path: "attendees[0].entry.productCode",
        savingsCents: 1_000,
        message:
          "All-Day Pass – Child covers every festival day for $30.00, less than $40.00 for 5 day passes. You'd save $10.00.",
      },
    ]);
  });

  it("4 child days ($32) is already more than the all-day pass ($30)", () => {
    const q = quote({ attendees: [childDayPass(allDays.slice(0, 4))] });
    expect(q.notices.map((n) => n.savingsCents)).toEqual([200]);
  });

  it("3 child days ($24) is cheaper than the all-day pass: no notice", () => {
    expect(quote({ attendees: [childDayPass(allDays.slice(0, 3))] }).notices).toEqual([]);
  });

  it("none for adults while the All-Day Adult pass is sold out", () => {
    expect(quote({ attendees: [adultDayPass(allDays)] }).notices).toEqual([]);
  });

  it("would suggest it to adults if it were back in stock", () => {
    const catalog = makeCatalog({ remaining: { ALL_DAY_PASS_ADULT: 10 } });
    const q = quote({ attendees: [adultDayPass(allDays)] }, { catalog });
    expect(q.notices.map((n) => n.savingsCents)).toEqual([1_500]);
  });

  it("none once the festival has started (all-day passes are off sale)", () => {
    const q = quote(
      { attendees: [childDayPass(["2026-12-12", "2026-12-13", "2026-12-14"])] },
      { now: DURING_FESTIVAL },
    );
    expect(q.notices).toEqual([]);
  });
});
