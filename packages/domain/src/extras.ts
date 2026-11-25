import { checkProductDay, type RuleContext } from "./context";
import { formatDay, type IsoDate } from "./dates";
import { issue, plural, type Issue } from "./issues";
import type { Admission, BookingLine, CartExtra, ExtraProduct } from "./types";

/** Ticketed people admitted on each day. Under-free-age children hold no ticket, so never count. */
export function headcountByDay(admissions: readonly Admission[]): ReadonlyMap<IsoDate, number> {
  const people = new Map<IsoDate, Set<number>>();
  for (const { day, attendeeIndex } of admissions) {
    const set = people.get(day) ?? new Set<number>();
    set.add(attendeeIndex);
    people.set(day, set);
  }
  return new Map([...people].map(([day, set]) => [day, set.size]));
}

interface ValidExtra {
  readonly index: number;
  readonly product: ExtraProduct;
  readonly day: IsoDate | null;
  readonly quantity: number;
}

/** Validates extras and turns the valid ones into lines. Invalid items are left off the bill. */
export function resolveExtras(
  extras: readonly CartExtra[],
  ctx: RuleContext,
  headcount: ReadonlyMap<IsoDate, number>,
): { lines: BookingLine[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  let valid: ValidExtra[] = [];

  extras.forEach((extra, index) => {
    const result = checkExtra(extra, index, ctx);
    if ("issue" in result) {
      issues.push(result.issue);
      return;
    }
    const key = `${result.product.code}|${result.day ?? ""}`;
    if (seen.has(key)) {
      issues.push(
        issue(
          "DUPLICATE_EXTRA",
          `extras[${index}]`,
          `${result.product.name}${result.day ? ` on ${formatDay(result.day)}` : ""} is listed twice. Please combine them into one quantity.`,
        ),
      );
      return;
    }
    seen.add(key);
    valid.push(result);
  });

  const overLimit = productsOverBookingLimit(valid);
  for (const [product, firstIndex] of overLimit) {
    issues.push(
      issue(
        "QUANTITY_LIMIT",
        `extras[${firstIndex}].quantity`,
        `${product.name} is limited to ${product.maxPerBooking ?? 0} per booking.`,
      ),
    );
  }
  valid = valid.filter((extra) => !overLimit.has(extra.product));

  valid = valid.filter((extra) => {
    const headcountIssue = checkDailyHeadcount(extra, headcount);
    if (headcountIssue) issues.push(headcountIssue);
    return !headcountIssue;
  });

  const lines = valid.map(({ product, day, quantity }) => ({
    productCode: product.code,
    day,
    quantity,
  }));
  return { lines, issues };
}

function checkExtra(
  extra: CartExtra,
  index: number,
  ctx: RuleContext,
): ValidExtra | { issue: Issue } {
  const base = `extras[${index}]`;
  const product = ctx.products.get(extra.productCode);
  if (!product) {
    return {
      issue: issue(
        "UNKNOWN_PRODUCT",
        `${base}.productCode`,
        "That extra isn't available for this event.",
      ),
    };
  }
  if (product.kind !== "extra") {
    return {
      issue: issue(
        "WRONG_PRODUCT_KIND",
        `${base}.productCode`,
        `${product.name} is a ticket. Please choose it for a person instead.`,
      ),
    };
  }
  if (!Number.isInteger(extra.quantity) || extra.quantity < 1) {
    return {
      issue: issue(
        "INVALID_QUANTITY",
        `${base}.quantity`,
        "Quantity must be a whole number, 1 or more.",
      ),
    };
  }
  if (product.dayScope === "whole_event") {
    if (extra.day !== null) {
      return {
        issue: issue("DAYS_NOT_ALLOWED", `${base}.day`, `${product.name} isn't tied to a day.`),
      };
    }
    return { index, product, day: null, quantity: extra.quantity };
  }
  if (extra.day === null) {
    return {
      issue: issue("DAYS_REQUIRED", `${base}.day`, `Please pick a day for ${product.name}.`),
    };
  }
  const dayIssue = checkProductDay(product, extra.day, ctx, `${base}.day`);
  if (dayIssue) return { issue: dayIssue };
  return { index, product, day: extra.day, quantity: extra.quantity };
}

/** Products whose total quantity across the booking exceeds `maxPerBooking`, with their first index. */
function productsOverBookingLimit(extras: readonly ValidExtra[]): Map<ExtraProduct, number> {
  const totals = new Map<ExtraProduct, { quantity: number; firstIndex: number }>();
  for (const { product, quantity, index } of extras) {
    const total = totals.get(product) ?? { quantity: 0, firstIndex: index };
    totals.set(product, { ...total, quantity: total.quantity + quantity });
  }
  const over = new Map<ExtraProduct, number>();
  for (const [product, { quantity, firstIndex }] of totals) {
    if (product.maxPerBooking !== null && quantity > product.maxPerBooking) {
      over.set(product, firstIndex);
    }
  }
  return over;
}

/** Per-person-per-day extras: no more than the ticketed people attending that day. */
function checkDailyHeadcount(
  extra: ValidExtra,
  headcount: ReadonlyMap<IsoDate, number>,
): Issue | null {
  if (!extra.product.cappedByDailyHeadcount || extra.day === null) return null;
  const people = headcount.get(extra.day) ?? 0;
  if (extra.quantity <= people) return null;
  const day = formatDay(extra.day);
  const path = `extras[${extra.index}].quantity`;
  if (people === 0) {
    return issue(
      "EXCEEDS_DAILY_HEADCOUNT",
      path,
      `Nobody in your group has a ticket for ${day}, so ${extra.product.name} can't be added for that day.`,
    );
  }
  return issue(
    "EXCEEDS_DAILY_HEADCOUNT",
    path,
    `${plural(people, "person", "people")} in your group ${people === 1 ? "has" : "have"} a ticket for ${day}, so you can add up to ${people} ${extra.product.name} for that day.`,
  );
}
