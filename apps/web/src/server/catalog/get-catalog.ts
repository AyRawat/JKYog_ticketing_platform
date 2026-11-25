import "server-only";
import { CatalogResponse } from "@ticketing/contracts";
import { getDb } from "@/server/db";
import { toCatalogResponse } from "./catalog-response";
import { loadEventCatalog } from "./load-catalog";

/**
 * The public catalog for server components. Same data and same allow-list parse as
 * GET /api/events/:slug/catalog, without an HTTP round trip. Null when no event has that slug.
 */
export async function getPublicCatalog(slug: string): Promise<CatalogResponse | null> {
  const eventCatalog = await loadEventCatalog(getDb(), slug);
  if (!eventCatalog) return null;
  return CatalogResponse.parse(toCatalogResponse(eventCatalog, new Date()));
}
