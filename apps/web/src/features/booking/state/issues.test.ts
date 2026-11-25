import { describe, expect, it } from "vitest";
import { fieldDomId, fieldKey } from "./fields";
import { fieldForPath, messagesByField, type RequestShape } from "./issues";
import { BOOKER_PERSON_ID } from "./reducer";

const shape: RequestShape = {
  // "new" (no age yet) was left out of the request, so attendees[1] is "kid".
  attendeeIds: [BOOKER_PERSON_ID, "kid", "baby"],
  extras: [
    { productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 5 },
    { productCode: "DANDIYA_STICKS", day: null, quantity: 21 },
  ],
};

describe("fieldForPath", () => {
  it.each([
    ["attendees[1].ageYears", fieldKey.person("kid", "ageYears")],
    ["attendees[1].entry", fieldKey.person("kid", "ticket")],
    ["attendees[1].entry.productCode", fieldKey.person("kid", "ticket")],
    ["attendees[1].entry.days", fieldKey.person("kid", "days")],
    ["attendees[1].entry.days[2]", fieldKey.person("kid", "days")],
    ["attendees[2].phone", fieldKey.person("baby", "phone")],
    ["attendees[2].fullName", fieldKey.person("baby", "fullName")],
    ["attendees[2]", fieldKey.person("baby", "ticket")],
  ])("places %s on that person's field", (path, expected) => {
    expect(fieldForPath(path, shape)).toBe(expected);
  });

  it("places the attending booker's name and age on the booker's fields", () => {
    expect(fieldForPath("attendees[0].ageYears", shape)).toBe(fieldKey.booker("ageYears"));
    expect(fieldForPath("attendees[0].fullName", shape)).toBe(fieldKey.booker("fullName"));
    expect(fieldForPath("attendees[0].entry.days", shape)).toBe(
      fieldKey.person(BOOKER_PERSON_ID, "days"),
    );
  });

  it.each([
    ["booker.ageYears", fieldKey.booker("ageYears")],
    ["booker.email", fieldKey.booker("email")],
    ["booker.phone", fieldKey.booker("phone")],
    ["booker.fullName", fieldKey.booker("fullName")],
  ])("places %s on the booker's field", (path, expected) => {
    expect(fieldForPath(path, shape)).toBe(expected);
  });

  it("places extras by the product and day that were sent", () => {
    expect(fieldForPath("extras[0].quantity", shape)).toBe(
      fieldKey.extra("DINNER_PLATE", "2026-12-12"),
    );
    expect(fieldForPath("extras[1].quantity", shape)).toBe(fieldKey.extra("DANDIYA_STICKS", null));
  });

  it.each([
    ["attendees", fieldKey.people],
    ["promoCode", fieldKey.promo],
    ["attendees[9].ageYears", fieldKey.form],
    ["extras[7].day", fieldKey.form],
    ["booker.password", fieldKey.form],
    ["expectedTotalCents", fieldKey.form],
    ["", fieldKey.form],
  ])("places %j on %s", (path, expected) => {
    expect(fieldForPath(path, shape)).toBe(expected);
  });
});

describe("messagesByField", () => {
  it("groups messages by field, in order, without repeats", () => {
    const grouped = messagesByField(
      [
        { path: "attendees[1].entry.days[0]", message: "10 Dec is in the past." },
        { path: "attendees[1].entry.days[1]", message: "10 Dec is in the past." },
        { path: "attendees[1].entry.days[2]", message: "Pick a festival day." },
        { path: "booker.ageYears", message: "Must be 18 or over." },
      ],
      shape,
    );
    expect(Object.fromEntries(grouped)).toEqual({
      [fieldKey.person("kid", "days")]: ["10 Dec is in the past.", "Pick a festival day."],
      [fieldKey.booker("ageYears")]: ["Must be 18 or over."],
    });
  });
});

describe("fieldDomId", () => {
  it("makes a valid, distinct element id", () => {
    expect(fieldDomId(fieldKey.person("kid", "days"))).toBe("field-person-kid-days");
    expect(fieldDomId(fieldKey.extra("DINNER_PLATE", "2026-12-12"))).toBe(
      "field-extra-DINNER_PLATE-2026-12-12",
    );
  });
});
