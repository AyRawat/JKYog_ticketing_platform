import type { BookingRequestInput, QuoteRequestInput } from "@ticketing/contracts";
import { parseAgeText } from "./age-input";
import { BOOKER_PERSON_ID, personAgeText } from "./reducer";
import type { BookingState, ChosenEntry, Person } from "./types";

// Turn the form's state into API requests. Intent only: who is coming, which tickets, which
// extras, which code. Never a price; the server works that out.

interface ReadablePerson {
  readonly person: Person;
  readonly ageYears: number;
}

/** Everyone whose age can be read, in form order, plus the ids of those whose age can't. */
function readPeople(state: BookingState) {
  const readable: ReadablePerson[] = [];
  const unreadableAgeIds: string[] = [];
  for (const person of state.people) {
    const ageYears = parseAgeText(personAgeText(state, person));
    if (ageYears === null) unreadableAgeIds.push(person.id);
    else readable.push({ person, ageYears });
  }
  return { readable, unreadableAgeIds };
}

const toEntry = (entry: ChosenEntry | null) =>
  entry && { productCode: entry.productCode, days: [...entry.days] };

const toExtras = (state: BookingState) =>
  state.extras.map(({ productCode, day, quantity }) => ({ productCode, day, quantity }));

const toPromoCode = (state: BookingState) => state.promoCode.trim() || null;

/** Blank optional text is "not given". */
const optional = (text: string) => text.trim() || null;

export interface QuoteDraft {
  readonly request: QuoteRequestInput;
  /** `attendeeIds[i]` is the person sent as `attendees[i]`, for matching issues to people. */
  readonly attendeeIds: readonly string[];
  /**
   * People left out because their age isn't a whole number yet. The quote prices everyone
   * else, so the total keeps working while the form is half filled.
   */
  readonly unreadableAgeIds: readonly string[];
}

/** The cart as a quote request: as much of it as can be priced right now. */
export function toQuoteRequest(state: BookingState): QuoteDraft {
  const { readable, unreadableAgeIds } = readPeople(state);
  const bookerAge = parseAgeText(state.booker.ageText);

  return {
    request: {
      booker: bookerAge === null ? null : { ageYears: bookerAge },
      attendees: readable.map(({ person, ageYears }) => ({
        ageYears,
        entry: toEntry(person.entry),
      })),
      extras: toExtras(state),
      promoCode: toPromoCode(state),
    },
    attendeeIds: readable.map(({ person }) => person.id),
    unreadableAgeIds,
  };
}

export type BookingDraft =
  | {
      readonly ok: true;
      readonly request: BookingRequestInput;
      /** `attendeeIds[i]` is the person sent as `attendees[i]`. */
      readonly attendeeIds: readonly string[];
    }
  | {
      readonly ok: false;
      /**
       * Everyone must have a readable age before booking; these don't yet.
       * `BOOKER_PERSON_ID` here means the booker's own age field, attending or not.
       */
      readonly unreadableAgeIds: readonly string[];
    };

/**
 * The whole booking, for the total the family was shown. Names, email and phones go as typed
 * (trimmed): the contract schema is what judges them, on both sides.
 */
export function toBookingRequest(state: BookingState, expectedTotalCents: number): BookingDraft {
  const { readable, unreadableAgeIds } = readPeople(state);
  const bookerAge = parseAgeText(state.booker.ageText);
  if (bookerAge === null || unreadableAgeIds.length > 0) {
    const ids = new Set(unreadableAgeIds);
    if (bookerAge === null) ids.add(BOOKER_PERSON_ID);
    return { ok: false, unreadableAgeIds: [...ids] };
  }

  const { booker } = state;
  return {
    ok: true,
    request: {
      booker: {
        fullName: booker.fullName.trim(),
        email: booker.email.trim(),
        phone: booker.phone.trim(),
        ageYears: bookerAge,
      },
      attendees: readable.map(({ person, ageYears }) => ({
        fullName: (person.kind === "booker" ? booker.fullName : person.fullName).trim(),
        ageYears,
        // The booker's phone is already on the booking as its contact number.
        phone: person.kind === "booker" ? null : optional(person.phone),
        entry: toEntry(person.entry),
      })),
      extras: toExtras(state),
      promoCode: toPromoCode(state),
      expectedTotalCents,
    },
    attendeeIds: readable.map(({ person }) => person.id),
  };
}
