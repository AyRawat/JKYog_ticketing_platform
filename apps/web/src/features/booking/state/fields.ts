import type { IsoDate } from "@ticketing/domain";
import type { BookerDetails } from "./types";

// One name for every place in the form a message can be shown. Used as the key for grouping
// messages and, sanitised, as DOM ids for `aria-describedby`.

export type PersonField = "fullName" | "ageYears" | "phone" | "ticket" | "days";

export const fieldKey = {
  booker: (field: keyof Omit<BookerDetails, "ageText"> | "ageYears") => `booker.${field}`,
  person: (personId: string, field: PersonField) => `person:${personId}.${field}`,
  extra: (productCode: string, day: IsoDate | null) => `extra:${productCode}:${day ?? "any"}`,
  /** The days the group is coming, picked before anyone is added. */
  visitDays: "visitDays",
  /** About the group as a whole, e.g. "add at least one person". */
  people: "people",
  promo: "promo",
  /** Anything that can't be placed on a field; shown in the summary. */
  form: "form",
} as const;

/** A string safe to use as an element id. */
export function fieldDomId(key: string): string {
  return `field-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/** The id of the box around a group of controls (ticket cards, day chips), for jump links. */
export function fieldGroupId(key: string): string {
  return `${fieldDomId(key)}-group`;
}
