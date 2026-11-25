import { CatalogResponse, EventSlug } from "@ticketing/contracts";
import { toCatalogResponse } from "@/server/catalog/catalog-response";
import { loadEventCatalog } from "@/server/catalog/load-catalog";
import { getDb } from "@/server/db";
import { eventNotFound, internalError, jsonResponse } from "@/server/http";

export const runtime = "nodejs";

/**
 * GET /api/events/:slug/catalog
 *
 * 200 CatalogResponse | 404 EVENT_NOT_FOUND | 500 INTERNAL_ERROR
 *
 * Public and read-only. The CDN may serve it for up to 30 s: availability shown here is a hint
 * for the form, while the quote and booking endpoints always check live data.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  // A malformed slug can't name an event, so it gets the same 404 without a database query.
  if (!EventSlug.safeParse(slug).success) return eventNotFound();

  try {
    const eventCatalog = await loadEventCatalog(getDb(), slug);
    if (!eventCatalog) return eventNotFound();

    return jsonResponse(CatalogResponse, toCatalogResponse(eventCatalog, new Date()), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" },
    });
  } catch (error) {
    return internalError("catalog: failed to load", error);
  }
}
