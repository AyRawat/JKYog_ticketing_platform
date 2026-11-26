import { Email, PersonName, Phone, type CatalogResponse } from "@ticketing/contracts";
import type { z } from "zod";
import { bandForAgeText, parseAgeText } from "./age-input";
import { fieldKey } from "./fields";
import type { BookingState } from "./types";

// What the form says is wrong, and when it says it.
//
// Two sources: checks the browser can make itself (names, email, phones, typed ages), using
// the same contract schemas the server parses with; and the issues the quote returns for the
// booking rules. A message only shows once its field has been used, or once the family tries
// to pay, so nobody is told off for a field they haven't reached.

export type Messages = ReadonlyMap<string, readonly string[]>;

const firstError = (schema: z.ZodType, value: string): string | null => {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? "Please check this field.");
};

const typedAgeMessage = "Please enter an age as a whole number, like 34 (0 for a baby).";

/** Problems the browser can spot without asking the server, keyed by field. */
export function localMessages(state: BookingState, catalog: CatalogResponse): Messages {
  const found = new Map<string, string[]>();
  const add = (key: string, message: string | null) => {
    if (message) found.set(key, [...(found.get(key) ?? []), message]);
  };

  const { booker } = state;
  add(fieldKey.booker("fullName"), firstError(PersonName, booker.fullName));
  add(fieldKey.booker("email"), firstError(Email, booker.email.trim()));
  add(fieldKey.booker("phone"), firstError(Phone, booker.phone));
  if (parseAgeText(booker.ageText) === null) add(fieldKey.booker("ageYears"), typedAgeMessage);

  for (const person of state.people) {
    if (person.kind === "booker") continue;
    add(fieldKey.person(person.id, "fullName"), firstError(PersonName, person.fullName));
    if (parseAgeText(person.ageText) === null) {
      add(fieldKey.person(person.id, "ageYears"), typedAgeMessage);
    }
    const isAdult = bandForAgeText(person.ageText, catalog.event.ageRules) === "adult";
    if (isAdult && person.phone.trim()) {
      add(fieldKey.person(person.id, "phone"), firstError(Phone, person.phone));
    }
  }

  if (state.people.length === 0) {
    add(fieldKey.people, "Please add at least one person who is coming.");
  }
  return found;
}

/** Both sources together, local first, without repeating a message on the same field. */
export function mergeMessages(...sources: readonly Messages[]): Messages {
  const merged = new Map<string, string[]>();
  for (const source of sources) {
    for (const [key, list] of source) {
      const current = merged.get(key) ?? [];
      merged.set(key, [...current, ...list.filter((message) => !current.includes(message))]);
    }
  }
  return merged;
}

/**
 * The messages to show now: those on fields the family has used, or all of them once they've
 * tried to pay. Group-wide ones ("add at least one person") wait for the pay attempt.
 */
export function visibleMessages(messages: Messages, state: BookingState): Messages {
  if (state.payAttempted) return messages;
  const touched = new Set(state.touched);
  return new Map([...messages].filter(([key]) => touched.has(key)));
}
