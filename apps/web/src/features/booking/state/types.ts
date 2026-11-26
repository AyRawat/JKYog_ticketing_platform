import type { IsoDate } from "@ticketing/domain";

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

/** The extras one person has chosen. Added up across everyone when a request is built. */
export interface PersonExtras {
  /** Per-day extras (dinner, workshop): the days this person has one, by product code. */
  readonly days: Readonly<Partial<Record<string, readonly IsoDate[]>>>;
  /** Whole-event extras (dandiya sticks): how many this person wants, by product code. */
  readonly quantities: Readonly<Partial<Record<string, number>>>;
}

/** A place on a shared ticket such as the Family Pass. */
export interface FamilyPlace {
  /** Shared by everyone on the same pass. */
  readonly familyId: string;
  /** The place is for an adult or a child; the age typed must fit it. */
  readonly role: "adult" | "child";
}

interface PersonBase {
  /** Client-side only: keys the list and links the form to the person. Never sent. */
  readonly id: string;
  /**
   * Set when this person holds a place on a shared pass. Their ticket and days are then the
   * family's: chosen once on the family card, never per person.
   */
  readonly family: FamilyPlace | null;
  /** Null until a ticket is chosen, and always null below the free age. */
  readonly entry: ChosenEntry | null;
  /** Only ever on days this person is admitted; under-5s have none. */
  readonly extras: PersonExtras;
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

/** Everything the family has entered. The single source of truth for the form. */
export interface BookingState {
  readonly booker: BookerDetails;
  /** Everyone coming, in form order. Holds at most one `BookerAttendee`. */
  readonly people: readonly Person[];
  /**
   * The booker's card while "booking for someone else" is on, so turning it off again brings
   * back their ticket and extras instead of starting over.
   */
  readonly detachedBooker: BookerAttendee | null;
  /** The code the family applied (not what is half-typed in the box). */
  readonly promoCode: string;
  /** Field keys the family has finished with; their problems are shown from then on. */
  readonly touched: readonly string[];
  /** Once they try to pay, every problem is shown. */
  readonly payAttempted: boolean;
}
