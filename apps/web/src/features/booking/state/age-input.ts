import { ageBand, isValidAge, type AgeBand, type AgeRules } from "@ticketing/domain";

/**
 * A typed age as a whole number, or null when the text isn't one ("", "4.5", "ten", "-1").
 * Whether the number is a sensible age is a booking rule, checked by the server.
 */
export function parseAgeText(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null;
}

/** The age band for a typed age, or null while it isn't a valid age. For display only. */
export function bandForAgeText(text: string, rules: AgeRules): AgeBand | null {
  const ageYears = parseAgeText(text);
  return ageYears !== null && isValidAge(ageYears) ? ageBand(ageYears, rules) : null;
}
