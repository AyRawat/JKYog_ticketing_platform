import { BookingRequest, BookingResponse, EventSlug, IdempotencyKey } from "@ticketing/contracts";
import { formatCents } from "@ticketing/domain";
import { loadBookingView } from "@/server/bookings/booking-view";
import { createBooking } from "@/server/bookings/create-booking";
import { releaseExpiredHolds } from "@/server/bookings/release-holds";
import { loadEventCatalog } from "@/server/catalog/load-catalog";
import { getDb } from "@/server/db";
import {
  errorResponse,
  eventNotFound,
  internalError,
  jsonResponse,
  readJsonBody,
} from "@/server/http";

export const runtime = "nodejs";

/**
 * POST /api/events/:slug/bookings  (header: Idempotency-Key: <uuid>)
 *
 * 201 BookingResponse  created; tickets held until `holdExpiresAt`
 * 200 BookingResponse  the same request was sent again with the same key
 * 400 INVALID_REQUEST  missing/invalid Idempotency-Key, or a malformed body
 * 404 EVENT_NOT_FOUND
 * 409 IDEMPOTENCY_KEY_REUSED  the key was used for a different request
 * 409 PRICE_CHANGED    the total is no longer `expectedTotalCents`; quote again
 * 409 SOLD_OUT | PROMO_UNAVAILABLE  another booking took the last units or code use first
 * 413 | 415            as for the quote endpoint
 * 422 BOOKING_INVALID  the cart breaks booking rules; `details` lists each, with its path
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!EventSlug.safeParse(slug).success) return eventNotFound();

  const key = IdempotencyKey.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) {
    return errorResponse(400, "INVALID_REQUEST", "An Idempotency-Key header is required.", [
      { path: "headers.Idempotency-Key", message: "Send a UUID in the Idempotency-Key header." },
    ]);
  }

  const body = await readJsonBody(request, BookingRequest);
  if (!body.ok) return body.response;

  try {
    const db = getDb();
    const now = new Date();
    // Stock held by unpaid bookings whose time ran out is back on sale before we take any.
    await releaseExpiredHolds(db, { now });
    const eventCatalog = await loadEventCatalog(db, slug);
    if (!eventCatalog) return eventNotFound();

    const result = await createBooking(db, {
      eventCatalog,
      request: body.data,
      idempotencyKey: key.data,
      now,
    });

    switch (result.kind) {
      case "created":
      case "replayed": {
        const booking = await loadBookingView(db, result.bookingId);
        if (!booking) throw new Error(`Booking ${result.bookingId} vanished after being written`);
        return jsonResponse(BookingResponse, booking, {
          status: result.kind === "created" ? 201 : 200,
          headers: { "Cache-Control": "no-store", Location: `/api/bookings/${booking.id}` },
        });
      }
      case "key_reused":
        return errorResponse(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was already used for a different booking. Use a new key.",
        );
      case "invalid":
        return errorResponse(
          422,
          "BOOKING_INVALID",
          "Some details need fixing before this booking can be made.",
          result.details,
        );
      case "price_changed":
        return errorResponse(
          409,
          "PRICE_CHANGED",
          `The total is now ${formatCents(result.totalCents)}. Please check your booking and try again.`,
        );
      case "sold_out":
        return errorResponse(
          409,
          "SOLD_OUT",
          `Sorry, ${result.productName} has just sold out. Please change your booking.`,
        );
      case "promo_unavailable":
        return errorResponse(
          409,
          "PROMO_UNAVAILABLE",
          `Sorry, the code ${result.code} can no longer be used. Please remove it and try again.`,
        );
    }
  } catch (error) {
    return internalError("bookings: failed", error);
  }
}
