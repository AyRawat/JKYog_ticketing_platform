import "server-only";
import type { BookingResponse } from "@ticketing/contracts";
import type { Database } from "@ticketing/db";

/**
 * A booking as stored: the price snapshot taken when it was made, not today's prices.
 * Returns null when there is no booking with that id.
 */
export async function loadBookingView(
  db: Database,
  bookingId: string,
): Promise<BookingResponse | null> {
  const booking = await db
    .selectFrom("bookings as b")
    .innerJoin("events as e", "e.id", "b.event_id")
    .leftJoin("promo_codes as pc", "pc.id", "b.promo_code_id")
    .select([
      "b.id",
      "b.reference",
      "b.status",
      "b.hold_expires_at",
      "b.subtotal_cents",
      "b.discount_cents",
      "b.total_cents",
      "e.currency",
      "pc.code as promo_code",
    ])
    .where("b.id", "=", bookingId)
    .executeTakeFirst();
  if (!booking) return null;

  const [lines, attendees, admissions] = await Promise.all([
    db
      .selectFrom("booking_lines as l")
      .innerJoin("products as p", "p.id", "l.product_id")
      .leftJoin("event_days as d", "d.id", "l.event_day_id")
      .select([
        "p.code",
        "p.display_name",
        "d.day_date",
        "l.quantity",
        "l.unit_price_cents",
        "l.line_total_cents",
      ])
      .where("l.booking_id", "=", bookingId)
      .orderBy("p.sort_order")
      .orderBy("d.day_date", (order) => order.nullsFirst())
      .execute(),
    db
      .selectFrom("attendees as a")
      .leftJoin("products as p", "p.id", "a.entry_product_id")
      .select(["a.id", "a.full_name", "a.age_years", "p.code"])
      .where("a.booking_id", "=", bookingId)
      .orderBy("a.position")
      .execute(),
    db
      .selectFrom("admissions as ad")
      .innerJoin("event_days as d", "d.id", "ad.event_day_id")
      .select(["ad.attendee_id", "d.day_date"])
      .where("ad.booking_id", "=", bookingId)
      .orderBy("d.day_date")
      .execute(),
  ]);

  const daysByAttendee = new Map<string, string[]>();
  for (const { attendee_id, day_date } of admissions) {
    const days = daysByAttendee.get(attendee_id) ?? [];
    days.push(day_date);
    daysByAttendee.set(attendee_id, days);
  }

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    holdExpiresAt: booking.hold_expires_at.toISOString(),
    currency: booking.currency,
    lines: lines.map((line) => ({
      productCode: line.code,
      productName: line.display_name,
      day: line.day_date,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      lineTotalCents: line.line_total_cents,
    })),
    subtotalCents: booking.subtotal_cents,
    discountCents: booking.discount_cents,
    totalCents: booking.total_cents,
    promoCode: booking.promo_code,
    attendees: attendees.map((attendee) => ({
      fullName: attendee.full_name,
      ageYears: attendee.age_years,
      productCode: attendee.code,
      days: daysByAttendee.get(attendee.id) ?? [],
    })),
  };
}
