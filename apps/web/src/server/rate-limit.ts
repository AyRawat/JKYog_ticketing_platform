import "server-only";
import { createHash } from "node:crypto";
import type { Database } from "@ticketing/db";
import { errorResponse } from "./http";

// Per-visitor request limits, counted in Postgres so every serverless instance shares them.
//
// Fixed windows: a visitor gets `max` requests per window, counted from the window's start. A
// burst straddling two windows can reach 2 × max for a moment, which is fine for limits this
// loose; they stop bots and brute force, not people.

export interface Limit {
  readonly name: string;
  readonly max: number;
  readonly windowSeconds: number;
  /** Shown to the family when they hit it. */
  readonly message: string;
}

export const LIMITS = {
  /** The form re-prices as it is edited (debounced): generous. */
  quote: {
    name: "quote",
    max: 120,
    windowSeconds: 60,
    message: "You're updating very quickly. Please wait a moment and try again.",
  },
  /** Each booking holds tickets for 15 minutes: this stops anyone sitting on the stock. */
  booking: {
    name: "booking",
    max: 10,
    windowSeconds: 600,
    message:
      "Too many bookings from your connection in a short time. Please try again in a few minutes.",
  },
  payment: {
    name: "payment",
    max: 20,
    windowSeconds: 600,
    message: "Too many payment attempts in a short time. Please try again in a few minutes.",
  },
  /** Codes that don't exist: stops guessing codes one after another. */
  promoGuess: {
    name: "promo-guess",
    max: 10,
    windowSeconds: 600,
    message:
      "Too many codes tried that don't exist. Please wait a few minutes before trying another.",
  },
} as const satisfies Record<string, Limit>;

export type LimitResult =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * Who is asking, as an opaque bucket id: a hash of their IP address, so no address is stored.
 * Vercel sets `x-real-ip` itself and a client can't override it. Without one (local runs and
 * tests) there is no one to limit, so null.
 */
export function visitorOf(request: Request): string | null {
  const ip =
    request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0];
  const trimmed = ip?.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
}

/** Counts one request against the limit, and says whether it may go ahead. */
export async function takeLimit(
  db: Database,
  limit: Limit,
  visitor: string | null,
  now: Date,
): Promise<LimitResult> {
  return count(db, limit, visitor, now, 1);
}

/** Whether the limit is already used up, without counting this request. */
export async function peekLimit(
  db: Database,
  limit: Limit,
  visitor: string | null,
  now: Date,
): Promise<LimitResult> {
  return count(db, limit, visitor, now, 0);
}

async function count(
  db: Database,
  limit: Limit,
  visitor: string | null,
  now: Date,
  add: 0 | 1,
): Promise<LimitResult> {
  if (visitor === null) return { allowed: true };
  const windowMs = limit.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const bucket = `${limit.name}:${visitor}`;
  try {
    let hits: number;
    if (add === 0) {
      const row = await db
        .selectFrom("rate_limit_hits")
        .select("hits")
        .where("bucket", "=", bucket)
        .where("window_start", "=", windowStart)
        .executeTakeFirst();
      // Peeking asks whether one more would be over the limit.
      hits = (row?.hits ?? 0) + 1;
    } else {
      const row = await db
        .insertInto("rate_limit_hits")
        .values({ bucket, window_start: windowStart, hits: 1 })
        .onConflict((conflict) =>
          conflict
            .columns(["bucket", "window_start"])
            .doUpdateSet((eb) => ({ hits: eb("rate_limit_hits.hits", "+", 1) })),
        )
        .returning("hits")
        .executeTakeFirstOrThrow();
      hits = row.hits;
      await sweepOccasionally(db, now);
    }
    if (hits <= limit.max) return { allowed: true };
    const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  } catch (error) {
    // A broken limiter must not stop families booking: let the request through and say so.
    console.error(`rate limit "${limit.name}" unavailable, allowing the request`, error);
    return { allowed: true };
  }
}

/** Now and then, drop windows older than a day, so the table stays small. */
async function sweepOccasionally(db: Database, now: Date) {
  if (Math.random() >= 0.02) return;
  await db
    .deleteFrom("rate_limit_hits")
    .where("window_start", "<", new Date(now.getTime() - 24 * 3600 * 1000))
    .execute();
}

/** 429 with Retry-After, in the API's usual error shape. */
export function tooManyRequests(limit: Limit, retryAfterSeconds: number): Response {
  const response = errorResponse(429, "RATE_LIMITED", limit.message);
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}
