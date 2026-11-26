import type { CatalogProduct, CatalogResponse } from "@ticketing/contracts";
import { ageBand, isValidAge, type IsoDate } from "@ticketing/domain";
import { parseAgeText } from "./age-input";
import { daysFor, entryForAge, findEntryProduct, type CatalogEntryProduct } from "./ticket-for-age";
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
  | {
      readonly type: "bookerAttendingSet";
      readonly attending: boolean;
      /** If the booker holds a family place, a new guest takes it over under this id. */
      readonly replacementId?: string;
    }
  /** Ids come from the caller so the reducer stays pure. Name and age may be prefilled. */
  | {
      readonly type: "guestAdded";
      readonly id: string;
      readonly fullName?: string;
      readonly ageText?: string;
    }
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
  /**
   * A shared pass (the Family Pass) was chosen in someone's card: that person takes a place on
   * it and the other places are added as new, empty people under `newIds`.
   */
  | {
      readonly type: "familyStarted";
      readonly id: string;
      readonly productCode: string;
      readonly familyId: string;
      readonly newIds: readonly string[];
    }
  | { readonly type: "familyDayToggled"; readonly familyId: string; readonly day: IsoDate }
  /** Back to one card each: names and ages stay, tickets are cleared, empty places go. */
  | { readonly type: "familySplit"; readonly familyId: string }
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
  /**
   * A day the group is coming was picked or unpicked. Unpicking takes it off everyone, with
   * their extras that day; picking leaves people as they are, since their days were a choice.
   */
  | { readonly type: "visitDayToggled"; readonly day: IsoDate }
  | { readonly type: "promoCodeChanged"; readonly code: string }
  | { readonly type: "fieldTouched"; readonly key: string }
  | { readonly type: "payAttempted" };

export const NO_EXTRAS: PersonExtras = { days: {}, quantities: {} };

const newBookerAttendee = (): BookerAttendee => ({
  kind: "booker",
  id: BOOKER_PERSON_ID,
  family: null,
  entry: null,
  extras: NO_EXTRAS,
});

const newGuest = (
  id: string,
  fields: Partial<Pick<Guest, "fullName" | "ageText">> = {},
): Guest => ({
  kind: "guest",
  id,
  family: null,
  fullName: fields.fullName ?? "",
  ageText: fields.ageText ?? "",
  phone: "",
  entry: null,
  extras: NO_EXTRAS,
});

/** A ticket that admits adults and children together, such as the Family Pass. */
export function isSharedPass(product: CatalogEntryProduct): boolean {
  return product.admits.adults > 0 && product.admits.children > 0;
}

/** Everyone holding a place on one family's pass, in list order. */
export function familyMembers(state: BookingState, familyId: string): Person[] {
  return state.people.filter((person) => person.family?.familyId === familyId);
}

