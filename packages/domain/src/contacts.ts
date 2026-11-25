import { isValidAge } from "./age";
import { issue, type Issue } from "./issues";
import type { AgeRules } from "./types";

/**
 * Attendees may leave a phone number only if they are adults. We never collect a child's
 * phone number; the booker's contact details cover the whole group.
 * Invalid ages are reported by the cart rules, so they are skipped here.
 */
export function checkAttendeeContacts(
  attendees: readonly { readonly ageYears: number; readonly phone: string | null }[],
  rules: AgeRules,
): Issue[] {
  return attendees.flatMap((attendee, index) =>
    attendee.phone !== null &&
    isValidAge(attendee.ageYears) &&
    attendee.ageYears < rules.adultMinAge
      ? [
          issue(
            "PHONE_NOT_ALLOWED",
            `attendees[${index}].phone`,
            `Please leave the phone number blank for anyone under ${rules.adultMinAge}.`,
          ),
        ]
      : [],
  );
}
