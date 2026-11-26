import type { AgeBand, AgeRules, IsoDate } from "@ticketing/domain";
import { bandAgeRange, formatCents } from "@ticketing/domain";

// Display formatting only. Amounts shown as totals always come from the server's quote.

/** "$15" for whole dollars, "$12.50" otherwise: for price lists, where ".00" is noise. */
export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? formatCents(cents).replace(/\.00$/, "") : formatCents(cents);
}

export { formatCents };

const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "2026-12-12" -> "Sat 12 Dec" */
export function dayLabel(day: IsoDate): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${weekday.format(date)} ${dayMonth.format(date)}`;
}

/** "Sat 12" for tight spaces such as day chips. */
export function shortDayLabel(day: IsoDate): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${weekday.format(date)} ${String(date.getUTCDate())}`;
}

/** ["2026-12-11", "2026-12-13"] -> "Fri 11 & Sun 13" */
export function shortDayList(days: readonly IsoDate[]): string {
  const labels = days.map(shortDayLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} & ${labels.at(-1) ?? ""}`;
}

/** "Adult · 12 and over", "Child · 5–11", "Under 5 · free" */
export function bandLabel(band: AgeBand, rules: AgeRules): string {
  switch (band) {
    case "adult":
      return `Adult · ${String(rules.adultMinAge)}+`;
    case "child":
      return `Child · ${bandAgeRange("child", rules).replace("ages ", "")}`;
    case "infant":
      return `Under ${String(rules.childMinAge)} · free`;
  }
}

/** How to refer to a person in a sentence: "Asha" or, for the booker with no name yet, "you". */
export interface Who {
  /** "Asha", "you": after "for". */
  readonly name: string;
  /** "Asha's", "your". */
  readonly possessive: string;
  /** "is Asha", "are you": in a question. */
  readonly isName: string;
}

export function whoIs(name: string): Who {
  return { name, possessive: `${name}'s`, isName: `is ${name}` };
}

export const YOU: Who = { name: "you", possessive: "your", isName: "are you" };
