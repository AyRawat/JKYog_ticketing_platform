import { issue, type Issue } from "./issues";
import type { AgeRules, EntryProduct } from "./types";

/** Sanity ceiling for a typed-in age. Not an event rule, so it lives here rather than in the data. */
export const MAX_AGE_YEARS = 120;

/** "infant" = below the free age: no ticket, still counted at the door. */
export type AgeBand = "infant" | "child" | "adult";
export type TicketedBand = Exclude<AgeBand, "infant">;

export function isValidAge(ageYears: number): boolean {
  return Number.isInteger(ageYears) && ageYears >= 0 && ageYears <= MAX_AGE_YEARS;
}

/** Assumes a valid age (see `isValidAge`). Thresholds come from the event, never constants. */
export function ageBand(ageYears: number, rules: AgeRules): AgeBand {
  if (ageYears < rules.childMinAge) return "infant";
  if (ageYears < rules.adultMinAge) return "child";
  return "adult";
}

/** Whether one unit of this ticket can hold a person of this band, judged by who it admits. */
export function productAdmitsBand(product: EntryProduct, band: TicketedBand): boolean {
  return band === "adult" ? product.admits.adults > 0 : product.admits.children > 0;
}

/** "under 5", "ages 5–11", "ages 12 and over" */
export function bandAgeRange(band: AgeBand, rules: AgeRules): string {
  switch (band) {
    case "infant":
      return `under ${rules.childMinAge}`;
    case "child":
      return `ages ${rules.childMinAge}–${rules.adultMinAge - 1}`;
    case "adult":
      return `ages ${rules.adultMinAge} and over`;
  }
}

export const invalidAgeMessage = `Please enter an age as a whole number from 0 to ${MAX_AGE_YEARS}.`;

/** The person paying must be old enough to pay. They don't have to attend. */
export function checkBooker(booker: { readonly ageYears: number }, rules: AgeRules): Issue[] {
  const path = "booker.ageYears";
  if (!isValidAge(booker.ageYears)) return [issue("INVALID_AGE", path, invalidAgeMessage)];
  if (booker.ageYears < rules.bookerMinAge) {
    return [
      issue(
        "BOOKER_TOO_YOUNG",
        path,
        `The person booking must be ${rules.bookerMinAge} or over, as they are the one paying.`,
      ),
    ];
  }
  return [];
}
