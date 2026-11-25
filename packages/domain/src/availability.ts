import { buildContext, isWholeEventOnSale, type RuleContext } from "./context";
import type { IsoDate } from "./dates";
import type { Catalog, Product } from "./types";

/**
 * What the booking form can offer right now.
 * - `sale_closed`: can never be bought again (its days have passed, or the festival has started
 *   for a whole-event pass).
 * - `sold_out`: no stock left.
 */
export type Availability = "on_sale" | "sold_out" | "sale_closed";

export interface CatalogAvailability {
  /** Today's date in the event's timezone. */
  readonly today: IsoDate;
  readonly days: readonly { readonly date: IsoDate; readonly bookable: boolean }[];
  readonly products: ReadonlyMap<string, Availability>;
}

/** The same rules the quote enforces, worked out up front so the form can grey things out. */
export function catalogAvailability(catalog: Catalog, now: Date): CatalogAvailability {
  const ctx = buildContext(catalog, now);
  return {
    today: ctx.today,
    days: ctx.event.days.map((date) => ({ date, bookable: date >= ctx.today })),
    products: new Map(
      catalog.products.map((product) => [product.code, availabilityOf(product, ctx)]),
    ),
  };
}

function availabilityOf(product: Product, ctx: RuleContext): Availability {
  if (isSaleClosed(product, ctx)) return "sale_closed";
  return product.remaining > 0 ? "on_sale" : "sold_out";
}

function isSaleClosed(product: Product, ctx: RuleContext): boolean {
  if (product.dayScope === "per_day") {
    return !product.availableDays.some((day) => day >= ctx.today);
  }
  // Whole-event tickets stop at the start of the festival; whole-event extras (souvenirs) don't.
  return product.kind === "entry" && !isWholeEventOnSale(ctx);
}
