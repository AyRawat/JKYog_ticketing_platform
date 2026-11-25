import { describe, expect, it } from "vitest";
import { formatDay, formatDayList, localDate } from "./dates";

describe("localDate in the event's timezone", () => {
  it.each([
    // Allen, Texas is UTC-6 in December
    ["2026-12-10T05:59:59Z", "2026-12-09"], // still the evening of 9 Dec locally
    ["2026-12-10T06:00:00Z", "2026-12-10"], // local midnight
    ["2026-12-14T23:30:00Z", "2026-12-14"],
  ])("%s is %s in America/Chicago", (instant, expected) => {
    expect(localDate(new Date(instant), "America/Chicago")).toBe(expected);
  });
});

describe("formatting days for people", () => {
  it("formats single days", () => {
    expect(formatDay("2026-12-12")).toBe("12 Dec");
  });

  it("returns text that isn't a real date unchanged", () => {
    expect(formatDay("not-a-date")).toBe("not-a-date");
  });

  it.each([
    [[], ""],
    [["2026-12-11"], "11 Dec"],
    [["2026-12-11", "2026-12-13"], "11 Dec and 13 Dec"],
    [["2026-12-10", "2026-12-11", "2026-12-12"], "10 Dec, 11 Dec and 12 Dec"],
  ])("%j -> %s", (days, expected) => {
    expect(formatDayList(days)).toBe(expected);
  });
});
