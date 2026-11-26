import "server-only";
import type { Database } from "@ticketing/db";

/**
 * Tells the family their booking is confirmed. Sending real email is out of scope for this
 * exercise, so it logs what would be sent; a real sender implements the same function.
 */
export type SendConfirmation = (db: Database, bookingId: string) => Promise<void>;

export const logConfirmation: SendConfirmation = async (db, bookingId) => {
  const booking = await db
    .selectFrom("bookings")
    .select(["reference", "contact_email", "total_cents"])
    .where("id", "=", bookingId)
    .executeTakeFirst();
  if (!booking) return;
  // The address is masked: logs are not the place for personal details.
  console.info(
    `[email] Booking ${booking.reference} confirmed (total ${String(booking.total_cents)} cents) → ${maskEmail(booking.contact_email)}`,
  );
};

/** "asha.patel@example.com" -> "a***@example.com" */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? "***" : `${email.slice(0, 1)}***${email.slice(at)}`;
}
