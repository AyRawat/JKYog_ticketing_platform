import { formatDay, type IsoDate } from "./dates";
import type { ResolvedEntry } from "./entries";
import { issue, plural, type Issue } from "./issues";
import type { Admission, BookingLine, EntryProduct } from "./types";

/**
 * How many units of a ticket admit exactly this group, or `null` if no whole number does.
 *
 * One rule for every entry product, driven only by who a unit admits:
 * - Day Pass (1 adult):         3 adults            -> 3
 * - Family Pass (2A + 2C):      4 adults + 4 kids   -> 2;  3 adults + 2 kids -> null
 */
export function unitsToAdmit(
  admits: EntryProduct["admits"],
  adults: number,
  children: number,
): number | null {
  const counts: number[] = [];
  for (const [people, perUnit] of [
    [adults, admits.adults],
    [children, admits.children],
  ] as const) {
    if (perUnit === 0) {
      if (people > 0) return null;
      continue;
    }
    if (people % perUnit !== 0) return null;
    counts.push(people / perUnit);
  }
  const [units, ...others] = counts;
  if (units === undefined || units === 0 || others.some((other) => other !== units)) return null;
  return units;
}

interface Group {
  readonly product: EntryProduct;
  /** `null` for whole-event products: one line covers every day. */
  readonly lineDay: IsoDate | null;
  readonly members: ResolvedEntry[];
}

/**
 * Groups ticketed attendees by (product, day) and turns each group into one priced line.
 * A group that can't be split into whole units (e.g. 3 adults + 2 children on Family Passes)
 * is refused, and nobody in it is admitted on that day.
 */
export function buildEntryLines(entries: readonly ResolvedEntry[]): {
  lines: BookingLine[];
  admissions: Admission[];
  issues: Issue[];
} {
  const groups = new Map<string, Group>();
  const addTo = (product: EntryProduct, lineDay: IsoDate | null, entry: ResolvedEntry) => {
    const key = `${product.code}|${lineDay ?? ""}`;
    const group = groups.get(key) ?? { product, lineDay, members: [] };
    group.members.push(entry);
    groups.set(key, group);
  };
  for (const entry of entries) {
    if (entry.product.dayScope === "whole_event") addTo(entry.product, null, entry);
    else for (const day of entry.days) addTo(entry.product, day, entry);
  }

  const lines: BookingLine[] = [];
  const admissions: Admission[] = [];
  const issues: Issue[] = [];
  for (const { product, lineDay, members } of groups.values()) {
    const adults = members.filter((member) => member.band === "adult").length;
    const children = members.length - adults;
    const quantity = unitsToAdmit(product.admits, adults, children);
    if (quantity === null) {
      issues.push(compositionIssue(product, lineDay, members, adults, children));
      continue;
    }
    lines.push({ productCode: product.code, day: lineDay, quantity });
    for (const member of members) {
      const days = lineDay === null ? member.days : [lineDay];
      for (const day of days) {
        admissions.push({
          attendeeIndex: member.attendeeIndex,
          day,
          productCode: product.code,
          lineDay,
        });
      }
    }
  }
  return { lines, admissions, issues };
}

function compositionIssue(
  product: EntryProduct,
  lineDay: IsoDate | null,
  members: readonly ResolvedEntry[],
  adults: number,
  children: number,
): Issue {
  const covers = `${plural(product.admits.adults, "adult")} and ${plural(product.admits.children, "child", "children")}`;
  const has = `${plural(adults, "adult")} and ${plural(children, "child", "children")}`;
  const when = lineDay ? `On ${formatDay(lineDay)} it` : "It";
  const first = members[0]?.attendeeIndex ?? 0;
  return issue(
    "GROUP_COMPOSITION_MISMATCH",
    `attendees[${first}].entry.productCode`,
    `Each ${product.name} covers exactly ${covers}. ${when} has ${has}.`,
  );
}
