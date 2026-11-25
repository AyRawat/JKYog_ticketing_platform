import "server-only";
import type { Database, PromoCodes } from "@ticketing/db";
import type { Catalog, IsoDate, Product, Promo, PromoDiscount } from "@ticketing/domain";
import type { Selectable } from "kysely";

/** Event fields the booking rules don't need but the form shows. */
export interface EventDetails {
  readonly name: string;
  readonly venue: string;
  readonly currency: string;
  readonly holdMinutes: number;
}

/** Database ids behind the catalog's codes and dates, for writing bookings. */
export interface CatalogIds {
  readonly event: string;
  readonly products: ReadonlyMap<string, string>;
  readonly days: ReadonlyMap<IsoDate, string>;
}

export interface EventCatalog {
  readonly catalog: Catalog;
  readonly details: EventDetails;
  readonly ids: CatalogIds;
}

/**
 * Reads one event's catalog (days, active products with live stock, promo codes) and maps it
 * to the domain's types. Returns null when no event has that slug.
 */
export async function loadEventCatalog(db: Database, slug: string): Promise<EventCatalog | null> {
  const event = await db
    .selectFrom("events")
    .selectAll()
    .where("slug", "=", slug)
    .executeTakeFirst();
  if (!event) return null;

  const [days, products, productDays, promos] = await Promise.all([
    db
      .selectFrom("event_days")
      .select(["id", "day_date"])
      .where("event_id", "=", event.id)
      .orderBy("day_date")
      .execute(),
    db
      .selectFrom("products as p")
      .leftJoin("inventory as i", "i.product_id", "p.id")
      .select([
        "p.id",
        "p.code",
        "p.display_name",
        "p.kind",
        "p.day_scope",
        "p.unit_price_cents",
        "p.admits_adults",
        "p.admits_children",
        "p.max_per_booking",
        "p.capped_by_daily_headcount",
        "i.remaining",
      ])
      .where("p.event_id", "=", event.id)
      .where("p.is_active", "=", true)
      .orderBy("p.sort_order")
      .orderBy("p.code")
      .execute(),
    db
      .selectFrom("product_days as pd")
      .innerJoin("event_days as d", "d.id", "pd.event_day_id")
      .select(["pd.product_id", "d.day_date"])
      .where("d.event_id", "=", event.id)
      .orderBy("d.day_date")
      .execute(),
    db.selectFrom("promo_codes").selectAll().where("event_id", "=", event.id).execute(),
  ]);

  const daysByProduct = new Map<string, IsoDate[]>();
  for (const { product_id, day_date } of productDays) {
    const list = daysByProduct.get(product_id) ?? [];
    list.push(day_date);
    daysByProduct.set(product_id, list);
  }

  return {
    catalog: {
      event: {
        slug: event.slug,
        timezone: event.timezone,
        days: days.map((day) => day.day_date),
        ageRules: {
          referenceDate: event.age_reference_date,
          childMinAge: event.child_min_age,
          adultMinAge: event.adult_min_age,
          bookerMinAge: event.booker_min_age,
        },
      },
      products: products.map((row): Product => {
        const base = {
          code: row.code,
          name: row.display_name,
          dayScope: row.day_scope,
          unitPriceCents: row.unit_price_cents,
          availableDays: daysByProduct.get(row.id) ?? [],
          // No inventory row means nothing has been allocated to sell.
          remaining: row.remaining ?? 0,
        };
        return row.kind === "entry"
          ? {
              ...base,
              kind: "entry",
              admits: { adults: row.admits_adults, children: row.admits_children },
            }
          : {
              ...base,
              kind: "extra",
              maxPerBooking: row.max_per_booking,
              cappedByDailyHeadcount: row.capped_by_daily_headcount,
            };
      }),
      promos: promos.map(toPromo),
    },
    details: {
      name: event.name,
      venue: event.venue,
      currency: event.currency,
      holdMinutes: event.hold_minutes,
    },
    ids: {
      event: event.id,
      products: new Map(products.map((row) => [row.code, row.id])),
      days: new Map(days.map((day) => [day.day_date, day.id])),
    },
  };
}

function toPromo(row: Selectable<PromoCodes>): Promo {
  return {
    code: row.code,
    discount: toDiscount(row),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    maxRedemptions: row.max_redemptions,
    timesRedeemed: row.times_redeemed,
    isActive: row.is_active,
  };
}

/** The table's CHECK constraint guarantees the matching column is set; this keeps the types honest. */
function toDiscount(row: Selectable<PromoCodes>): PromoDiscount {
  switch (row.discount_type) {
    case "percent_off_total":
      if (row.percent_bps === null) break;
      return { type: "percent_off_total", percentBps: row.percent_bps };
    case "amount_off_total":
      if (row.amount_cents === null) break;
      return { type: "amount_off_total", amountCents: row.amount_cents };
    case "child_entry_free":
      return { type: "child_entry_free" };
  }
  throw new Error(`Promo code ${row.id} has no value for discount type ${row.discount_type}`);
}
