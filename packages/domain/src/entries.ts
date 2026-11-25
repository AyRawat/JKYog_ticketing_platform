import {
  ageBand,
  bandAgeRange,
  invalidAgeMessage,
  isValidAge,
  productAdmitsBand,
  type TicketedBand,
} from "./age";
import { checkProductDay, isWholeEventOnSale, type RuleContext } from "./context";
import { formatDay, type IsoDate } from "./dates";
import { issue, type Issue } from "./issues";
import type { CartAttendee, CartEntry, EntryProduct } from "./types";

/** An attendee whose ticket passed every per-person rule. */
export interface ResolvedEntry {
  readonly attendeeIndex: number;
  readonly ageYears: number;
  readonly band: TicketedBand;
  readonly product: EntryProduct;
  /** The days this person is admitted (every festival day for a whole-event pass). */
  readonly days: readonly IsoDate[];
}

/**
 * Checks each attendee's age and ticket on its own. Group rules (Family Pass composition)
 * and pricing come later. Under-free-age children produce no entry and no issue.
 */
export function resolveEntries(
  attendees: readonly CartAttendee[],
  ctx: RuleContext,
): { entries: ResolvedEntry[]; issues: Issue[] } {
  const entries: ResolvedEntry[] = [];
  const issues: Issue[] = [];
  attendees.forEach((attendee, index) => {
    const result = resolveAttendee(attendee, index, ctx);
    if (result.entry) entries.push(result.entry);
    issues.push(...result.issues);
  });
  return { entries, issues };
}

function resolveAttendee(
  attendee: CartAttendee,
  index: number,
  ctx: RuleContext,
): { entry?: ResolvedEntry; issues: Issue[] } {
  const base = `attendees[${index}]`;
  const rules = ctx.event.ageRules;

  if (!isValidAge(attendee.ageYears)) {
    return { issues: [issue("INVALID_AGE", `${base}.ageYears`, invalidAgeMessage)] };
  }

  const band = ageBand(attendee.ageYears, rules);
  if (band === "infant") {
    return attendee.entry
      ? {
          issues: [
            issue(
              "TICKET_NOT_NEEDED",
              `${base}.entry`,
              `Children under ${rules.childMinAge} come free and don't need a ticket.`,
            ),
          ],
        }
      : { issues: [] };
  }

  if (!attendee.entry) {
    return {
      issues: [issue("ENTRY_REQUIRED", `${base}.entry`, "Please choose a ticket for this person.")],
    };
  }

  const product = ctx.products.get(attendee.entry.productCode);
  const productPath = `${base}.entry.productCode`;
  if (!product) {
    return {
      issues: [
        issue("UNKNOWN_PRODUCT", productPath, "That ticket isn't available for this event."),
      ],
    };
  }
  if (product.kind !== "entry") {
    return {
      issues: [
        issue(
          "WRONG_PRODUCT_KIND",
          productPath,
          `${product.name} is an extra, not an entry ticket.`,
        ),
      ],
    };
  }
  if (!productAdmitsBand(product, band)) {
    return {
      issues: [
        issue(
          "AGE_TICKET_MISMATCH",
          productPath,
          `At ${attendee.ageYears}, this person needs a ${band} ticket (${bandAgeRange(band, rules)}). ${product.name} isn't one.`,
        ),
      ],
    };
  }

  const days = resolveEntryDays(product, attendee.entry, ctx, `${base}.entry.days`);
  if ("issues" in days) return { issues: days.issues };

  return {
    entry: { attendeeIndex: index, ageYears: attendee.ageYears, band, product, days: days.days },
    issues: [],
  };
}

/** Per-day tickets need at least one valid day; whole-event tickets take none and cover all. */
function resolveEntryDays(
  product: EntryProduct,
  entry: CartEntry,
  ctx: RuleContext,
  path: string,
): { days: readonly IsoDate[] } | { issues: Issue[] } {
  if (product.dayScope === "whole_event") {
    if (entry.days.length > 0) {
      return {
        issues: [
          issue(
            "DAYS_NOT_ALLOWED",
            path,
            `${product.name} covers every festival day, so there are no days to pick.`,
          ),
        ],
      };
    }
    if (!isWholeEventOnSale(ctx)) {
      return {
        issues: [
          issue(
            "SALE_CLOSED",
            path,
            `${product.name} can no longer be bought because the festival has started.`,
          ),
        ],
      };
    }
    return { days: product.availableDays };
  }

  if (entry.days.length === 0) {
    return { issues: [issue("DAYS_REQUIRED", path, "Please pick at least one day.")] };
  }

  const issues: Issue[] = [];
  const seen = new Set<IsoDate>();
  entry.days.forEach((day, dayIndex) => {
    const dayPath = `${path}[${dayIndex}]`;
    if (seen.has(day)) {
      issues.push(issue("DUPLICATE_DAY", dayPath, `${formatDay(day)} is selected twice.`));
      return;
    }
    seen.add(day);
    const dayIssue = checkProductDay(product, day, ctx, dayPath);
    if (dayIssue) issues.push(dayIssue);
  });
  return issues.length > 0 ? { issues } : { days: [...entry.days].sort() };
}
