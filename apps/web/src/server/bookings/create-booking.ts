import "server-only";
import type { BookingRequest, FieldError } from "@ticketing/contracts";
import type { Database, DB } from "@ticketing/db";
import {
  checkAttendeeContacts,
  quoteCart,
  unitsByProduct,
  type Cart,
  type Quote,
} from "@ticketing/domain";
import type { Transaction } from "kysely";
import type { EventCatalog } from "../catalog/load-catalog";
import { newReference } from "./reference";
import { requestHash } from "./request-hash";

type Trx = Transaction<DB>;

export type CreateBookingResult =
  | { readonly kind: "created"; readonly bookingId: string }
  /** The same request was already made with this key: nothing new was written. */
  | { readonly kind: "replayed"; readonly bookingId: string }
  /** The key was already used for a different request. */
  | { readonly kind: "key_reused" }
  /** The cart breaks a booking rule; nothing was written. */
  | { readonly kind: "invalid"; readonly details: FieldError[] }
  /** The price is not the one the family was shown. */
  | { readonly kind: "price_changed"; readonly totalCents: number }
  /** Another booking took the last units first. */
  | { readonly kind: "sold_out"; readonly productName: string }
  /** Another booking used the last redemption of the code first. */
  | { readonly kind: "promo_unavailable"; readonly code: string };

export interface CreateBookingInput {
  readonly eventCatalog: EventCatalog;
  readonly request: BookingRequest;
  readonly idempotencyKey: string;
  readonly now: Date;
}

/** Thrown inside the transaction to roll it back and report why. */
class BookingConflict extends Error {
  constructor(readonly result: CreateBookingResult) {
    super(result.kind);
  }
}

/**
 * Creates a booking that holds its tickets until `now + holdMinutes`.
 *
 * 1. A key seen before replays its booking (same request) or is refused (different request).
 * 2. The cart is priced again from live data with the same function as the quote; any issue,
 *    a rejected promo code, or a total other than the one the family saw stops it here.
 * 3. One transaction then writes the booking, takes stock and the promo redemption with guarded
 *    updates (`remaining >= n`), and stores the people, lines and door list. If any guard fails
 *    the whole transaction rolls back, so nothing is half-booked.
 */
export async function createBooking(
  db: Database,
  { eventCatalog, request, idempotencyKey, now }: CreateBookingInput,
): Promise<CreateBookingResult> {
  const { catalog, details, ids } = eventCatalog;
  const hash = requestHash(catalog.event.slug, request);

  const previous = await findByKey(db, idempotencyKey, hash);
  if (previous) return previous;

  const quote = quoteCart({ catalog, cart: toCart(request), now });
  const problems = bookingProblems(quote, request, eventCatalog);
  if (problems.length > 0) return { kind: "invalid", details: problems };
  if (quote.totalCents !== request.expectedTotalCents) {
    return { kind: "price_changed", totalCents: quote.totalCents };
  }

  try {
    const bookingId = await db.transaction().execute(async (trx) => {
      const id = await insertBooking(trx, {
        eventCatalog,
        request,
        quote,
        idempotencyKey,
        hash,
        holdExpiresAt: new Date(now.getTime() + details.holdMinutes * 60_000),
      });
      await takeStock(trx, quote, eventCatalog);
      if (quote.promo?.status === "applied") {
        const promoId = await redeemPromo(trx, ids.event, quote.promo.code, now);
        await trx
          .updateTable("bookings")
          .set({ promo_code_id: promoId })
          .where("id", "=", id)
          .execute();
      }
      await insertPeopleAndLines(trx, id, request, quote, eventCatalog);
      return id;
    });
    return { kind: "created", bookingId };
  } catch (error) {
    if (error instanceof BookingConflict) return error.result;
    // A concurrent request with the same key committed first: answer as a retry of it.
    if (isUniqueViolation(error, "bookings_idempotency_key_key")) {
      const winner = await findByKey(db, idempotencyKey, hash);
      if (winner) return winner;
    }
    throw error;
  }
}

async function findByKey(
  db: Database,
  idempotencyKey: string,
  hash: string,
): Promise<CreateBookingResult | null> {
  const existing = await db
    .selectFrom("bookings")
    .select(["id", "idempotency_request_hash"])
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
  if (!existing) return null;
  return existing.idempotency_request_hash === hash
    ? { kind: "replayed", bookingId: existing.id }
    : { kind: "key_reused" };
}

function toCart(request: BookingRequest): Cart {
  return {
    booker: { ageYears: request.booker.ageYears },
    attendees: request.attendees.map(({ ageYears, entry }) => ({ ageYears, entry })),
    extras: request.extras,
    promoCode: request.promoCode,
  };
}

/** Everything that stops a booking, in the same {path, message, code} form as other field errors. */
function bookingProblems(
  quote: Quote,
  request: BookingRequest,
  { catalog }: EventCatalog,
): FieldError[] {
  const problems: FieldError[] = [
    ...quote.issues,
    ...checkAttendeeContacts(request.attendees, catalog.event.ageRules),
  ].map(({ code, path, message }) => ({ code, path, message }));

  if (quote.promo?.status === "rejected") {
    problems.push({ code: quote.promo.reason, path: "promoCode", message: quote.promo.message });
  }
  // Every way a complete booking request can fail to be bookable is reported above.
  if (problems.length === 0 && !quote.canBook) {
    problems.push({ path: "", message: "This booking can't be made. Please check the details." });
  }
  return problems;
}

