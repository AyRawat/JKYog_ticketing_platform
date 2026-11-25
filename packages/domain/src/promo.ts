import { requireProduct, type RuleContext } from "./context";
import { formatDay, localDate } from "./dates";
import { formatCents, percentOfCents, type Cents } from "./money";
import type { PricedLine, Promo, PromoDiscount } from "./types";

export const PROMO_REJECTIONS = [
  "PROMO_NOT_FOUND",
  "PROMO_INACTIVE",
  "PROMO_NOT_YET_VALID",
  "PROMO_EXPIRED",
  "PROMO_EXHAUSTED",
  "PROMO_NOT_APPLICABLE",
] as const;

export type PromoRejection = (typeof PROMO_REJECTIONS)[number];

export type PromoResult =
  | {
      readonly status: "applied";
      readonly code: string;
      readonly discountCents: Cents;
      readonly message: string;
    }
  | {
      readonly status: "rejected";
      readonly code: string;
      readonly reason: PromoRejection;
      readonly message: string;
    };

/** Codes are matched ignoring case and surrounding spaces: " seva10 " finds SEVA10. */
export function findPromo(promos: readonly Promo[], input: string): Promo | undefined {
  const wanted = input.trim().toLowerCase();
  return promos.find((promo) => promo.code.toLowerCase() === wanted);
}

/** Why a code can't be used right now, or `null` if it can. Checked in a fixed order. */
export function promoValidityProblem(promo: Promo, now: Date): PromoRejection | null {
  if (!promo.isActive) return "PROMO_INACTIVE";
  if (promo.validFrom && now < promo.validFrom) return "PROMO_NOT_YET_VALID";
  if (promo.validUntil && now > promo.validUntil) return "PROMO_EXPIRED";
  if (promo.maxRedemptions !== null && promo.timesRedeemed >= promo.maxRedemptions) {
    return "PROMO_EXHAUSTED";
  }
  return null;
}

/**
 * Lines a "child entry free" code makes free: entry tickets that admit children and no adults.
 * Chosen by who the ticket admits, never by its code. The Family Pass admits adults too, so it
 * is not discounted (it is already a bundle price, with no per-child share). Extras never are.
 */
export function isChildOnlyEntryLine(line: PricedLine, ctx: RuleContext): boolean {
  const product = requireProduct(ctx, line.productCode);
  return product.kind === "entry" && product.admits.children > 0 && product.admits.adults === 0;
}

/** The discount a code gives on these lines. Never more than the subtotal. */
export function discountFor(
  discount: PromoDiscount,
  lines: readonly PricedLine[],
  subtotalCents: Cents,
  ctx: RuleContext,
): Cents {
  switch (discount.type) {
    case "percent_off_total":
      return Math.min(percentOfCents(subtotalCents, discount.percentBps), subtotalCents);
    case "amount_off_total":
      return Math.min(discount.amountCents, subtotalCents);
    case "child_entry_free":
      return lines
        .filter((line) => isChildOnlyEntryLine(line, ctx))
        .reduce((sum, line) => sum + line.lineTotalCents, 0);
  }
}

/** Applies at most one code to a priced cart. `null` when no code was entered. */
export function evaluatePromo(
  input: string | null,
  promos: readonly Promo[],
  lines: readonly PricedLine[],
  subtotalCents: Cents,
  now: Date,
  ctx: RuleContext,
): PromoResult | null {
  if (input === null || input.trim() === "") return null;
  const promo = findPromo(promos, input);
  if (!promo) return rejected(input.trim().toUpperCase(), "PROMO_NOT_FOUND", ctx);

  const problem = promoValidityProblem(promo, now);
  if (problem) return rejected(promo.code, problem, ctx, promo);

  const discountCents = discountFor(promo.discount, lines, subtotalCents, ctx);
  if (discountCents === 0 && subtotalCents > 0) {
    return rejected(promo.code, "PROMO_NOT_APPLICABLE", ctx, promo);
  }
  return {
    status: "applied",
    code: promo.code,
    discountCents,
    message: appliedMessage(promo.discount),
  };
}

function appliedMessage(discount: PromoDiscount): string {
  switch (discount.type) {
    case "percent_off_total": {
      const whole = Math.floor(discount.percentBps / 100);
      const fraction = discount.percentBps % 100;
      const percent = fraction === 0 ? `${whole}` : `${whole}.${String(fraction).padStart(2, "0")}`;
      return `${percent}% off your booking.`;
    }
    case "amount_off_total":
      return `${formatCents(discount.amountCents)} off your booking.`;
    case "child_entry_free":
      return "Child tickets are free.";
  }
}

function rejected(
  code: string,
  reason: PromoRejection,
  ctx: RuleContext,
  promo?: Promo,
): PromoResult {
  return { status: "rejected", code, reason, message: rejectionMessage(reason, ctx, promo) };
}

function rejectionMessage(reason: PromoRejection, ctx: RuleContext, promo?: Promo): string {
  switch (reason) {
    case "PROMO_NOT_FOUND":
      return "We don't recognise that code. Please check the spelling.";
    case "PROMO_INACTIVE":
      return "This code is no longer active.";
    case "PROMO_NOT_YET_VALID":
      return promo?.validFrom
        ? `This code can be used from ${formatDay(localDate(promo.validFrom, ctx.event.timezone))}.`
        : "This code isn't active yet.";
    case "PROMO_EXPIRED":
      return promo?.validUntil
        ? `This code expired on ${formatDay(localDate(promo.validUntil, ctx.event.timezone))}.`
        : "This code has expired.";
    case "PROMO_EXHAUSTED":
      return "This code has reached its usage limit.";
    case "PROMO_NOT_APPLICABLE":
      return promo?.discount.type === "child_entry_free"
        ? "This code makes child tickets free, but there are none in this booking."
        : "This code doesn't apply to anything in this booking.";
  }
}
