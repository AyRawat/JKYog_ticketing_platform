import type { CatalogResponse } from "@ticketing/contracts";
import type { IsoDate } from "@ticketing/domain";
import { parseAgeText } from "./age-input";
import { daysFor, entryForAge, findEntryProduct } from "./ticket-for-age";
import type { BookerDetails, BookingState, Guest, Person, Step } from "./types";

/** The booker's row in `people` while they are attending. */
export const BOOKER_PERSON_ID = "booker";

export type BookingAction =
  | { readonly type: "bookerChanged"; readonly field: keyof BookerDetails; readonly value: string }
  | { readonly type: "bookerAttendingSet"; readonly attending: boolean }
  /** `id` comes from the caller so the reducer stays pure. */
  | { readonly type: "guestAdded"; readonly id: string }
  | {
      readonly type: "guestChanged";
      readonly id: string;
      readonly field: "fullName" | "ageText" | "phone";
      readonly value: string;
    }
  /**
   * The age field was left (blur or Enter). The ticket follows the age only then, so typing
   * "35" doesn't pass through "3", count as an under-5 and lose the ticket on the way.
   */
  | { readonly type: "ageCommitted"; readonly id: string }
  | { readonly type: "personRemoved"; readonly id: string }
  /** null clears the choice. */
  | { readonly type: "ticketChosen"; readonly id: string; readonly productCode: string | null }
  | { readonly type: "dayToggled"; readonly id: string; readonly day: IsoDate }
  | {
      readonly type: "extraQuantitySet";
      readonly productCode: string;
      readonly day: IsoDate | null;
      readonly quantity: number;
    }
  | { readonly type: "promoCodeChanged"; readonly code: string }
  | { readonly type: "stepChanged"; readonly step: Step };

/** A new booking: the booker is assumed to be coming, since most are. */
export const initialBookingState: BookingState = {
  step: "who",
  booker: { fullName: "", email: "", phone: "", ageText: "" },
  people: [{ kind: "booker", id: BOOKER_PERSON_ID, entry: null }],
  extras: [],
  promoCode: "",
};

/** The age text of anyone in `people`, wherever it is stored. */
export function personAgeText(state: BookingState, person: Person): string {
  return person.kind === "booker" ? state.booker.ageText : person.ageText;
}

/** Bound to the catalog, which age bands and tickets are resolved against. */
export function createBookingReducer(catalog: CatalogResponse) {
  return function bookingReducer(state: BookingState, action: BookingAction): BookingState {
    switch (action.type) {
      case "bookerChanged":
        return { ...state, booker: { ...state.booker, [action.field]: action.value } };

      case "bookerAttendingSet": {
        const attending = state.people.some((person) => person.kind === "booker");
        if (action.attending === attending) return state;
        return {
          ...state,
          people: action.attending
            ? [{ kind: "booker", id: BOOKER_PERSON_ID, entry: null }, ...state.people]
            : state.people.filter((person) => person.kind !== "booker"),
        };
      }

      case "guestAdded": {
        if (state.people.some((person) => person.id === action.id)) return state;
        const guest: Guest = {
          kind: "guest",
          id: action.id,
          fullName: "",
          ageText: "",
          phone: "",
          entry: null,
        };
        return { ...state, people: [...state.people, guest] };
      }

      case "guestChanged":
        return updatePerson(state, action.id, (person) =>
          person.kind === "guest" ? { ...person, [action.field]: action.value } : person,
        );

      case "ageCommitted":
        return updatePerson(state, action.id, (person) => {
          const ageYears = parseAgeText(personAgeText(state, person));
          const entry = entryForAge(person.entry, ageYears, catalog);
          if (person.kind === "booker") return { ...person, entry };
          // Children never give a phone number, so drop one typed while they were an adult.
          const isAdult = ageYears !== null && ageYears >= catalog.event.ageRules.adultMinAge;
          return { ...person, entry, phone: isAdult ? person.phone : "" };
        });

      case "personRemoved":
        return { ...state, people: state.people.filter((person) => person.id !== action.id) };

      case "ticketChosen":
        return updatePerson(state, action.id, (person) => {
          if (action.productCode === null) return { ...person, entry: null };
          const product = findEntryProduct(catalog, action.productCode);
          if (!product) return person;
          return {
            ...person,
            entry: { productCode: product.code, days: daysFor(product, person.entry?.days ?? []) },
          };
        });

      case "dayToggled":
        return updatePerson(state, action.id, (person) => {
          if (!person.entry) return person;
          // Whole-event passes cover every day; there is nothing to pick.
          const product = findEntryProduct(catalog, person.entry.productCode);
          if (product?.dayScope !== "per_day") return person;
          const { days } = person.entry;
          const toggled = days.includes(action.day)
            ? days.filter((day) => day !== action.day)
            : [...days, action.day].sort();
          return { ...person, entry: { ...person.entry, days: toggled } };
        });

      case "extraQuantitySet": {
        const { productCode, day, quantity } = action;
        const index = state.extras.findIndex(
          (extra) => extra.productCode === productCode && extra.day === day,
        );
        if (!Number.isInteger(quantity) || quantity <= 0) {
          return { ...state, extras: state.extras.filter((_, i) => i !== index) };
        }
        // Keep an existing selection in place, so the list doesn't reorder as quantities change.
        const extras =
          index === -1
            ? [...state.extras, { productCode, day, quantity }]
            : state.extras.map((extra, i) =>
                i === index ? { productCode, day, quantity } : extra,
              );
        return { ...state, extras };
      }

      case "promoCodeChanged":
        return { ...state, promoCode: action.code };

      case "stepChanged":
        return { ...state, step: action.step };
    }
  };
}

function updatePerson(
  state: BookingState,
  id: string,
  update: (person: Person) => Person,
): BookingState {
  return {
    ...state,
    people: state.people.map((person) => (person.id === id ? update(person) : person)),
  };
}
