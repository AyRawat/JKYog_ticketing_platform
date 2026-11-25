import { isWholeEventOnSale, type RuleContext } from "./context";
import { formatDay, type IsoDate } from "./dates";
import type { ResolvedEntry } from "./entries";
import { productAdmitsBand } from "./age";
import { plural } from "./issues";
import { formatCents, type Cents } from "./money";
import type { EntryProduct } from "./types";

export const NOTICE_CODES = ["CHEAPER_BUNDLE_AVAILABLE", "CHEAPER_WHOLE_EVENT_PASS"] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

/** Advice, never a block: the family decides. Nothing in the cart is changed. */
export interface Notice {
  readonly code: NoticeCode;
  readonly path: string;
  readonly message: string;
  readonly savingsCents: Cents;
}

const isSingleAdmit = (product: EntryProduct) =>
  product.admits.adults + product.admits.children === 1;
const isBundle = (product: EntryProduct) =>
  product.admits.adults > 0 && product.admits.children > 0;

/** Ways the same people could get in for less, computed from catalog prices only. */
export function findSavings(entries: readonly ResolvedEntry[], ctx: RuleContext): Notice[] {
  return [...cheaperBundles(entries, ctx), ...cheaperWholeEventPasses(entries, ctx)];
}

/**
 * Adults and children on single-person day passes on the same day, who would fit a bundle
 * (e.g. 2 adults + 2 children on Day Passes: a Family Pass saves $6).
 */
function cheaperBundles(entries: readonly ResolvedEntry[], ctx: RuleContext): Notice[] {
  const bundles = [...ctx.products.values()].filter(
    (product): product is EntryProduct =>
      product.kind === "entry" &&
      product.dayScope === "per_day" &&
      isBundle(product) &&
      product.remaining > 0,
  );
  if (bundles.length === 0) return [];

  const pricesByDay = new Map<IsoDate, { adult: Cents[]; child: Cents[] }>();
  for (const entry of entries) {
    if (entry.product.dayScope !== "per_day" || !isSingleAdmit(entry.product)) continue;
    for (const day of entry.days) {
      const prices = pricesByDay.get(day) ?? { adult: [], child: [] };
      prices[entry.band].push(entry.product.unitPriceCents);
      pricesByDay.set(day, prices);
    }
  }

  const notices: Notice[] = [];
  for (const [day, prices] of pricesByDay) {
    let best: { product: EntryProduct; units: number; cost: Cents; saving: Cents } | undefined;
    for (const bundle of bundles) {
      if (!bundle.availableDays.includes(day)) continue;
      const units = Math.min(
        Math.floor(prices.adult.length / bundle.admits.adults),
        Math.floor(prices.child.length / bundle.admits.children),
        bundle.remaining,
      );
      if (units < 1) continue;
      const cost =
        sumOfHighest(prices.adult, units * bundle.admits.adults) +
        sumOfHighest(prices.child, units * bundle.admits.children);
      const saving = cost - units * bundle.unitPriceCents;
      if (saving > 0 && (!best || saving > best.saving))
        best = { product: bundle, units, cost, saving };
    }
    if (!best) continue;
    const { product, units, cost, saving } = best;
    notices.push({
      code: "CHEAPER_BUNDLE_AVAILABLE",
      path: "attendees",
      savingsCents: saving,
      message: `Switching ${plural(units * product.admits.adults, "adult")} and ${plural(units * product.admits.children, "child", "children")} to ${product.name} on ${formatDay(day)} would cost ${formatCents(units * product.unitPriceCents)} instead of ${formatCents(cost)}, saving ${formatCents(saving)}.`,
    });
  }
  return notices;
}

/** One person on day passes for enough days that a whole-event pass would cost less. */
function cheaperWholeEventPasses(entries: readonly ResolvedEntry[], ctx: RuleContext): Notice[] {
  if (!isWholeEventOnSale(ctx)) return [];
  const passes = [...ctx.products.values()].filter(
    (product): product is EntryProduct =>
      product.kind === "entry" &&
      product.dayScope === "whole_event" &&
      isSingleAdmit(product) &&
      product.remaining > 0,
  );

  const notices: Notice[] = [];
  for (const entry of entries) {
    if (entry.product.dayScope !== "per_day" || !isSingleAdmit(entry.product)) continue;
    const cost = entry.product.unitPriceCents * entry.days.length;
    const cheapest = passes
      .filter((pass) => productAdmitsBand(pass, entry.band) && pass.unitPriceCents < cost)
      .sort((a, b) => a.unitPriceCents - b.unitPriceCents)[0];
    if (!cheapest) continue;
    const saving = cost - cheapest.unitPriceCents;
    notices.push({
      code: "CHEAPER_WHOLE_EVENT_PASS",
      path: `attendees[${entry.attendeeIndex}].entry.productCode`,
      savingsCents: saving,
      message: `${cheapest.name} covers every festival day for ${formatCents(cheapest.unitPriceCents)}, less than ${formatCents(cost)} for ${plural(entry.days.length, "day pass", "day passes")}. You'd save ${formatCents(saving)}.`,
    });
  }
  return notices;
}

function sumOfHighest(values: readonly Cents[], count: number): Cents {
  return [...values]
    .sort((a, b) => b - a)
    .slice(0, count)
    .reduce((sum, value) => sum + value, 0);
}