/** A new booking: the booker is assumed to be coming, since most are. */
export const initialBookingState: BookingState = {
  booker: { fullName: "", email: "", phone: "", ageText: "" },
  visitDays: [],
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
          if (!current) return state;
          // A family place the booker held stays on the pass, empty, for someone else.
          const replacement =
            current.family && action.replacementId
              ? { ...newGuest(action.replacementId), family: current.family, entry: current.entry }
              : null;
          return {
            ...state,
            people: state.people.flatMap((person) =>
              person.kind !== "booker" ? [person] : replacement ? [replacement] : [],
            ),
            // Kept to bring back later, but off the family pass, which has moved on.
            detachedBooker: current.family
              ? { ...current, family: null, entry: null, extras: NO_EXTRAS }
              : current,
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
        const guest = newGuest(action.id, {
          fullName: action.fullName ?? "",
          ageText: action.ageText ?? "",
        });
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
          // A family place keeps the family's ticket; the place's age check says if it doesn't fit.
          const entry = person.family ? person.entry : entryForAge(person.entry, ageYears, catalog);
          let next = withEntry(person, entry);
          // Under-5s come free with no ticket, so they have no extras of their own either.
          if (band === "infant") next = { ...next, extras: NO_EXTRAS };
          if (next.kind === "booker") return next;
          // Children never give a phone number, so drop one typed while they were an adult.
          return band === "adult" || band === null ? next : { ...next, phone: "" };
        });

      case "personRemoved":
        // Family places go together, with familySplit.
        return {
          ...state,
          people: state.people.filter((person) => person.id !== action.id || person.family),
        };

      case "ticketChosen":
        return updatePerson(state, action.id, (person) => {
          // A family's ticket is changed on the family card, never one member at a time.
          if (person.family) return person;
          if (action.productCode === null) return withEntry(person, null);
          const product = findEntryProduct(catalog, action.productCode);
          if (!product) return person;
          return withEntry(person, {
            productCode: product.code,
            days: daysFor(product, startingDays(state, person.entry)),
          });
        });

      case "dayToggled":
        return updatePerson(state, action.id, (person) => {
          if (!person.entry || person.family) return person;
          // Whole-event passes cover every day; there is nothing to pick.
          const product = findEntryProduct(catalog, person.entry.productCode);
          if (product?.dayScope !== "per_day") return person;
          const { days } = person.entry;
          const toggled = days.includes(action.day)
            ? days.filter((day) => day !== action.day)
            : [...days, action.day].sort();
          return withEntry(person, { ...person.entry, days: toggled });
        });

      case "familyStarted": {
        const product = findEntryProduct(catalog, action.productCode);
        const index = state.people.findIndex((person) => person.id === action.id);
        const chooser = state.people[index];
        if (!product || !isSharedPass(product) || !chooser || chooser.family) return state;

        const roles: ("adult" | "child")[] = [
          ...Array<"adult">(product.admits.adults).fill("adult"),
          ...Array<"child">(product.admits.children).fill("child"),
        ];
        const ageYears = parseAgeText(personAgeText(state, chooser));
        const isChild =
          ageYears !== null &&
          isValidAge(ageYears) &&
          ageBand(ageYears, catalog.event.ageRules) === "child";
        const chooserRole = isChild ? "child" : "adult";
        roles.splice(roles.indexOf(chooserRole), 1);
        if (action.newIds.length !== roles.length) return state;
        if (action.newIds.some((id) => state.people.some((person) => person.id === id))) {
          return state;
        }

        const entry = {
          productCode: product.code,
          days: daysFor(product, startingDays(state, chooser.entry)),
        };
        const { familyId } = action;
        const placed = withEntry({ ...chooser, family: { familyId, role: chooserRole } }, entry);
        const others = roles.map((role, i) => ({
          ...newGuest(action.newIds[i] ?? ""),
          family: { familyId, role },
          entry,
        }));
        // Adults first, then children, kept together where the chooser was.
        const members = [placed, ...others].sort(
          (a, b) => Number(a.family.role === "child") - Number(b.family.role === "child"),
        );
        return {
          ...state,
          people: [...state.people.slice(0, index), ...members, ...state.people.slice(index + 1)],
        };
      }

      case "familyDayToggled": {
        const members = familyMembers(state, action.familyId);
        const entry = members[0]?.entry;
        if (!entry) return state;
        const product = findEntryProduct(catalog, entry.productCode);
        if (!product?.availableDays.includes(action.day)) return state;
        const days = entry.days.includes(action.day)
          ? entry.days.filter((day) => day !== action.day)
          : [...entry.days, action.day].sort();
        return {
          ...state,
          people: state.people.map((person) =>
            person.family?.familyId === action.familyId
              ? withEntry(person, { ...entry, days })
              : person,
          ),
        };
      }

      case "familySplit":
        return {
          ...state,
          people: state.people.flatMap((person) => {
            if (person.family?.familyId !== action.familyId) return [person];
            const empty =
              person.kind === "guest" && !person.fullName.trim() && !person.ageText.trim();
            return empty ? [] : [withEntry({ ...person, family: null }, null)];
          }),
        };

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

      case "visitDayToggled": {
        const { day } = action;
        if (!state.visitDays.includes(day)) {
          if (!catalog.event.days.some((d) => d.date === day && d.bookable)) return state;
          return { ...state, visitDays: [...state.visitDays, day].sort() };
        }
        const dropDay = <P extends Person>(person: P): P =>
          person.entry?.days.includes(day)
            ? withEntry(person, {
                ...person.entry,
                days: person.entry.days.filter((d) => d !== day),
              })
            : person;
        return {
          ...state,
          visitDays: state.visitDays.filter((d) => d !== day),
          people: state.people.map(dropDay),
          detachedBooker: state.detachedBooker && dropDay(state.detachedBooker),
        };
      }

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

/**
 * The days a newly chosen ticket starts on: the days the person already had, or else the
 * group's days.
 */
function startingDays(state: BookingState, entry: ChosenEntry | null): readonly IsoDate[] {
  return entry && entry.days.length > 0 ? entry.days : state.visitDays;
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
