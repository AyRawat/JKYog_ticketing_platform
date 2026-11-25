import { describe, expect, it } from "vitest";
import { checkAttendeeContacts } from "./contacts";

const rules = { referenceDate: "2026-12-10", childMinAge: 5, adultMinAge: 12, bookerMinAge: 18 };

describe("attendee phone numbers", () => {
  it("adults may leave one, or not", () => {
    expect(
      checkAttendeeContacts(
        [
          { ageYears: 12, phone: "+1 214 555 0100" },
          { ageYears: 70, phone: null },
        ],
        rules,
      ),
    ).toEqual([]);
  });

  it("children and under-5s may not, each reported at their own phone field", () => {
    expect(
      checkAttendeeContacts(
        [
          { ageYears: 35, phone: null },
          { ageYears: 11, phone: "214 555 0101" },
          { ageYears: 3, phone: "214 555 0102" },
        ],
        rules,
      ),
    ).toEqual([
      {
        code: "PHONE_NOT_ALLOWED",
        path: "attendees[1].phone",
        message: "Please leave the phone number blank for anyone under 12.",
      },
      expect.objectContaining({ code: "PHONE_NOT_ALLOWED", path: "attendees[2].phone" }),
    ]);
  });

  it("follows the event's adult age, not a fixed number", () => {
    const olderAdults = { ...rules, adultMinAge: 14 };
    expect(
      checkAttendeeContacts([{ ageYears: 13, phone: "214 555 0103" }], olderAdults),
    ).toHaveLength(1);
  });

  it("leaves invalid ages to the cart rules", () => {
    expect(checkAttendeeContacts([{ ageYears: -1, phone: "214 555 0104" }], rules)).toEqual([]);
  });
});
