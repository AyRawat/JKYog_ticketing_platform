import type { CatalogProduct, CatalogResponse } from "@ticketing/contracts";
import { ageBand, isValidAge, type IsoDate } from "@ticketing/domain";
import { parseAgeText } from "./age-input";
import { daysFor, entryForAge, findEntryProduct } from "./ticket-for-age";
import type {
  BookerAttendee,
  BookerDetails,
  BookingState,
  ChosenEntry,
  Guest,
  Person,
  PersonExtras,
} from "./types";

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
      readonly type: "extraDayToggled";
      readonly id: string;
      readonly productCode: string;
      readonly day: IsoDate;
    }
  | {
      readonly type: "extraQuantitySet";
      readonly id: string;
      readonly productCode: string;
      readonly quantity: number;
    }
  | { readonly type: "promoCodeChanged"; readonly code: string }
  | { readonly type: "fieldTouched"; readonly key: string }
  | { readonly type: "payAttempted" };

export const NO_EXTRAS: PersonExtras = { days: {}, quantities: {} };

const newBookerAttendee = (): BookerAttendee => ({
  kind: "booker",
  id: BOOKER_PERSON_ID,
  entry: null,
  extras: NO_EXTRAS,
});

/** A new booking: the booker is assumed to be coming, since most are. */
export const initialBookingState: BookingState = {
  booker: { fullName: "", email: "", phone: "", ageText: "" },
  people: [newBookerAttendee()],
  detachedBooker: null,
  promoCode: "",
  touched: [],
  payAttempted: false,
};

/** The age text of anyone in `people`, wherever it is stored. */
export function personAgeText(state: BookingState, person: Person): string {
  return person.kind === "booker" ? state.booker.ageText : person.ageText;
}

/** The days a ticket gets someone in: every festival day for a whole-event pass. */
export function admittedDays(entry: ChosenEntry | null, catalog: CatalogResponse): IsoDate[] {
  if (!entry) return [];
  const product = findEntryProduct(catalog, entry.productCode);
  if (!product) return [];
  return product.dayScope === "whole_event"
    ? catalog.event.days.map((day) => day.date)
    : [...entry.days];
}

export type CatalogExtraProduct = Extract<CatalogProduct, { kind: "extra" }>;

export function findExtraProduct(
  catalog: CatalogResponse,
  code: string,
): CatalogExtraProduct | undefined {
  return catalog.products.find(
    (product): product is CatalogExtraProduct => product.kind === "extra" && product.code === code,
  );
}

/** Bound to the catalog, which age bands and tickets are resolved against. */
export function createBookingReducer(catalog: CatalogResponse) {
  /** Sets a person's ticket and drops any per-day extra on a day it no longer covers. */
  function withEntry<P extends Person>(person: P, entry: ChosenEntry | null): P {
    const admitted = new Set(admittedDays(entry, catalog));
    const days: Record<string, IsoDate[]> = {};
    for (const [code, chosen] of Object.entries(person.extras.days)) {
      const kept = (chosen ?? []).filter((day) => admitted.has(day));
      if (kept.length > 0) days[code] = kept;
    }
    return { ...person, entry, extras: { ...person.extras, days } };
  }

  return function bookingReducer(state: BookingState, action: BookingAction): BookingState {
    switch (action.type) {
      case "bookerChanged":
        return { ...state, booker: { ...state.booker, [action.field]: action.value } };

      case "bookerAttendingSet": {
        const current = state.people.find((person) => person.kind === "booker");
        if (action.attending === (current !== undefined)) return state;
        if (!action.attending) {
          return {
            ...state,
            people: state.people.filter((person) => person.kind !== "booker"),
            detachedBooker: current ?? null,
          };
        }
        return {
          ...state,
          people: [state.detachedBooker ?? newBookerAttendee(), ...state.people],
          detachedBooker: null,
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
          extras: NO_EXTRAS,
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
          const band =
            ageYears !== null && isValidAge(ageYears)
              ? ageBand(ageYears, catalog.event.ageRules)
              : null;
          let next = withEntry(person, entryForAge(person.entry, ageYears, catalog));
          // Under-5s come free with no ticket, so they have no extras of their own either.
          if (band === "infant") next = { ...next, extras: NO_EXTRAS };
          if (next.kind === "booker") return next;
          // Children never give a phone number, so drop one typed while they were an adult.
          return band === "adult" || band === null ? next : { ...next, phone: "" };
        });

      case "personRemoved":
        return { ...state, people: state.people.filter((person) => person.id !== action.id) };

      case "ticketChosen":
        return updatePerson(state, action.id, (person) => {
          if (action.productCode === null) return withEntry(person, null);
          const product = findEntryProduct(catalog, action.productCode);
          if (!product) return person;
          return withEntry(person, {
            productCode: product.code,
            days: daysFor(product, person.entry?.days ?? []),
          });
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
          return withEntry(person, { ...person.entry, days: toggled });
        });

      case "extraDayToggled":
        return updatePerson(state, action.id, (person) => {
          const product = findExtraProduct(catalog, action.productCode);
          if (product?.dayScope !== "per_day") return person;
          const chosen = person.extras.days[product.code] ?? [];
          const has = chosen.includes(action.day);
          // Only on a day the extra runs and this person is coming.
          if (
            !has &&
            (!product.availableDays.includes(action.day) ||
              !admittedDays(person.entry, catalog).includes(action.day))
          ) {
            return person;
          }
          const next = has
            ? chosen.filter((day) => day !== action.day)
            : [...chosen, action.day].sort();
          const otherDays = without(person.extras.days, product.code);
          const days = next.length > 0 ? { ...otherDays, [product.code]: next } : otherDays;
          return { ...person, extras: { ...person.extras, days } };
        });

      case "extraQuantitySet":
        return updatePerson(state, action.id, (person) => {
          const product = findExtraProduct(catalog, action.productCode);
          if (product?.dayScope !== "whole_event") return person;
          const others = without(person.extras.quantities, product.code);
          const keep = Number.isInteger(action.quantity) && action.quantity > 0;
          const quantities = keep ? { ...others, [product.code]: action.quantity } : others;
          return { ...person, extras: { ...person.extras, quantities } };
        });

      case "promoCodeChanged":
        return { ...state, promoCode: action.code };

      case "fieldTouched":
        return state.touched.includes(action.key)
          ? state
          : { ...state, touched: [...state.touched, action.key] };

      case "payAttempted":
        return state.payAttempted ? state : { ...state, payAttempted: true };
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

/** A copy of a record without one key. */
function without<T>(
  record: Readonly<Partial<Record<string, T>>>,
  key: string,
): Partial<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}
