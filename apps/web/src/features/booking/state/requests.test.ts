import { BookingRequest, QuoteRequest } from "@ticketing/contracts";
import { describe, expect, it } from "vitest";
import { catalog } from "../test/catalog-fixture";
import {
  BOOKER_PERSON_ID,
  createBookingReducer,
  initialBookingState,
  type BookingAction,
} from "./reducer";
import { toBookingRequest, toQuoteRequest } from "./requests";

const reduce = createBookingReducer(catalog);
const run = (...actions: BookingAction[]) => actions.reduce(reduce, initialBookingState);

const booker: BookingAction[] = [
  { type: "bookerChanged", field: "fullName", value: "  Asha Patel " },
  { type: "bookerChanged", field: "email", value: " asha@example.com" },
  { type: "bookerChanged", field: "phone", value: "+1 214 555 0100 " },
  { type: "bookerChanged", field: "ageText", value: "40" },
  { type: "ticketChosen", id: BOOKER_PERSON_ID, productCode: "DAY_PASS_ADULT" },
  { type: "dayToggled", id: BOOKER_PERSON_ID, day: "2026-12-12" },
];

const guest = (id: string, fullName: string, ageText: string, phone = ""): BookingAction[] => [
  { type: "guestAdded", id },
  { type: "guestChanged", id, field: "fullName", value: fullName },
  { type: "guestChanged", id, field: "ageText", value: ageText },
  { type: "guestChanged", id, field: "phone", value: phone },
];

/** Booker + a child on a day pass + a toddler, dinner for two, SEVA10. */
const family = run(
  ...booker,
  ...guest("kid", "Riya Patel", "8"),
  { type: "ticketChosen", id: "kid", productCode: "DAY_PASS_CHILD" },
  { type: "dayToggled", id: "kid", day: "2026-12-12" },
  ...guest("baby", "Dev Patel", "2"),
  { type: "extraQuantitySet", productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 2 },
  { type: "promoCodeChanged", code: "  seva10 " },
);

describe("toQuoteRequest", () => {
  it("sends intent only, in form order, and passes the contract", () => {
    const { request, attendeeIds, unreadableAgeIds } = toQuoteRequest(family);

    expect(request).toEqual({
      booker: { ageYears: 40 },
      attendees: [
        { ageYears: 40, entry: { productCode: "DAY_PASS_ADULT", days: ["2026-12-12"] } },
        { ageYears: 8, entry: { productCode: "DAY_PASS_CHILD", days: ["2026-12-12"] } },
        { ageYears: 2, entry: null },
      ],
      extras: [{ productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 2 }],
      promoCode: "seva10",
    });
    expect(attendeeIds).toEqual([BOOKER_PERSON_ID, "kid", "baby"]);
    expect(unreadableAgeIds).toEqual([]);
    expect(QuoteRequest.safeParse(request).success).toBe(true);
  });

  it("never sends names, contact details or anything priced", () => {
    const json = JSON.stringify(toQuoteRequest(family).request);
    for (const text of ["Asha", "Riya", "example.com", "555", "price", "Cents"]) {
      expect(json).not.toContain(text);
    }
  });

  it("leaves out people whose age can't be read yet, and says who", () => {
    const state = run(...booker, ...guest("new", "", ""), ...guest("kid", "Riya", "8"));
    const { request, attendeeIds, unreadableAgeIds } = toQuoteRequest(state);

    expect(request.attendees).toHaveLength(2);
    // Issues for attendees[1] must point at "kid", not at the guest with no age.
    expect(attendeeIds).toEqual([BOOKER_PERSON_ID, "kid"]);
    expect(unreadableAgeIds).toEqual(["new"]);
    expect(QuoteRequest.safeParse(request).success).toBe(true);
  });

  it("sends no booker until their age can be read", () => {
    const state = run({ type: "bookerChanged", field: "ageText", value: "forty" });
    expect(toQuoteRequest(state).request.booker).toBeNull();
    // The attending booker shares that age, so they are left out of the attendees too.
    expect(toQuoteRequest(state).unreadableAgeIds).toEqual([BOOKER_PERSON_ID]);
  });

  it("sends a blank promo code as none", () => {
    const state = run({ type: "promoCodeChanged", code: "   " });
    expect(toQuoteRequest(state).request.promoCode).toBeNull();
  });

  it("sends an out-of-range age as typed, for the server to explain", () => {
    const state = run(...guest("a", "Old", "130"));
    expect(toQuoteRequest(state).request.attendees).toContainEqual({ ageYears: 130, entry: null });
  });
});

describe("toBookingRequest", () => {
  it("sends the full booking with trimmed details and the total shown", () => {
    const draft = toBookingRequest(family, 4626);
    if (!draft.ok) throw new Error("expected a booking request");

    expect(draft.request).toEqual({
      booker: {
        fullName: "Asha Patel",
        email: "asha@example.com",
        phone: "+1 214 555 0100",
        ageYears: 40,
      },
      attendees: [
        {
          fullName: "Asha Patel",
          ageYears: 40,
          phone: null,
          entry: { productCode: "DAY_PASS_ADULT", days: ["2026-12-12"] },
        },
        {
          fullName: "Riya Patel",
          ageYears: 8,
          phone: null,
          entry: { productCode: "DAY_PASS_CHILD", days: ["2026-12-12"] },
        },
        { fullName: "Dev Patel", ageYears: 2, phone: null, entry: null },
      ],
      extras: [{ productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 2 }],
      promoCode: "seva10",
      expectedTotalCents: 4626,
    });
    expect(draft.attendeeIds).toEqual([BOOKER_PERSON_ID, "kid", "baby"]);
    expect(BookingRequest.safeParse(draft.request).success).toBe(true);
  });

  it("sends an adult guest's phone, and a blank one as none", () => {
    const state = run(
      ...booker,
      ...guest("a", "Ravi", "45", " 214-555-0101 "),
      ...guest("b", "Mira", "44", " "),
    );
    const draft = toBookingRequest(state, 0);
    if (!draft.ok) throw new Error("expected a booking request");
    expect(draft.request.attendees.map((a) => a.phone)).toEqual([null, "214-555-0101", null]);
  });

  it("reads the attending booker's name from the booker details", () => {
    const state = run(...booker, { type: "bookerChanged", field: "fullName", value: "Asha P." });
    const draft = toBookingRequest(state, 0);
    expect(draft.ok && draft.request.attendees[0]?.fullName).toBe("Asha P.");
  });

  it("is not built until every age can be read", () => {
    const state = run(
      ...booker,
      { type: "bookerChanged", field: "ageText", value: "" },
      ...guest("new", "Ravi", "4.5"),
    );
    expect(toBookingRequest(state, 0)).toEqual({
      ok: false,
      unreadableAgeIds: [BOOKER_PERSON_ID, "new"],
    });
  });

  it("flags the booker's age even when the booker isn't attending", () => {
    const state = run(
      { type: "bookerAttendingSet", attending: false },
      ...guest("a", "Ravi", "45"),
    );
    expect(toBookingRequest(state, 0)).toEqual({ ok: false, unreadableAgeIds: [BOOKER_PERSON_ID] });
  });

  it("leaves judging names, email and phones to the contract schema", () => {
    const state = run(...booker, { type: "bookerChanged", field: "email", value: "not-an-email" });
    const draft = toBookingRequest(state, 0);
    if (!draft.ok) throw new Error("expected a booking request");
    expect(BookingRequest.safeParse(draft.request).success).toBe(false);
  });
});
