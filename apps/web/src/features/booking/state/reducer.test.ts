import { describe, expect, it } from "vitest";
import { catalog } from "../test/catalog-fixture";
import {
  BOOKER_PERSON_ID,
  createBookingReducer,
  initialBookingState,
  NO_EXTRAS,
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
        { kind: "booker", id: BOOKER_PERSON_ID, family: null, entry: null, extras: NO_EXTRAS },
      ]);
      expect(initialBookingState.touched).toEqual([]);
      expect(initialBookingState.payAttempted).toBe(false);
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

    it("takes the booker's card off the list, and brings it back as it was", () => {
      const away = run(
        { type: "ticketChosen", id: BOOKER_PERSON_ID, productCode: "ALL_DAY_PASS_CHILD" },
        {
          type: "extraQuantitySet",
          id: BOOKER_PERSON_ID,
          productCode: "DANDIYA_STICKS",
          quantity: 2,
        },
        { type: "bookerAttendingSet", attending: false },
      );
      expect(away.people).toEqual([]);

      const back = reduce(away, { type: "bookerAttendingSet", attending: true });
      expect(person(back, BOOKER_PERSON_ID)).toMatchObject({
        entry: { productCode: "ALL_DAY_PASS_CHILD" },
        extras: { quantities: { DANDIYA_STICKS: 2 } },
      });
      expect(back.detachedBooker).toBeNull();
    });

    it("reads the attending booker's details from the booker, never a copy", () => {
      const state = run({ type: "bookerChanged", field: "fullName", value: "Asha Patel" });
      expect(state.booker.fullName).toBe("Asha Patel");
      expect(person(state, BOOKER_PERSON_ID)).toEqual({
        kind: "booker",
        id: BOOKER_PERSON_ID,
        family: null,
        entry: null,
        extras: NO_EXTRAS,
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

  describe("each person's extras", () => {
    const adultOn = (id: string, ...days: string[]): BookingAction[] => [
      ...guest(id, "40"),
      { type: "ticketChosen", id, productCode: "DAY_PASS_ADULT" },
      ...days.map((day): BookingAction => ({ type: "dayToggled", id, day })),
    ];
    const dinner = (id: string, day: string): BookingAction => ({
      type: "extraDayToggled",
      id,
      productCode: "DINNER_PLATE",
      day,
    });
    const extras = (state: BookingState, id: string) => person(state, id)?.extras;

    it("toggles a per-day extra on the person's own days, in date order", () => {
      const state = run(
        ...adultOn("a", "2026-12-11", "2026-12-12"),
        dinner("a", "2026-12-12"),
        dinner("a", "2026-12-11"),
      );
      expect(extras(state, "a")?.days).toEqual({ DINNER_PLATE: ["2026-12-11", "2026-12-12"] });
      expect(extras(reduce(state, dinner("a", "2026-12-12")), "a")?.days).toEqual({
        DINNER_PLATE: ["2026-12-11"],
      });
    });

    it("refuses a day the person isn't coming, or the extra doesn't run", () => {
      const state = run(
        ...adultOn("a", "2026-12-12"),
        dinner("a", "2026-12-13"),
        // Garba runs on the 11th and 13th only.
        { type: "extraDayToggled", id: "a", productCode: "GARBA_WORKSHOP", day: "2026-12-12" },
      );
      expect(extras(state, "a")?.days).toEqual({});
    });

    it("allows any festival day for someone on a whole-festival pass", () => {
      const state = run(
        ...guest("kid", "8"),
        { type: "ticketChosen", id: "kid", productCode: "ALL_DAY_PASS_CHILD" },
        { type: "extraDayToggled", id: "kid", productCode: "GARBA_WORKSHOP", day: "2026-12-13" },
      );
      expect(extras(state, "kid")?.days).toEqual({ GARBA_WORKSHOP: ["2026-12-13"] });
    });

    it("drops an extra on a day the person stops coming", () => {
      const state = run(
        ...adultOn("a", "2026-12-11", "2026-12-12"),
        dinner("a", "2026-12-11"),
        dinner("a", "2026-12-12"),
        { type: "dayToggled", id: "a", day: "2026-12-11" },
      );
      expect(extras(state, "a")?.days).toEqual({ DINNER_PLATE: ["2026-12-12"] });
    });

    it("drops per-day extras when the ticket is cleared", () => {
      const state = run(...adultOn("a", "2026-12-12"), dinner("a", "2026-12-12"), {
        type: "ticketChosen",
        id: "a",
        productCode: null,
      });
      expect(extras(state, "a")?.days).toEqual({});
    });

    it("clears every extra once the age makes them an under-5", () => {
      const state = run(
        ...guest("kid", "8"),
        { type: "ticketChosen", id: "kid", productCode: "ALL_DAY_PASS_CHILD" },
        dinner("kid", "2026-12-12"),
        { type: "extraQuantitySet", id: "kid", productCode: "DANDIYA_STICKS", quantity: 2 },
        { type: "guestChanged", id: "kid", field: "ageText", value: "3" },
        { type: "ageCommitted", id: "kid" },
      );
      expect(extras(state, "kid")).toEqual(NO_EXTRAS);
    });

    it("sets a whole-festival extra's count, and removes it at zero or nonsense", () => {
      const set = (quantity: number): BookingAction => ({
        type: "extraQuantitySet",
        id: "a",
        productCode: "DANDIYA_STICKS",
        quantity,
      });
      expect(extras(run(...guest("a", "40"), set(3)), "a")?.quantities).toEqual({
        DANDIYA_STICKS: 3,
      });
      for (const quantity of [0, -1, 1.5, Number.NaN]) {
        expect(extras(run(...guest("a", "40"), set(3), set(quantity)), "a")?.quantities).toEqual(
          {},
        );
      }
    });

    it("keeps per-day and whole-festival actions to their own kind of extra", () => {
      const state = run(
        ...adultOn("a", "2026-12-12"),
        { type: "extraDayToggled", id: "a", productCode: "DANDIYA_STICKS", day: "2026-12-12" },
        { type: "extraQuantitySet", id: "a", productCode: "DINNER_PLATE", quantity: 2 },
      );
      expect(extras(state, "a")).toEqual(NO_EXTRAS);
    });

    it("takes a person's extras with them when they are removed", () => {
      const state = run(...adultOn("a", "2026-12-12"), dinner("a", "2026-12-12"), {
        type: "personRemoved",
        id: "a",
      });
      expect(person(state, "a")).toBeUndefined();
    });
  });

  describe("a Family Pass", () => {
    const start = (
      id = BOOKER_PERSON_ID,
      productCode = "FAMILY_PASS",
      newIds: readonly string[] = ["p2", "p3", "p4"],
    ): BookingAction => ({ type: "familyStarted", id, productCode, familyId: "f1", newIds });
    const withBooker = (age = "40"): BookingAction[] => [
      { type: "bookerChanged", field: "ageText", value: age },
      { type: "ageCommitted", id: BOOKER_PERSON_ID },
    ];
    const roles = (state: BookingState) =>
      state.people.map((p) => `${p.id}:${p.family?.role ?? "-"}`);

    it("turns the chooser's card into a family: their place plus empty ones", () => {
      const state = run(...withBooker(), ...guest("later", "70"), start());
      expect(roles(state)).toEqual(["booker:adult", "p2:adult", "p3:child", "p4:child", "later:-"]);
      for (const p of state.people.slice(0, 4)) {
        expect(p.entry).toEqual({ productCode: "FAMILY_PASS", days: [] });
      }
    });

    it("gives a child chooser a child place", () => {
      const state = run(
        { type: "bookerAttendingSet", attending: false },
        ...guest("kid", "8"),
        start("kid"),
      );
      expect(roles(state)).toEqual(["p2:adult", "p3:adult", "kid:child", "p4:child"]);
    });

    it("keeps the chooser's days, and sets days for the whole family at once", () => {
      const state = run(
        ...withBooker(),
        { type: "ticketChosen", id: BOOKER_PERSON_ID, productCode: "DAY_PASS_ADULT" },
        { type: "dayToggled", id: BOOKER_PERSON_ID, day: "2026-12-12" },
        start(),
        { type: "familyDayToggled", familyId: "f1", day: "2026-12-13" },
      );
      for (const p of state.people) {
        expect(p.entry?.days).toEqual(["2026-12-12", "2026-12-13"]);
      }
    });

    it("drops a member's extras on a day the family stops coming", () => {
      const state = run(
        ...withBooker(),
        start(),
        { type: "familyDayToggled", familyId: "f1", day: "2026-12-12" },
        { type: "extraDayToggled", id: "p3", productCode: "DINNER_PLATE", day: "2026-12-12" },
        { type: "familyDayToggled", familyId: "f1", day: "2026-12-12" },
      );
      expect(person(state, "p3")?.extras.days).toEqual({});
    });

    it("ignores ticket and day changes for one member", () => {
      const before = run(...withBooker(), start());
      const changes: BookingAction[] = [
        { type: "ticketChosen", id: "p2", productCode: "DAY_PASS_ADULT" },
        { type: "dayToggled", id: "p2", day: "2026-12-12" },
        { type: "personRemoved", id: "p2" },
      ];
      expect(changes.reduce(reduce, before).people).toEqual(before.people);
    });

    it("keeps the family ticket when a member's age doesn't fit their place", () => {
      const state = run(
        ...withBooker(),
        start(),
        { type: "guestChanged", id: "p3", field: "ageText", value: "30" },
        { type: "ageCommitted", id: "p3" },
      );
      expect(person(state, "p3")?.entry?.productCode).toBe("FAMILY_PASS");
    });

    it("splits back into separate cards, dropping empty places", () => {
      const state = run(
        ...withBooker(),
        start(),
        { type: "guestChanged", id: "p3", field: "fullName", value: "Riya" },
        { type: "familySplit", familyId: "f1" },
      );
      expect(state.people.map((p) => p.id)).toEqual([BOOKER_PERSON_ID, "p3"]);
      expect(state.people.every((p) => p.family === null && p.entry === null)).toBe(true);
    });

    it("leaves the booker's place empty for someone else when they stop attending", () => {
      const state = run(...withBooker(), start(), {
        type: "bookerAttendingSet",
        attending: false,
        replacementId: "stand-in",
      });
      expect(roles(state)).toEqual(["stand-in:adult", "p2:adult", "p3:child", "p4:child"]);
      expect(person(state, "stand-in")?.entry?.productCode).toBe("FAMILY_PASS");
      // Coming back, the booker is a separate card again, not a fifth family member.
      const back = reduce(state, { type: "bookerAttendingSet", attending: true });
      expect(person(back, BOOKER_PERSON_ID)).toMatchObject({ family: null, entry: null });
    });

    it("refuses a pass that isn't shared, or the wrong number of new places", () => {
      const base = run(...withBooker());
      expect(reduce(base, start(BOOKER_PERSON_ID, "DAY_PASS_ADULT"))).toBe(base);
      expect(reduce(base, start(BOOKER_PERSON_ID, "FAMILY_PASS", ["p2"]))).toBe(base);
    });

    it("prefills a separate card for a member coming on other days too", () => {
      const state = run({ type: "guestAdded", id: "again", fullName: "Ravi", ageText: "38" });
      expect(person(state, "again")).toMatchObject({
        fullName: "Ravi",
        ageText: "38",
        family: null,
      });
    });
  });

  it("stores the applied promo code as given", () => {
    expect(run({ type: "promoCodeChanged", code: " seva10 " }).promoCode).toBe(" seva10 ");
  });

  it("remembers touched fields once each, and the first pay attempt", () => {
    const state = run(
      { type: "fieldTouched", key: "booker.email" },
      { type: "fieldTouched", key: "booker.email" },
      { type: "payAttempted" },
    );
    expect(state.touched).toEqual(["booker.email"]);
    expect(state.payAttempted).toBe(true);
    expect(reduce(state, { type: "payAttempted" })).toBe(state);
  });
});
