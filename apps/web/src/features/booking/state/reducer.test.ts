import { describe, expect, it } from "vitest";
import { catalog } from "../test/catalog-fixture";
import {
  BOOKER_PERSON_ID,
  createBookingReducer,
  initialBookingState,
  type BookingAction,
} from "./reducer";
import type { BookingState, Person } from "./types";

const reduce = createBookingReducer(catalog);
const run = (...actions: BookingAction[]) => actions.reduce(reduce, initialBookingState);

const guest = (id: string, ageText: string): BookingAction[] => [
  { type: "guestAdded", id },
  { type: "guestChanged", id, field: "ageText", value: ageText },
  { type: "ageCommitted", id },
];
const person = (state: BookingState, id: string): Person | undefined =>
  state.people.find((p) => p.id === id);

describe("bookingReducer", () => {
  describe("people", () => {
    it("starts with the booker attending and nothing chosen", () => {
      expect(initialBookingState.people).toEqual([
        { kind: "booker", id: BOOKER_PERSON_ID, entry: null },
      ]);
      expect(initialBookingState.step).toBe("who");
    });

    it("adds guests in order and ignores a repeated id", () => {
      const state = run(...guest("a", "40"), ...guest("b", "8"), { type: "guestAdded", id: "a" });
      expect(state.people.map((p) => p.id)).toEqual([BOOKER_PERSON_ID, "a", "b"]);
    });

    it("removes a person and only that person", () => {
      const state = run(...guest("a", "40"), ...guest("b", "8"), {
        type: "personRemoved",
        id: "a",
      });
      expect(state.people.map((p) => p.id)).toEqual([BOOKER_PERSON_ID, "b"]);
    });

    it("puts the booker first when they say they're attending, once", () => {
      const state = run(
        { type: "bookerAttendingSet", attending: false },
        ...guest("a", "40"),
        { type: "bookerAttendingSet", attending: true },
        { type: "bookerAttendingSet", attending: true },
      );
      expect(state.people.map((p) => p.id)).toEqual([BOOKER_PERSON_ID, "a"]);
    });

    it("removes the booker's ticket with them when they stop attending", () => {
      const state = run(
        { type: "ticketChosen", id: BOOKER_PERSON_ID, productCode: "DAY_PASS_ADULT" },
        { type: "bookerAttendingSet", attending: false },
        { type: "bookerAttendingSet", attending: true },
      );
      expect(person(state, BOOKER_PERSON_ID)?.entry).toBeNull();
    });

    it("reads the attending booker's details from the booker, never a copy", () => {
      const state = run({ type: "bookerChanged", field: "fullName", value: "Asha Patel" });
      expect(state.booker.fullName).toBe("Asha Patel");
      expect(person(state, BOOKER_PERSON_ID)).toEqual({
        kind: "booker",
        id: BOOKER_PERSON_ID,
        entry: null,
      });
    });

    it("leaves the booker row alone when a guest-only change targets it", () => {
      const before = run();
      const after = reduce(before, {
        type: "guestChanged",
        id: BOOKER_PERSON_ID,
        field: "fullName",
        value: "x",
      });
      expect(after.people).toEqual(before.people);
    });
  });

  describe("tickets follow ages", () => {
    const withChildPass = [
      ...guest("kid", "8"),
      { type: "ticketChosen", id: "kid", productCode: "DAY_PASS_CHILD" },
      { type: "dayToggled", id: "kid", day: "2026-12-12" },
    ] satisfies BookingAction[];

    it("doesn't touch the ticket while the age is being typed", () => {
      const state = run(...withChildPass, {
        type: "guestChanged",
        id: "kid",
        field: "ageText",
        value: "3",
      });
      expect(person(state, "kid")?.entry?.productCode).toBe("DAY_PASS_CHILD");
    });

    it("swaps the pass when the new age is committed", () => {
      const state = run(
        ...withChildPass,
        { type: "guestChanged", id: "kid", field: "ageText", value: "13" },
        { type: "ageCommitted", id: "kid" },
      );
      expect(person(state, "kid")?.entry).toEqual({
        productCode: "DAY_PASS_ADULT",
        days: ["2026-12-12"],
      });
    });

    it("drops the ticket for an under-5", () => {
      const state = run(
        ...withChildPass,
        { type: "guestChanged", id: "kid", field: "ageText", value: "4" },
        { type: "ageCommitted", id: "kid" },
      );
      expect(person(state, "kid")?.entry).toBeNull();
    });

    it("re-derives the attending booker's ticket from the booker's age", () => {
      const state = run(
        { type: "ticketChosen", id: BOOKER_PERSON_ID, productCode: "DAY_PASS_CHILD" },
        { type: "bookerChanged", field: "ageText", value: "35" },
        { type: "ageCommitted", id: BOOKER_PERSON_ID },
      );
      expect(person(state, BOOKER_PERSON_ID)?.entry?.productCode).toBe("DAY_PASS_ADULT");
    });

    it("clears a guest's phone once their age makes them a child", () => {
      const state = run(
        ...guest("a", "15"),
        { type: "guestChanged", id: "a", field: "phone", value: "+1 214 555 0100" },
        { type: "guestChanged", id: "a", field: "ageText", value: "9" },
        { type: "ageCommitted", id: "a" },
      );
      expect(person(state, "a")).toMatchObject({ phone: "" });
    });

    it("keeps an adult guest's phone", () => {
      const state = run(
        ...guest("a", "40"),
        { type: "guestChanged", id: "a", field: "phone", value: "+1 214 555 0100" },
        { type: "ageCommitted", id: "a" },
      );
      expect(person(state, "a")).toMatchObject({ phone: "+1 214 555 0100" });
    });
  });

  describe("choosing tickets and days", () => {
    it("keeps the chosen days when switching between per-day tickets", () => {
      const state = run(
        ...guest("a", "40"),
        { type: "ticketChosen", id: "a", productCode: "DAY_PASS_ADULT" },
        { type: "dayToggled", id: "a", day: "2026-12-12" },
        { type: "ticketChosen", id: "a", productCode: "FAMILY_PASS" },
      );
      expect(person(state, "a")?.entry).toEqual({
        productCode: "FAMILY_PASS",
        days: ["2026-12-12"],
      });
    });

    it("drops the days for a whole-event pass, and ignores day toggles on it", () => {
      const state = run(
        ...guest("kid", "8"),
        { type: "ticketChosen", id: "kid", productCode: "DAY_PASS_CHILD" },
        { type: "dayToggled", id: "kid", day: "2026-12-12" },
        { type: "ticketChosen", id: "kid", productCode: "ALL_DAY_PASS_CHILD" },
        { type: "dayToggled", id: "kid", day: "2026-12-13" },
      );
      expect(person(state, "kid")?.entry).toEqual({ productCode: "ALL_DAY_PASS_CHILD", days: [] });
    });

    it("toggles days on and off, kept in date order", () => {
      const state = run(
        ...guest("a", "40"),
        { type: "ticketChosen", id: "a", productCode: "DAY_PASS_ADULT" },
        { type: "dayToggled", id: "a", day: "2026-12-14" },
        { type: "dayToggled", id: "a", day: "2026-12-10" },
        { type: "dayToggled", id: "a", day: "2026-12-12" },
        { type: "dayToggled", id: "a", day: "2026-12-14" },
      );
      expect(person(state, "a")?.entry?.days).toEqual(["2026-12-10", "2026-12-12"]);
    });

    it("ignores a day toggle before a ticket is chosen", () => {
      const state = run(...guest("a", "40"), { type: "dayToggled", id: "a", day: "2026-12-12" });
      expect(person(state, "a")?.entry).toBeNull();
    });

    it("clears the choice with null, and ignores a code the catalog doesn't sell", () => {
      const chosen = run(...guest("a", "40"), {
        type: "ticketChosen",
        id: "a",
        productCode: "DAY_PASS_ADULT",
      });
      expect(
        person(reduce(chosen, { type: "ticketChosen", id: "a", productCode: "NOPE" }), "a")?.entry,
      ).toEqual({ productCode: "DAY_PASS_ADULT", days: [] });
      expect(
        person(reduce(chosen, { type: "ticketChosen", id: "a", productCode: null }), "a")?.entry,
      ).toBeNull();
      // Extras are not entry tickets.
      expect(
        person(reduce(chosen, { type: "ticketChosen", id: "a", productCode: "DINNER_PLATE" }), "a")
          ?.entry?.productCode,
      ).toBe("DAY_PASS_ADULT");
    });
  });

  describe("extras", () => {
    const dinner = (day: string, quantity: number): BookingAction => ({
      type: "extraQuantitySet",
      productCode: "DINNER_PLATE",
      day,
      quantity,
    });

    it("adds, updates in place, and removes at zero", () => {
      const state = run(dinner("2026-12-11", 2), dinner("2026-12-12", 1), dinner("2026-12-11", 3));
      expect(state.extras).toEqual([
        { productCode: "DINNER_PLATE", day: "2026-12-11", quantity: 3 },
        { productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 1 },
      ]);
      expect(reduce(state, dinner("2026-12-11", 0)).extras).toEqual([
        { productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 1 },
      ]);
    });

    it.each([-1, 1.5, Number.NaN])("treats %s as no selection", (quantity) => {
      expect(run(dinner("2026-12-11", 2), dinner("2026-12-11", quantity)).extras).toEqual([]);
    });

    it("keeps a whole-event extra apart from per-day ones", () => {
      const state = run(dinner("2026-12-11", 2), {
        type: "extraQuantitySet",
        productCode: "DANDIYA_STICKS",
        day: null,
        quantity: 4,
      });
      expect(state.extras).toHaveLength(2);
    });

    it("leaves extras alone when a person is removed, so the server can flag the headcount", () => {
      const state = run(...guest("a", "40"), dinner("2026-12-11", 2), {
        type: "personRemoved",
        id: "a",
      });
      expect(state.extras).toHaveLength(1);
    });
  });

  it("stores the promo code and the step as given", () => {
    const state = run(
      { type: "promoCodeChanged", code: " seva10 " },
      { type: "stepChanged", step: "review" },
    );
    expect(state.promoCode).toBe(" seva10 ");
    expect(state.step).toBe("review");
  });
});
