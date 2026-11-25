import { formatDay, formatDayList, localDate, type IsoDate } from "./dates";
import { issue, type Issue } from "./issues";
import type { Catalog, EventInfo, Product } from "./types";

/** Everything a rule needs to know about the event, resolved once per quote. */
export interface RuleContext {
  readonly event: EventInfo;
  /** Today's date in the event's timezone. */
  readonly today: IsoDate;
  readonly products: ReadonlyMap<string, Product>;
}

export function buildContext(catalog: Catalog, now: Date): RuleContext {
  return {
    event: catalog.event,
    today: localDate(now, catalog.event.timezone),
    products: new Map(catalog.products.map((product) => [product.code, product])),
  };
}

/** Lines only ever reference known products, so a miss here is a programming error. */
export function requireProduct(ctx: RuleContext, code: string): Product {
  const product = ctx.products.get(code);
  if (!product) throw new Error(`Unknown product code in derived data: ${code}`);
  return product;
}

/** A per-day product can be used on `day` if the day is one of its days and hasn't passed. */
export function checkProductDay(
  product: Product,
  day: IsoDate,
  ctx: RuleContext,
  path: string,
): Issue | null {
  if (!product.availableDays.includes(day)) {
    if (!ctx.event.days.includes(day)) {
      const first = ctx.event.days[0];
      const last = ctx.event.days.at(-1);
      const range =
        first && last ? ` The festival runs ${formatDay(first)}–${formatDay(last)}.` : "";
      return issue("DAY_NOT_AVAILABLE", path, `${formatDay(day)} is not a festival day.${range}`);
    }
    return issue(
      "DAY_NOT_AVAILABLE",
      path,
      `${product.name} is only available on ${formatDayList(product.availableDays)}.`,
    );
  }
  if (day < ctx.today) {
    return issue("DAY_IN_PAST", path, `${formatDay(day)} has already passed.`);
  }
  return null;
}

/** Whole-event products stop selling once the festival's first day has begun. */
export function isWholeEventOnSale(ctx: RuleContext): boolean {
  const firstDay = ctx.event.days[0];
  return firstDay !== undefined && ctx.today < firstDay;
}
