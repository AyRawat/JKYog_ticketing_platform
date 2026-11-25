import { BookingId, BookingResponse } from "@ticketing/contracts";
import { loadBookingView } from "@/server/bookings/booking-view";
import { releaseExpiredHolds } from "@/server/bookings/release-holds";
import { getDb } from "@/server/db";
import { errorResponse, internalError, jsonResponse } from "@/server/http";

export const runtime = "nodejs";

/**
 * GET /api/bookings/:id
 *
 * 200 BookingResponse | 404 BOOKING_NOT_FOUND | 500 INTERNAL_ERROR
 *
 * The confirmation page's data. The id is a random UUID, so knowing it is what grants access
 * (like a private link); unknown and malformed ids get the same 404, and contact details are
 * never returned. An unpaid booking past its hold is expired here before it is shown.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!BookingId.safeParse(id).success) return bookingNotFound();

  try {
    const db = getDb();
    await releaseExpiredHolds(db, { now: new Date(), bookingId: id });
    const booking = await loadBookingView(db, id);
    if (!booking) return bookingNotFound();

    return jsonResponse(BookingResponse, booking, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalError("booking: failed to load", error);
  }
}

function bookingNotFound(): Response {
  return errorResponse(404, "BOOKING_NOT_FOUND", "We couldn't find that booking.");
}
