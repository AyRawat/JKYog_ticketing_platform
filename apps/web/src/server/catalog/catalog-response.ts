import "server-only";
import type { CatalogResponse } from "@ticketing/contracts";
import { catalogAvailability } from "@ticketing/domain";
import type { EventCatalog } from "./load-catalog";

/** The public view of a catalog: no ids, no stock counts, no promo codes. */
export function toCatalogResponse({ catalog, details }: EventCatalog, now: Date): CatalogResponse {
  const availability = catalogAvailability(catalog, now);
  const { event } = catalog;

  return {
    event: {
      slug: event.slug,
      name: details.name,
      venue: details.venue,
      timezone: event.timezone,
      currency: details.currency,
      holdMinutes: details.holdMinutes,
      days: [...availability.days],
      ageRules: { ...event.ageRules },
    },
    products: catalog.products.map((product) => {
      const base = {
        code: product.code,
        name: product.name,
        dayScope: product.dayScope,
        unitPriceCents: product.unitPriceCents,
        availableDays: [...product.availableDays],
        availability: availability.products.get(product.code) ?? "sale_closed",
      };
      return product.kind === "entry"
        ? { ...base, kind: "entry", admits: { ...product.admits } }
        : {
            ...base,
            kind: "extra",
            maxPerBooking: product.maxPerBooking,
            cappedByDailyHeadcount: product.cappedByDailyHeadcount,
          };
    }),
  };
}
