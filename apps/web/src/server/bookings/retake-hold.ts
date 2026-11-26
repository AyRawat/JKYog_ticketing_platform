import "server-only";
import type { DB } from "@ticketing/db";
import type { Transaction } from "kysely";

/** Thrown inside the transaction when the stock or the code is gone: rolls back what was taken. */
export class HoldGone extends Error {
  constructor() {
    super("The booking's tickets are no longer available.");
  }
}

/**
 * For a payment that arrives after the booking's hold ran out: takes its stock and its promo
 * code use again, with the same guarded updates as a new booking, all or nothing. Throws
 * HoldGone if anything has been sold in the meantime; the caller's transaction then rolls back.
 *
 * The promo is checked against its usage limit only: the family was shown, and has paid, the
 * discounted price while the code was valid.
 */
export async function retakeHold(
  trx: Transaction<DB>,
  booking: { readonly id: string; readonly promoCodeId: string | null },
): Promise<void> {
  const units = await trx
    .selectFrom("booking_lines")
    .select(["product_id", (eb) => eb.fn.sum<string>("quantity").as("units")])
    .where("booking_id", "=", booking.id)
    .groupBy("product_id")
    // Same order as booking creation and hold release, so they never deadlock.
    .orderBy("product_id")
    .execute();

  for (const { product_id, units: count } of units) {
    const taken = await trx
      .updateTable("inventory")
      .set((eb) => ({ remaining: eb("remaining", "-", Number(count)) }))
      .where("product_id", "=", product_id)
      .where("remaining", ">=", Number(count))
      .returning("remaining")
      .executeTakeFirst();
    if (!taken) throw new HoldGone();
  }

  if (booking.promoCodeId) {
    const redeemed = await trx
      .updateTable("promo_codes")
      .set((eb) => ({ times_redeemed: eb("times_redeemed", "+", 1) }))
      .where("id", "=", booking.promoCodeId)
      .where((eb) =>
        eb.or([
          eb("max_redemptions", "is", null),
          eb("times_redeemed", "<", eb.ref("max_redemptions")),
        ]),
      )
      .returning("id")
      .executeTakeFirst();
    if (!redeemed) throw new HoldGone();
  }
}
