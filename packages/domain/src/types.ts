import type { IsoDate } from "./dates";
import type { Cents } from "./money";

// ---------------------------------------------------------------------------
// Catalog: what the server knows about the event (loaded from the database).
// ---------------------------------------------------------------------------

export interface AgeRules {
  /** Ages are whole years on this date. */
  readonly referenceDate: IsoDate;
  /** Below this age: free, no ticket, still counted at the door. */
  readonly childMinAge: number;
  /** From this age a person needs an adult ticket. */
  readonly adultMinAge: number;
  /** The person paying must be at least this old. */
  readonly bookerMinAge: number;
}

export interface EventInfo {
  readonly slug: string;
  readonly timezone: string;
  /** Every festival day, ascending. */
  readonly days: readonly IsoDate[];
  readonly ageRules: AgeRules;
}

export type DayScope = "per_day" | "whole_event";

interface ProductBase {
  /** Stable machine key. Used for lookup only; no rule depends on its value. */
  readonly code: string;
  /** Free to rename. Used in messages only. */
  readonly name: string;
  readonly dayScope: DayScope;
  readonly unitPriceCents: Cents;
  /** Days the product can be used or bought for. Whole-event passes list every day. */
  readonly availableDays: readonly IsoDate[];
  /** Live stock: units that can still be sold. */
  readonly remaining: number;
}

/** A ticket. One unit admits `admits.adults` adults and `admits.children` children. */
export interface EntryProduct extends ProductBase {
  readonly kind: "entry";
  readonly admits: { readonly adults: number; readonly children: number };
}

/** Bought alongside tickets (meals, workshops, souvenirs). Admits nobody. */
export interface ExtraProduct extends ProductBase {
  readonly kind: "extra";
  readonly maxPerBooking: number | null;
  /** Bought per person per day: quantity on a day may not exceed the ticketed attendees that day. */
  readonly cappedByDailyHeadcount: boolean;
}

export type Product = EntryProduct | ExtraProduct;

export type PromoDiscount =
  | { readonly type: "percent_off_total"; readonly percentBps: number }
  | { readonly type: "amount_off_total"; readonly amountCents: Cents }
  | { readonly type: "child_entry_free" };

export interface Promo {
  readonly code: string;
  readonly discount: PromoDiscount;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  readonly maxRedemptions: number | null;
  readonly timesRedeemed: number;
  readonly isActive: boolean;
}

export interface Catalog {
  readonly event: EventInfo;
  /** Active products, in display order. */
  readonly products: readonly Product[];
  /** Server-side only; never sent to the browser. */
  readonly promos: readonly Promo[];
}

// ---------------------------------------------------------------------------
// Cart: what the family asked for. Intent only: no prices, no lines.
// ---------------------------------------------------------------------------

export interface CartEntry {
  readonly productCode: string;
  /** Days for a per-day ticket. Must be empty for a whole-event ticket. */
  readonly days: readonly IsoDate[];
}

export interface CartAttendee {
  readonly ageYears: number;
  /** `null` only for children under the free age. */
  readonly entry: CartEntry | null;
}

export interface CartExtra {
  readonly productCode: string;
  /** Required for per-day extras, `null` for whole-event extras. */
  readonly day: IsoDate | null;
  readonly quantity: number;
}

export interface Cart {
  /** The person paying. `null` while the family is still filling in the form. */
  readonly booker: { readonly ageYears: number } | null;
  readonly attendees: readonly CartAttendee[];
  readonly extras: readonly CartExtra[];
  readonly promoCode: string | null;
}

// ---------------------------------------------------------------------------
// Derived: what the server works out from a cart.
// ---------------------------------------------------------------------------

/** One row of the bill. */
export interface BookingLine {
  readonly productCode: string;
  /** `null` for whole-event products. */
  readonly day: IsoDate | null;
  readonly quantity: number;
}

/** Every line prices the same way: unit price x quantity. */
export interface PricedLine extends BookingLine {
  readonly productName: string;
  readonly unitPriceCents: Cents;
  readonly lineTotalCents: Cents;
}

/** The door list: this attendee may enter on this day, paid for by line (productCode, lineDay). */
export interface Admission {
  readonly attendeeIndex: number;
  readonly day: IsoDate;
  readonly productCode: string;
  readonly lineDay: IsoDate | null;
}
