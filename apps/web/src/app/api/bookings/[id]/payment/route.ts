import { BookingId, PaymentRequest, PaymentResponse } from "@ticketing/contracts";
import { getDb } from "@/server/db";
import {
  bookingNotFound,
  errorResponse,
  internalError,
  jsonResponse,
  readJsonBody,
} from "@/server/http";
import { getPaymentGateway, PaymentProviderError } from "@/server/payments/gateway";
import { startPayment } from "@/server/payments/start-payment";

export const runtime = "nodejs";

const NOT_PAYABLE: Record<"confirmed" | "expired" | "cancelled" | "free", string> = {
  confirmed: "This booking is already paid.",
  expired:
    "This booking's hold has ended, so its tickets went back on sale. Please start a new booking.",
  cancelled: "This booking was cancelled.",
  free: "This booking has nothing to pay.",
};

/**
 * POST /api/bookings/:id/payment   body: {}
 *
 * 200 PaymentResponse | 400 | 404 BOOKING_NOT_FOUND | 409 BOOKING_NOT_PAYABLE | 413 | 415
 * | 503 PAYMENT_UNAVAILABLE | 500
 *
 * Starts the card payment for a booking holding its tickets, or returns the one already
 * started. The amount is the booking's stored total; the browser sends nothing that affects it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!BookingId.safeParse(id).success) return bookingNotFound();

  const body = await readJsonBody(request, PaymentRequest);
  if (!body.ok) return body.response;

  try {
    const result = await startPayment(getDb(), getPaymentGateway(), {
      bookingId: id,
      now: new Date(),
    });
    switch (result.kind) {
      case "not_found":
        return bookingNotFound();
      case "not_payable":
        return errorResponse(409, "BOOKING_NOT_PAYABLE", NOT_PAYABLE[result.reason]);
      case "ready":
        return jsonResponse(
          PaymentResponse,
          {
            bookingId: result.bookingId,
            clientSecret: result.clientSecret,
            amountCents: result.amountCents,
            currency: result.currency,
            holdExpiresAt: result.holdExpiresAt.toISOString(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
    }
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      console.error("payment: provider failed", error);
      return errorResponse(
        503,
        "PAYMENT_UNAVAILABLE",
        "We couldn't reach the payment service. Your tickets are still held; please try again.",
      );
    }
    return internalError("payment: failed to start", error);
  }
}
