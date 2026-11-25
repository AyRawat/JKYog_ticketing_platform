import { EventSlug, QuoteRequest, QuoteResponse } from "@ticketing/contracts";
import { quoteCart } from "@ticketing/domain";
import { loadEventCatalog } from "@/server/catalog/load-catalog";
import { getDb } from "@/server/db";
import { toQuoteResponse } from "@/server/quote/quote-response";
import { eventNotFound, internalError, jsonResponse, readJsonBody } from "@/server/http";

export const runtime = "nodejs";

/**
 * POST /api/events/:slug/quote
 *
 * 200 QuoteResponse | 400 INVALID_REQUEST | 404 EVENT_NOT_FOUND | 413 PAYLOAD_TOO_LARGE
 * | 415 UNSUPPORTED_MEDIA_TYPE | 500 INTERNAL_ERROR
 *
 * Prices a cart against the live catalog. A well-formed cart always gets a 200, even when it
 * breaks booking rules: those come back as `issues` so the form can show them in place.
 * Changes nothing and is never cached.
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
    const eventCatalog = await loadEventCatalog(getDb(), slug);
    if (!eventCatalog) return eventNotFound();

    const quote = quoteCart({ catalog: eventCatalog.catalog, cart: body.data, now: new Date() });
    return jsonResponse(QuoteResponse, toQuoteResponse(quote), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalError("quote: failed", error);
  }
}
