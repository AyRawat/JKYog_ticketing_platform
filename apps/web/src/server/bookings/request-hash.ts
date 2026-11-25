import { createHash } from "node:crypto";

/**
 * SHA-256 of the request, independent of key order. Stored with the idempotency key so a retry
 * can be told apart from a different request that reuses the key.
 */
export function requestHash(slug: string, body: unknown): string {
  return createHash("sha256").update(canonicalJson({ slug, body })).digest("hex");
}

/** JSON with object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : item,
  );
}
