"use client";

import { useState } from "react";
import { useBooking } from "../booking-context";
import type { CatalogExtraProduct } from "../state/reducer";
import type { CatalogEntryProduct } from "../state/ticket-for-age";
import { focusRing } from "../ui/controls";
import { bandLabel, formatPrice, shortDayList } from "../ui/format";

/**
 * Every price and age band, up front, from the live catalog. On a phone it folds to one line so
 * the form stays near the top; from the large breakpoint it is always open.
 */
export function PriceList() {
  const { catalog } = useBooking();
  const [open, setOpen] = useState(false);
  const entries = catalog.products.filter((p): p is CatalogEntryProduct => p.kind === "entry");
  const extras = catalog.products.filter((p): p is CatalogExtraProduct => p.kind === "extra");
  const { ageRules } = catalog.event;
  const festivalDays = catalog.event.days.length;

  return (
    <section
      aria-labelledby="prices-heading"
      className="mt-8 rounded-2xl border border-gold/40 bg-white/5"
    >
      <h2 id="prices-heading" className="sr-only">
        Prices and age bands
      </h2>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="price-list"
        onClick={() => {
          setOpen(!open);
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left lg:hidden ${focusRing}`}
      >
        <span className="font-medium text-bright-gold">Prices & age bands</span>
        <span aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      <div
        id="price-list"
        className={`${open ? "grid" : "hidden"} gap-6 px-5 pb-5 sm:grid-cols-2 lg:grid lg:grid-cols-[1.2fr_1fr_0.8fr] lg:px-6 lg:py-6`}
      >
        <div>
          <h3 className="text-xs font-semibold tracking-wider text-white/65 uppercase">Tickets</h3>
          <dl className="mt-2 space-y-2.5">
            {entries.map((product) => (
              <PriceRow
                key={product.code}
                name={product.name}
                price={
                  product.availability === "sold_out"
                    ? "Sold out"
                    : `${formatPrice(product.unitPriceCents)}${product.dayScope === "per_day" ? " / day" : ""}`
                }
                soldOut={product.availability === "sold_out"}
                note={entryNote(product, festivalDays)}
              />
            ))}
          </dl>
        </div>

        <div>
          <h3 className="text-xs font-semibold tracking-wider text-white/65 uppercase">Extras</h3>
          <dl className="mt-2 space-y-2.5">
            {extras.map((product) => (
              <PriceRow
                key={product.code}
                name={product.name}
                price={
                  product.availability === "sold_out"
                    ? "Sold out"
                    : formatPrice(product.unitPriceCents)
                }
                soldOut={product.availability === "sold_out"}
                note={extraNote(product, festivalDays)}
              />
            ))}
          </dl>
        </div>

        <div>
          <h3 className="text-xs font-semibold tracking-wider text-white/65 uppercase">
            Age bands
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li>{bandLabel("infant", ageRules)}, no ticket</li>
            <li>{bandLabel("child", ageRules)}</li>
            <li>{bandLabel("adult", ageRules)}</li>
          </ul>
          <p className="mt-2 text-sm text-white/65">
            Ages as on the first day. The person booking must be {ageRules.bookerMinAge} or over.
          </p>
        </div>
      </div>
    </section>
  );
}

function PriceRow({
  name,
  price,
  note,
  soldOut,
}: {
  name: string;
  price: string;
  note: string | null;
  soldOut: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className={soldOut ? "text-white/50 line-through" : "text-white"}>{name}</dt>
        <dd
          className={`shrink-0 tabular-nums ${soldOut ? "text-white/65" : "font-semibold text-bright-gold"}`}
        >
          {price}
        </dd>
      </div>
      {note && <dd className="text-sm text-white/65">{note}</dd>}
    </div>
  );
}

function entryNote(product: CatalogEntryProduct, festivalDays: number): string | null {
  const { adults, children } = product.admits;
  if (adults > 0 && children > 0) {
    return `Covers ${String(adults)} adults + ${String(children)} children, per day`;
  }
  return product.dayScope === "whole_event" ? `All ${String(festivalDays)} days` : null;
}

function extraNote(product: CatalogExtraProduct, festivalDays: number): string | null {
  const parts: string[] = [];
  if (product.cappedByDailyHeadcount) parts.push("per person, per day");
  if (product.dayScope === "per_day" && product.availableDays.length < festivalDays) {
    parts.push(`${shortDayList(product.availableDays)} only`);
  }
  if (product.maxPerBooking !== null)
    parts.push(`up to ${String(product.maxPerBooking)} per booking`);
  return parts.length > 0 ? capitalise(parts.join(" · ")) : null;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
