/** A calendar date, "YYYY-MM-DD". Festival days are dates, never timestamps. */
export type IsoDate = string;

export function localDate(now: Date, timeZone: string): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "2026-12-12" -> "12 Dec". Anything that isn't a real date is returned as typed. */
export function formatDay(day: IsoDate): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : dayMonth.format(date);
}

/** ["2026-12-11", "2026-12-13"] -> "11 Dec and 13 Dec" */
export function formatDayList(days: readonly IsoDate[]): string {
  const labels = days.map(formatDay);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;
}
