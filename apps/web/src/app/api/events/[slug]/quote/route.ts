import { EventSlug, QuoteRequest, QuoteResponse } from "@ticketing/contracts";
import { quoteCart } from "@ticketing/domain";
import { releaseExpiredHolds } from "@/server/bookings/release-holds";
import { loadEventCatalog } from "@/server/catalog/load-catalog";
import { getDb } from "@/server/db";
import { toQuoteResponse } from "@/server/quote/quote-response";
import { LIMITS, peekLimit, takeLimit, tooManyRequests, visitorOf } from "@/server/rate-limit";
import { eventNotFound, internalError, jsonResponse, readJsonBody } from "@/server/http";

export const runtime = "nodejs";

/**
 * POST /api/events/:slug/quote
 *
 * 200 QuoteResponse | 400 INVALID_REQUEST | 404 EVENT_NOT_FOUND | 413 PAYLOAD_TOO_LARGE
 * | 415 UNSUPPORTED_MEDIA_TYPE | 429 RATE_LIMITED | 500 INTERNAL_ERROR
 *
 * Prices a cart against the live catalog. A well-formed cart always gets a 200, even when it
 * breaks booking rules: those come back as `issues` so the form can show them in place.
 * Changes no booking data (it only releases holds that have already expired) and is never cached.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!EventSlug.safeParse(slug).success) return eventNotFound();

  const body = await readJsonBody(request, QuoteRequest);
  if (!body.ok) return body.response;

  try {
    const db = getDb();
    const now = new Date();
    const visitor = visitorOf(request);
    const limited = await takeLimit(db, LIMITS.quote, visitor, now);
    if (!limited.allowed) return tooManyRequests(LIMITS.quote, limited.retryAfterSeconds);
    // Someone who has tried too many codes that don't exist can't try more for a while.
    if (body.data.promoCode?.trim()) {
      const guessing = await peekLimit(db, LIMITS.promoGuess, visitor, now);
      if (!guessing.allowed) return tooManyRequests(LIMITS.promoGuess, guessing.retryAfterSeconds);
    }

    // Stock held by unpaid bookings whose time ran out is back on sale before we look at it.
    await releaseExpiredHolds(db, { now });
    const eventCatalog = await loadEventCatalog(db, slug);
    if (!eventCatalog) return eventNotFound();

    const quote = quoteCart({ catalog: eventCatalog.catalog, cart: body.data, now });
    if (quote.promo?.status === "rejected" && quote.promo.reason === "PROMO_NOT_FOUND") {
      await takeLimit(db, LIMITS.promoGuess, visitor, now);
    }
    return jsonResponse(QuoteResponse, toQuoteResponse(quote), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalError("quote: failed", error);
  }
}
