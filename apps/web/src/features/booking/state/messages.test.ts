import { describe, expect, it } from "vitest";
import { catalog } from "../test/catalog-fixture";
import { fieldKey } from "./fields";
import { localMessages, mergeMessages, visibleMessages } from "./messages";
import { createBookingReducer, initialBookingState, type BookingAction } from "./reducer";

const reduce = createBookingReducer(catalog);
const run = (...actions: BookingAction[]) => actions.reduce(reduce, initialBookingState);

const completeBooker: BookingAction[] = [
  { type: "bookerChanged", field: "fullName", value: "Asha Patel" },
  { type: "bookerChanged", field: "email", value: "asha@example.com" },
  { type: "bookerChanged", field: "phone", value: "+1 214 555 0100" },
  { type: "bookerChanged", field: "ageText", value: "40" },
];

describe("localMessages", () => {
  it("has nothing to say about a complete booker", () => {
    expect(localMessages(run(...completeBooker), catalog).size).toBe(0);
  });

  it("checks the booker's details with the contract schemas", () => {
    const messages = localMessages(
      run(
        ...completeBooker,
        { type: "bookerChanged", field: "email", value: "asha@example" },
        { type: "bookerChanged", field: "phone", value: "12" },
        { type: "bookerChanged", field: "fullName", value: "  " },
        { type: "bookerChanged", field: "ageText", value: "forty" },
      ),
      catalog,
    );
    expect([...messages.keys()]).toEqual([
      fieldKey.booker("fullName"),
      fieldKey.booker("email"),
      fieldKey.booker("phone"),
      fieldKey.booker("ageYears"),
    ]);
  });

  it("asks a guest for a name and a whole-number age", () => {
    const messages = localMessages(
      run(...completeBooker, { type: "guestAdded", id: "g" }),
      catalog,
    );
    expect(messages.has(fieldKey.person("g", "fullName"))).toBe(true);
    expect(messages.has(fieldKey.person("g", "ageYears"))).toBe(true);
  });

  it("checks an adult guest's phone only when one is given", () => {
    const adult = (phone: string) =>
      localMessages(
        run(
          ...completeBooker,
          { type: "guestAdded", id: "g" },
          { type: "guestChanged", id: "g", field: "fullName", value: "Ravi" },
          { type: "guestChanged", id: "g", field: "ageText", value: "45" },
          { type: "guestChanged", id: "g", field: "phone", value: phone },
        ),
        catalog,
      );
    expect(adult("").size).toBe(0);
    expect(adult("abc").has(fieldKey.person("g", "phone"))).toBe(true);
  });

  it("asks for at least one person when the group is empty", () => {
    const messages = localMessages(
      run(...completeBooker, { type: "bookerAttendingSet", attending: false }),
      catalog,
    );
    expect(messages.has(fieldKey.people)).toBe(true);
  });
});

describe("visibleMessages", () => {
  const all = new Map([
    [fieldKey.booker("email"), ["Please enter a valid email address."]],
    [fieldKey.people, ["Please add at least one person who is coming."]],
  ]);

  it("shows nothing on a fresh form", () => {
    expect(visibleMessages(all, initialBookingState).size).toBe(0);
  });

  it("shows a field's messages once it has been used", () => {
    const state = run({ type: "fieldTouched", key: fieldKey.booker("email") });
    expect([...visibleMessages(all, state).keys()]).toEqual([fieldKey.booker("email")]);
  });

  it("shows everything once the family tries to pay", () => {
    expect(visibleMessages(all, run({ type: "payAttempted" }))).toBe(all);
  });
});

describe("mergeMessages", () => {
  it("joins sources field by field, without repeats", () => {
    const merged = mergeMessages(
      new Map([["a", ["one"]]]),
      new Map([
        ["a", ["one", "two"]],
        ["b", ["three"]],
      ]),
    );
    expect(Object.fromEntries(merged)).toEqual({ a: ["one", "two"], b: ["three"] });
  });
});
