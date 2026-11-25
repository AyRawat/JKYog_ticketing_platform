import { describe, expect, it } from "vitest";
import {
  adultDayPass,
  childDayPass,
  DURING_FESTIVAL,
  infant,
  issueCodes,
  person,
  quote,
} from "./test/fixtures";

describe("a person's age must match their ticket", () => {
  it.each([
    ["adult on a child day pass", person(30, "DAY_PASS_CHILD", ["2026-12-12"])],
    ["12-year-old on a child day pass", person(12, "DAY_PASS_CHILD", ["2026-12-12"])],
    ["child on an adult day pass", person(7, "DAY_PASS_ADULT", ["2026-12-12"])],
    ["11-year-old on an adult day pass", person(11, "DAY_PASS_ADULT", ["2026-12-12"])],
    ["adult on a child all-day pass", person(40, "ALL_DAY_PASS_CHILD")],
  ])("refuses %s", (_, attendee) => {
    const q = quote({ attendees: [attendee] });
    expect(q.issues).toEqual([
      expect.objectContaining({
        code: "AGE_TICKET_MISMATCH",
        path: "attendees[0].entry.productCode",
      }),
    ]);
    expect(q.lines).toEqual([]);
    expect(q.canBook).toBe(false);
  });

  it("explains which ticket is needed", () => {
    const q = quote({ attendees: [person(7, "DAY_PASS_ADULT", ["2026-12-12"])] });
    expect(q.issues[0]?.message).toBe(
      "At 7, this person needs a child ticket (ages 5–11). Day Pass – Adult isn't one.",
    );
  });

  it.each([
    [5, "DAY_PASS_CHILD"],
    [11, "DAY_PASS_CHILD"],
    [12, "DAY_PASS_ADULT"],
    [99, "DAY_PASS_ADULT"],
  ])("accepts age %i on %s", (age, code) => {
    expect(quote({ attendees: [person(age, code, ["2026-12-12"])] }).issues).toEqual([]);
  });
});

describe("children under 5", () => {
  it("come free with no ticket and no line on the bill", () => {
    const q = quote({ attendees: [adultDayPass(), infant(2)] });
    expect(q.issues).toEqual([]);
    expect(q.totalCents).toBe(1_500);
    expect(q.admissions.map((a) => a.attendeeIndex)).toEqual([0]);
  });

  it.each([0, 4])("age %i cannot be given a ticket", (age) => {
    const q = quote({ attendees: [adultDayPass(), person(age, "DAY_PASS_CHILD", ["2026-12-12"])] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "TICKET_NOT_NEEDED", path: "attendees[1].entry" }),
    ]);
  });
});

describe("every ticketed person needs a ticket", () => {
  it("asks for one when a 5+ attendee has none", () => {
    const q = quote({ attendees: [person(8, null)] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "ENTRY_REQUIRED", path: "attendees[0].entry" }),
    ]);
  });

  it("refuses an unknown ticket code", () => {
    const q = quote({ attendees: [person(30, "VIP_PASS", ["2026-12-12"])] });
    expect(issueCodes(q)).toEqual(["UNKNOWN_PRODUCT"]);
  });

  it("refuses an extra used as a ticket", () => {
    const q = quote({ attendees: [person(30, "DINNER_PLATE", ["2026-12-12"])] });
    expect(issueCodes(q)).toEqual(["WRONG_PRODUCT_KIND"]);
  });
});

describe("ticket days", () => {
  it("a day pass needs at least one day", () => {
    const q = quote({ attendees: [adultDayPass([])] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "DAYS_REQUIRED", path: "attendees[0].entry.days" }),
    ]);
  });

  it("an all-day pass takes no days", () => {
    const q = quote({ attendees: [person(8, "ALL_DAY_PASS_CHILD", ["2026-12-12"])] });
    expect(issueCodes(q)).toEqual(["DAYS_NOT_ALLOWED"]);
  });

  it.each(["2026-12-09", "2026-12-15", "2026-11-10", "not-a-date"])(
    "refuses %s, which is not a festival day",
    (day) => {
      const q = quote({ attendees: [adultDayPass(["2026-12-12", day])] });
      expect(q.issues).toEqual([
        expect.objectContaining({ code: "DAY_NOT_AVAILABLE", path: "attendees[0].entry.days[1]" }),
      ]);
    },
  );

  it("refuses the same day twice", () => {
    const q = quote({ attendees: [adultDayPass(["2026-12-12", "2026-12-12"])] });
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "DUPLICATE_DAY", path: "attendees[0].entry.days[1]" }),
    ]);
  });

  it("accepts days in any order and bills them in date order", () => {
    const q = quote({ attendees: [adultDayPass(["2026-12-14", "2026-12-10"])] });
    expect(q.lines.map((l) => l.day)).toEqual(["2026-12-10", "2026-12-14"]);
  });

  describe("once the festival has started (12 Dec)", () => {
    it("refuses days that have passed", () => {
      const q = quote({ attendees: [childDayPass(["2026-12-11"])] }, { now: DURING_FESTIVAL });
      expect(issueCodes(q)).toEqual(["DAY_IN_PAST"]);
    });

    it("still sells today and later days", () => {
      const q = quote(
        { attendees: [childDayPass(["2026-12-12", "2026-12-14"])] },
        { now: DURING_FESTIVAL },
      );
      expect(q.issues).toEqual([]);
    });

    it("stops selling all-day passes", () => {
      const q = quote({ attendees: [person(8, "ALL_DAY_PASS_CHILD")] }, { now: DURING_FESTIVAL });
      expect(issueCodes(q)).toEqual(["SALE_CLOSED"]);
    });
  });
});

describe("one kind of ticket per person", () => {
  it("lets different people in one booking hold different tickets", () => {
    const q = quote({
      attendees: [
        adultDayPass(["2026-12-12"]),
        person(9, "ALL_DAY_PASS_CHILD"),
        childDayPass(["2026-12-13"]),
      ],
    });
    expect(q.issues).toEqual([]);
    expect(q.totalCents).toBe(1_500 + 3_000 + 800);
  });

  it("never admits one person twice on the same day", () => {
    const q = quote({ attendees: [person(9, "ALL_DAY_PASS_CHILD"), adultDayPass()] });
    const keys = q.admissions.map((a) => `${a.attendeeIndex}|${a.day}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
