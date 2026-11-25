/** Every reason a cart can be refused. Stable codes the UI and the API can rely on. */
export const ISSUE_CODES = [
  "INVALID_AGE",
  "BOOKER_TOO_YOUNG",
  "NO_ATTENDEES",
  "NO_TICKETED_ATTENDEE",
  "TICKET_NOT_NEEDED",
  "ENTRY_REQUIRED",
  "UNKNOWN_PRODUCT",
  "WRONG_PRODUCT_KIND",
  "AGE_TICKET_MISMATCH",
  "GROUP_COMPOSITION_MISMATCH",
  "DAYS_REQUIRED",
  "DAYS_NOT_ALLOWED",
  "DUPLICATE_DAY",
  "DAY_NOT_AVAILABLE",
  "DAY_IN_PAST",
  "SALE_CLOSED",
  "INVALID_QUANTITY",
  "DUPLICATE_EXTRA",
  "QUANTITY_LIMIT",
  "EXCEEDS_DAILY_HEADCOUNT",
  "SOLD_OUT",
  "INSUFFICIENT_STOCK",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export interface Issue {
  readonly code: IssueCode;
  /** Where in the cart the problem is, e.g. "attendees[2].entry.days[0]". */
  readonly path: string;
  /** Written for the family: what is wrong and how to fix it. */
  readonly message: string;
}

export function issue(code: IssueCode, path: string, message: string): Issue {
  return { code, path, message };
}

/** plural(1, "adult") -> "1 adult", plural(2, "adult") -> "2 adults" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
