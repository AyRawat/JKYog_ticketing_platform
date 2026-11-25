import type { IsoDate } from "@ticketing/domain";

export const STEPS = ["who", "passes", "extras", "review"] as const;
export type Step = (typeof STEPS)[number];

/**
 * The person paying, as typed. Text stays raw (ages included) so a half-typed field is never
 * lost; turning it into a request is a separate step.
 */
export interface BookerDetails {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly ageText: string;
}

export interface ChosenEntry {
  readonly productCode: string;
  /** Days for a per-day ticket, in date order; empty for a whole-event pass. */
  readonly days: readonly IsoDate[];
}

interface PersonBase {
  /** Client-side only: keys the list and links the form to the person. Never sent. */
  readonly id: string;
  /** Null until a ticket is chosen, and always null below the free age. */
  readonly entry: ChosenEntry | null;
}

/** The booker, attending. Name, age and phone are read from `BookingState.booker`, never copied. */
export interface BookerAttendee extends PersonBase {
  readonly kind: "booker";
}

export interface Guest extends PersonBase {
  readonly kind: "guest";
  readonly fullName: string;
  readonly ageText: string;
  /** Adults only; cleared when the age makes them a child. */
  readonly phone: string;
}

export type Person = BookerAttendee | Guest;

export interface ExtraSelection {
  readonly productCode: string;
  /** The day for a per-day extra; null for a whole-event extra. */
  readonly day: IsoDate | null;
  /** Always a positive whole number; a selection set to 0 is removed. */
  readonly quantity: number;
}

/** Everything the family has entered. The single source of truth for the form. */
export interface BookingState {
  readonly step: Step;
  readonly booker: BookerDetails;
  /** Everyone coming, in form order. Holds at most one `BookerAttendee`. */
  readonly people: readonly Person[];
  readonly extras: readonly ExtraSelection[];
  readonly promoCode: string;
}
