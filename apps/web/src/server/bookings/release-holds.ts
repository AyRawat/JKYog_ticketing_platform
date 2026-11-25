import "server-only";
import type { Database } from "@ticketing/db";

/**
 * Expires unpaid bookings whose hold has run out, and gives back what they held: their stock
 * and their promo code use. Pass `bookingId` to release just that booking.
 *
 * Holds are released lazily, by whichever request needs fresh stock or status (a quote, a new
 * booking, reading a booking), plus a scheduled sweep as a backstop. So no background worker
 * is needed.
 *
 * Safe to run concurrently: the status change `pending_payment -> expired` happens once per
 * booking (a second runner's UPDATE re-checks the status and skips it), so nothing is given back
 * twice. Rows are locked in the same order as booking creation (inventory by product id, then
 * promo codes), so a release and a new booking never deadlock.
 *
 * Returns the number of bookings expired.
 */
export async function releaseExpiredHolds(
  db: Database,
  { now, bookingId }: { now: Date; bookingId?: string },
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    let expire = trx
      .updateTable("bookings")
      .set({ status: "expired" })
      .where("status", "=", "pending_payment")
      .where("hold_expires_at", "<=", now);
    if (bookingId !== undefined) expire = expire.where("id", "=", bookingId);
    const expired = await expire.returning(["id", "promo_code_id"]).execute();
    if (expired.length === 0) return 0;

    const units = await trx
      .selectFrom("booking_lines")
      .select(["product_id", (eb) => eb.fn.sum<string>("quantity").as("units")])
      .where(
        "booking_id",
        "in",
        expired.map((booking) => booking.id),
      )
      .groupBy("product_id")
      .orderBy("product_id")
      .execute();
    for (const { product_id, units: count } of units) {
      await trx
        .updateTable("inventory")
        .set((eb) => ({ remaining: eb("remaining", "+", Number(count)) }))
        .where("product_id", "=", product_id)
        .execute();
    }

    const usesByPromo = new Map<string, number>();
    for (const { promo_code_id } of expired) {
      if (promo_code_id) usesByPromo.set(promo_code_id, (usesByPromo.get(promo_code_id) ?? 0) + 1);
    }
    for (const [promoId, uses] of [...usesByPromo].sort(([a], [b]) => (a < b ? -1 : 1))) {
      await trx
        .updateTable("promo_codes")
        .set((eb) => ({ times_redeemed: eb("times_redeemed", "-", uses) }))
        .where("id", "=", promoId)
        .execute();
    }
    return expired.length;
  });
}
