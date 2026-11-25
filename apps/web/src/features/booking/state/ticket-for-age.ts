import type { CatalogProduct, CatalogResponse } from "@ticketing/contracts";
import { ageBand, isValidAge, type IsoDate, type TicketedBand } from "@ticketing/domain";
import type { ChosenEntry } from "./types";

// Keeps a person's ticket in step with their age, so people and tickets never drift apart.
// This only shapes the form: the server checks every ticket against every age again.

export type CatalogEntryProduct = Extract<CatalogProduct, { kind: "entry" }>;

export function findEntryProduct(
  catalog: CatalogResponse,
  code: string,
): CatalogEntryProduct | undefined {
  return catalog.products.find(
    (product): product is CatalogEntryProduct => product.kind === "entry" && product.code === code,
  );
}

export function admitsBand(product: CatalogEntryProduct, band: TicketedBand): boolean {
  return band === "adult" ? product.admits.adults > 0 : product.admits.children > 0;
}

const isSingleAdmit = (product: CatalogEntryProduct) =>
  product.admits.adults + product.admits.children === 1;

/** The days a ticket keeps when switching to `product`: none for a whole-event pass. */
export function daysFor(product: CatalogEntryProduct, days: readonly IsoDate[]): IsoDate[] {
  if (product.dayScope === "whole_event") return [];
  return days.filter((day) => product.availableDays.includes(day));
}

/**
 * The ticket a person should hold once their age is entered:
 * - under the free age: no ticket;
 * - a ticket that still fits the age (or a bundle like the Family Pass): kept;
 * - otherwise the same kind of pass for the new band, on the same days
 *   (Adult Day Pass → Child Day Pass), if one is on sale; else none, so they choose again.
 * An age that isn't a valid whole number changes nothing.
 */
export function entryForAge(
  entry: ChosenEntry | null,
  ageYears: number | null,
  catalog: CatalogResponse,
): ChosenEntry | null {
  if (ageYears === null || !isValidAge(ageYears)) return entry;

  const band = ageBand(ageYears, catalog.event.ageRules);
  if (band === "infant" || entry === null) return null;

  const current = findEntryProduct(catalog, entry.productCode);
  if (!current || admitsBand(current, band)) return entry;

  const counterpart = catalog.products.find(
    (product): product is CatalogEntryProduct =>
      product.kind === "entry" &&
      product.availability === "on_sale" &&
      product.dayScope === current.dayScope &&
      isSingleAdmit(product) &&
      admitsBand(product, band),
  );
  return counterpart
    ? { productCode: counterpart.code, days: daysFor(counterpart, entry.days) }
    : null;
}