async function insertBooking(
  trx: Trx,
  input: {
    eventCatalog: EventCatalog;
    request: BookingRequest;
    quote: Quote;
    idempotencyKey: string;
    hash: string;
    holdExpiresAt: Date;
  },
): Promise<string> {
  const { eventCatalog, request, quote } = input;
  // References are random; on the rare clash with an existing one, draw another.
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await trx
      .insertInto("bookings")
      .values({
        event_id: eventCatalog.ids.event,
        reference: newReference(eventCatalog.catalog.event.slug),
        idempotency_key: input.idempotencyKey,
        idempotency_request_hash: input.hash,
        contact_name: request.booker.fullName,
        contact_email: request.booker.email,
        contact_phone: request.booker.phone,
        contact_age_years: request.booker.ageYears,
        subtotal_cents: quote.subtotalCents,
        discount_cents: quote.discountCents,
        total_cents: quote.totalCents,
        hold_expires_at: input.holdExpiresAt,
      })
      .onConflict((conflict) => conflict.column("reference").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (row) return row.id;
  }
  throw new Error("Could not generate a unique booking reference");
}

/** Takes every product's units, or none: the first product short of stock rolls everything back. */
async function takeStock(trx: Trx, quote: Quote, { catalog, ids }: EventCatalog): Promise<void> {
  // A fixed order (by product id) so two bookings never wait on each other's rows in a cycle.
  const wanted = [...unitsByProduct(quote.lines)]
    .map(([code, units]) => ({ code, units, productId: requireId(ids.products, code) }))
    .sort((a, b) => (a.productId < b.productId ? -1 : 1));

  for (const { code, units, productId } of wanted) {
    const taken = await trx
      .updateTable("inventory")
      .set((eb) => ({ remaining: eb("remaining", "-", units) }))
      .where("product_id", "=", productId)
      .where("remaining", ">=", units)
      .returning("remaining")
      .executeTakeFirst();
    if (!taken) {
      const name = catalog.products.find((product) => product.code === code)?.name ?? code;
      throw new BookingConflict({ kind: "sold_out", productName: name });
    }
  }
}

/** Counts one use of the code, only while it is still active, in date and under its limit. */
async function redeemPromo(trx: Trx, eventId: string, code: string, now: Date): Promise<string> {
  const redeemed = await trx
    .updateTable("promo_codes")
    .set((eb) => ({ times_redeemed: eb("times_redeemed", "+", 1) }))
    .where("event_id", "=", eventId)
    .where("code", "=", code)
    .where("is_active", "=", true)
    .where((eb) =>
      eb.and([
        eb.or([
          eb("max_redemptions", "is", null),
          eb("times_redeemed", "<", eb.ref("max_redemptions")),
        ]),
        eb.or([eb("valid_from", "is", null), eb("valid_from", "<=", now)]),
        eb.or([eb("valid_until", "is", null), eb("valid_until", ">=", now)]),
      ]),
    )
    .returning("id")
    .executeTakeFirst();
  if (!redeemed) throw new BookingConflict({ kind: "promo_unavailable", code });
  return redeemed.id;
}

async function insertPeopleAndLines(
  trx: Trx,
  bookingId: string,
  request: BookingRequest,
  quote: Quote,
  { ids }: EventCatalog,
): Promise<void> {
  const attendees = await trx
    .insertInto("attendees")
    .values(
      request.attendees.map((attendee, position) => ({
        booking_id: bookingId,
        position,
        full_name: attendee.fullName,
        age_years: attendee.ageYears,
        phone: attendee.phone,
        entry_product_id: attendee.entry
          ? requireId(ids.products, attendee.entry.productCode)
          : null,
      })),
    )
    .returning(["id", "position"])
    .execute();
  const attendeeIds = new Map(attendees.map((row) => [row.position, row.id]));

  const lines = await trx
    .insertInto("booking_lines")
    .values(
      quote.lines.map((line) => ({
        booking_id: bookingId,
        product_id: requireId(ids.products, line.productCode),
        event_day_id: line.day === null ? null : requireId(ids.days, line.day),
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        line_total_cents: line.lineTotalCents,
      })),
    )
    .returning(["id", "product_id", "event_day_id"])
    .execute();
  const lineIds = new Map(
    lines.map((row) => [`${row.product_id}|${row.event_day_id ?? ""}`, row.id]),
  );

  if (quote.admissions.length === 0) return;
  await trx
    .insertInto("admissions")
    .values(
      quote.admissions.map((admission) => {
        const productId = requireId(ids.products, admission.productCode);
        const lineDayId = admission.lineDay === null ? "" : requireId(ids.days, admission.lineDay);
        return {
          booking_id: bookingId,
          attendee_id: requireId(attendeeIds, admission.attendeeIndex),
          booking_line_id: requireId(lineIds, `${productId}|${lineDayId}`),
          product_id: productId,
          event_day_id: requireId(ids.days, admission.day),
        };
      }),
    )
    .execute();
}

/** Every code and date here came from the catalog, so a miss is a programming error. */
function requireId<K>(map: ReadonlyMap<K, string>, key: K): string {
  const id = map.get(key);
  if (id === undefined) throw new Error(`No database id for ${String(key)}`);
  return id;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint
  );
}
