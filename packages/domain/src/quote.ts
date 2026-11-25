import { ageBand, checkBooker, isValidAge } from "./age";
import { buildEntryLines } from "./composition";
import { buildContext, type RuleContext } from "./context";
import { resolveEntries } from "./entries";
import { headcountByDay, resolveExtras } from "./extras";
import { issue, type Issue } from "./issues";
import type { Cents } from "./money";
import { findSavings, type Notice } from "./notices";
import { priceLines, subtotalOf } from "./pricing";
import { evaluatePromo, type PromoResult } from "./promo";
import { checkStock } from "./stock";
import type { Admission, BookingLine, Cart, Catalog, PricedLine } from "./types";

export interface Quote {
  readonly lines: readonly PricedLine[];
  readonly admissions: readonly Admission[];
  readonly subtotalCents: Cents;
  readonly discountCents: Cents;
  readonly totalCents: Cents;
  readonly promo: PromoResult | null;
  /** Problems that block booking, each pointing at the part of the cart to fix. */
  readonly issues: readonly Issue[];
  /** Advice only, e.g. a cheaper way to buy the same tickets. Never blocks booking. */
  readonly notices: readonly Notice[];
  /** True only when the cart is complete and valid: no issues, a booker, and no rejected code. */
  readonly canBook: boolean;
}

/**
 * The one place a cart becomes a price. Pure: same catalog + cart + clock -> same quote.
 * The quote endpoint shows this; the booking endpoint charges exactly this.
 *
 * Parts of the cart that break a rule are reported and left off the bill, so a half-filled
 * form still gets a useful running total.
 */
export function quoteCart({
  catalog,
  cart,
  now,
}: {
  catalog: Catalog;
  cart: Cart;
  now: Date;
}): Quote {
  const ctx = buildContext(catalog, now);
  const issues: Issue[] = [];

  if (cart.booker) issues.push(...checkBooker(cart.booker, ctx.event.ageRules));
  issues.push(...checkHasTicketedAttendee(cart, ctx));

  const resolved = resolveEntries(cart.attendees, ctx);
  const entryLines = buildEntryLines(resolved.entries);
  const extras = resolveExtras(cart.extras, ctx, headcountByDay(entryLines.admissions));
  issues.push(...resolved.issues, ...entryLines.issues, ...extras.issues);

  const lines = inCatalogOrder([...entryLines.lines, ...extras.lines], catalog);
  issues.push(...checkStock(lines, ctx, (code) => firstPathFor(code, cart)));

  const priced = priceLines(lines, ctx);
  const subtotalCents = subtotalOf(priced);
  const promo = evaluatePromo(cart.promoCode, catalog.promos, priced, subtotalCents, now, ctx);
  const discountCents = promo?.status === "applied" ? promo.discountCents : 0;

  return {
    lines: priced,
    admissions: entryLines.admissions,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    promo,
    issues,
    notices: findSavings(resolved.entries, ctx),
    canBook:
      issues.length === 0 &&
      cart.booker !== null &&
      lines.length > 0 &&
      (promo === null || promo.status === "applied"),
  };
}

/** A booking must admit someone: at least one attendee, and not only free under-age children. */
function checkHasTicketedAttendee(cart: Cart, ctx: RuleContext): Issue[] {
  if (cart.attendees.length === 0) {
    return [issue("NO_ATTENDEES", "attendees", "Please add at least one person who is coming.")];
  }
  const allFree = cart.attendees.every(
    (attendee) =>
      isValidAge(attendee.ageYears) && ageBand(attendee.ageYears, ctx.event.ageRules) === "infant",
  );
  if (allFree) {
    return [
      issue(
        "NO_TICKETED_ATTENDEE",
        "attendees",
        `Children under ${ctx.event.ageRules.childMinAge} need to come with someone who has a ticket.`,
      ),
    ];
  }
  return [];
}

/** Bill order: catalog display order, then day (whole-event lines first). */
function inCatalogOrder(lines: BookingLine[], catalog: Catalog): BookingLine[] {
  const rank = new Map(catalog.products.map((product, index) => [product.code, index]));
  return lines.sort(
    (a, b) =>
      (rank.get(a.productCode) ?? 0) - (rank.get(b.productCode) ?? 0) ||
      (a.day ?? "").localeCompare(b.day ?? ""),
  );
}

/** Where a stock problem should be shown: the first place in the cart that asks for that product. */
function firstPathFor(code: string, cart: Cart): string {
  const attendee = cart.attendees.findIndex((a) => a.entry?.productCode === code);
  if (attendee >= 0) return `attendees[${attendee}].entry.productCode`;
  const extra = cart.extras.findIndex((e) => e.productCode === code);
  return extra >= 0 ? `extras[${extra}].quantity` : "";
}
