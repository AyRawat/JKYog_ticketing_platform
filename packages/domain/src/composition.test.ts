import { describe, expect, it } from "vitest";
import { unitsToAdmit } from "./composition";
import {
  adultDayPass,
  childDayPass,
  familyAdult,
  familyChild,
  FESTIVAL_DAYS,
  infant,
  issueCodes,
  lineSummary,
  person,
  quote,
} from "./test/fixtures";

describe("unitsToAdmit: whole units of a ticket that admit a group exactly", () => {
  const dayPassAdult = { adults: 1, children: 0 };
  const family = { adults: 2, children: 2 };

  it.each([
    [dayPassAdult, 1, 0, 1],
    [dayPassAdult, 3, 0, 3],
    [dayPassAdult, 1, 1, null],
    [family, 2, 2, 1],
    [family, 4, 4, 2],
    [family, 6, 6, 3],
    [family, 3, 1, null],
    [family, 2, 1, null],
    [family, 2, 3, null],
    [family, 1, 3, null],
    [family, 3, 3, null],
    [family, 4, 2, null],
    [family, 2, 0, null],
    [family, 0, 0, null],
  ])("%j with %i adults + %i children -> %s", (admits, adults, children, expected) => {
    expect(unitsToAdmit(admits, adults, children)).toBe(expected);
  });
});

const family = (adults: number, children: number, days = ["2026-12-12"]) => [
  ...Array.from({ length: adults }, () => familyAdult(days)),
  ...Array.from({ length: children }, () => familyChild(days)),
];

describe("Family Pass", () => {
  it("2 adults + 2 children = one pass, $40", () => {
    const q = quote({ attendees: family(2, 2) });
    expect(q.issues).toEqual([]);
    expect(lineSummary(q)).toEqual(["FAMILY_PASS@2026-12-12 x1 = 4000"]);
  });

  it("a joint family of 4 adults + 4 children = two passes on the same day", () => {
    const q = quote({ attendees: family(4, 4) });
    expect(q.issues).toEqual([]);
    expect(lineSummary(q)).toEqual(["FAMILY_PASS@2026-12-12 x2 = 8000"]);
    expect(q.admissions).toHaveLength(8);
  });

  it.each([
    [3, 1],
    [2, 1],
    [2, 3],
    [1, 3],
    [3, 3],
    [4, 3],
    [4, 2],
  ])("refuses %i adults + %i children", (adults, children) => {
    const q = quote({ attendees: family(adults, children) });
    expect(issueCodes(q)).toEqual(["GROUP_COMPOSITION_MISMATCH"]);
    expect(q.lines).toEqual([]);
    expect(q.admissions).toEqual([]);
    expect(q.canBook).toBe(false);
  });

  it("explains the mismatch for the day", () => {
    const q = quote({ attendees: family(3, 2) });
    expect(q.issues[0]?.message).toBe(
      "Each Family Pass covers exactly 2 adults and 2 children. On 12 Dec it has 3 adults and 2 children.",
    );
  });

  it("does not count an under-5 as one of its children", () => {
    const q = quote({ attendees: [...family(2, 1), person(3, "FAMILY_PASS", ["2026-12-12"])] });
    expect(issueCodes(q)).toEqual(["TICKET_NOT_NEEDED", "GROUP_COMPOSITION_MISMATCH"]);
  });

  it("is fine with an under-5 coming along with no ticket", () => {
    const q = quote({ attendees: [...family(2, 2), infant(1)] });
    expect(q.issues).toEqual([]);
    expect(q.totalCents).toBe(4_000);
  });

  it("over several days gives one line per day", () => {
    const days = ["2026-12-11", "2026-12-12", "2026-12-14"];
    const q = quote({ attendees: family(2, 2, days) });
    expect(lineSummary(q)).toEqual([
      "FAMILY_PASS@2026-12-11 x1 = 4000",
      "FAMILY_PASS@2026-12-12 x1 = 4000",
      "FAMILY_PASS@2026-12-14 x1 = 4000",
    ]);
    expect(q.admissions).toHaveLength(4 * 3);
  });

  it("refuses holders whose days differ, on the days the group doesn't fit", () => {
    const q = quote({
      attendees: [
        familyAdult(["2026-12-12", "2026-12-13"]),
        familyAdult(["2026-12-12"]),
        familyChild(["2026-12-12"]),
        familyChild(["2026-12-12"]),
      ],
    });
    expect(issueCodes(q)).toEqual(["GROUP_COMPOSITION_MISMATCH"]);
    expect(q.issues[0]?.message).toContain("On 13 Dec it has 1 adult and 0 children");
    expect(lineSummary(q)).toEqual(["FAMILY_PASS@2026-12-12 x1 = 4000"]);
  });

  it("two families on different days get a pass each day", () => {
    const q = quote({
      attendees: [...family(2, 2, ["2026-12-12"]), ...family(2, 2, ["2026-12-12", "2026-12-13"])],
    });
    expect(lineSummary(q)).toEqual([
      "FAMILY_PASS@2026-12-12 x2 = 8000",
      "FAMILY_PASS@2026-12-13 x1 = 4000",
    ]);
  });

  it("mixes with day passes for the rest of the group", () => {
    const q = quote({ attendees: [...family(2, 2), adultDayPass(["2026-12-12"])] });
    expect(q.issues).toEqual([]);
    expect(q.totalCents).toBe(4_000 + 1_500);
  });
});

describe("turning people into lines and door-list admissions", () => {
  it("2 adults x 3 days on day passes -> one line per day, quantity 2", () => {
    const days = ["2026-12-10", "2026-12-11", "2026-12-12"];
    const q = quote({ attendees: [adultDayPass(days), adultDayPass(days)] });
    expect(lineSummary(q)).toEqual([
      "DAY_PASS_ADULT@2026-12-10 x2 = 3000",
      "DAY_PASS_ADULT@2026-12-11 x2 = 3000",
      "DAY_PASS_ADULT@2026-12-12 x2 = 3000",
    ]);
    expect(q.admissions).toHaveLength(6);
  });

  it("all-day passes -> one line with no day, quantity = people", () => {
    const q = quote({
      attendees: [person(8, "ALL_DAY_PASS_CHILD"), person(10, "ALL_DAY_PASS_CHILD")],
    });
    expect(lineSummary(q)).toEqual(["ALL_DAY_PASS_CHILD@all x2 = 6000"]);
  });

  it("an all-day pass admits its holder on every festival day", () => {
    const q = quote({ attendees: [person(8, "ALL_DAY_PASS_CHILD")] });
    expect(q.admissions.map((a) => a.day)).toEqual([...FESTIVAL_DAYS]);
    expect(q.admissions.every((a) => a.lineDay === null)).toBe(true);
  });

  it("each admission points at the line that paid for it", () => {
    const q = quote({ attendees: [childDayPass(["2026-12-13"])] });
    expect(q.admissions).toEqual([
      { attendeeIndex: 0, day: "2026-12-13", productCode: "DAY_PASS_CHILD", lineDay: "2026-12-13" },
    ]);
  });
});
