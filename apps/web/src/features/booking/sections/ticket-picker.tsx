"use client";

import { bandAgeRange, type TicketedBand } from "@ticketing/domain";
import { useBooking } from "../booking-context";
import { fieldGroupId, fieldKey } from "../state/fields";
import { isSharedPass } from "../state/reducer";
import { admitsBand, type CatalogEntryProduct } from "../state/ticket-for-age";
import type { Person } from "../state/types";
import { Chip } from "../ui/controls";
import { FieldMessages, useMessageId } from "../ui/field-messages";
import { formatPrice, shortDayLabel } from "../ui/format";

interface TicketPickerProps {
  readonly person: Person;
  readonly band: TicketedBand | null;
  readonly firstName: string;
}

/** One person's ticket (radio cards) and, for a per-day ticket, their days (chips). */
export function TicketPicker({ person, band, firstName }: TicketPickerProps) {
  const { catalog, dispatch } = useBooking();
  const entries = catalog.products.filter((p): p is CatalogEntryProduct => p.kind === "entry");
  const chosen = entries.find((product) => product.code === person.entry?.productCode);
  const ticketKey = fieldKey.person(person.id, "ticket");
  const daysKey = fieldKey.person(person.id, "days");
  const ticketMessageId = useMessageId(ticketKey);
  const daysMessageId = useMessageId(daysKey);

  return (
    <div className="space-y-5">
      <fieldset id={fieldGroupId(ticketKey)} aria-describedby={ticketMessageId}>
        <legend className="text-sm font-medium text-white">Ticket</legend>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          {entries.map((product) => {
            const reason = unavailableReason(product, band, catalog.event.ageRules);
            return (
              <label
                key={product.code}
                className="relative flex cursor-pointer flex-col rounded-xl border border-white/20 bg-white/[0.03] p-3.5 transition-colors hover:border-bright-gold has-checked:border-primary has-checked:bg-primary/15 has-disabled:cursor-not-allowed has-disabled:border-white/10 has-disabled:bg-transparent has-disabled:hover:border-white/10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-bright-gold"
              >
                <input
                  type="radio"
                  name={`ticket-${person.id}`}
                  value={product.code}
                  checked={person.entry?.productCode === product.code}
                  disabled={reason !== null}
                  className="sr-only"
                  onChange={() => {
                    if (isSharedPass(product)) {
                      // One card for the whole family: the other places open in it.
                      const places = product.admits.adults + product.admits.children;
                      dispatch({
                        type: "familyStarted",
                        id: person.id,
                        productCode: product.code,
                        familyId: crypto.randomUUID(),
                        newIds: Array.from({ length: places - 1 }, () => crypto.randomUUID()),
                      });
                    } else {
                      dispatch({ type: "ticketChosen", id: person.id, productCode: product.code });
                    }
                    dispatch({ type: "fieldTouched", key: ticketKey });
                  }}
                />
                <span className="flex items-baseline justify-between gap-2">
                  <span className={reason ? "text-white/45" : "font-medium text-white"}>
                    {product.name}
                  </span>
                  <span
                    className={`shrink-0 tabular-nums ${reason ? "text-white/45" : "font-semibold text-bright-gold"}`}
                  >
                    {formatPrice(product.unitPriceCents)}
                    {product.dayScope === "per_day" ? (
                      <span className="font-normal"> / day</span>
                    ) : null}
                  </span>
                </span>
                <span className={`mt-0.5 text-sm ${reason ? "text-white/55" : "text-white/65"}`}>
                  {reason ?? ticketNote(product, catalog.event.days.length)}
                </span>
              </label>
            );
          })}
        </div>
        <FieldMessages fieldKey={ticketKey} />
      </fieldset>

      {chosen?.dayScope === "per_day" && (
        <fieldset id={fieldGroupId(daysKey)} aria-describedby={daysMessageId}>
          <legend className="text-sm font-medium text-white">
            Which days is {firstName} coming?
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {catalog.event.days
              .filter((day) => chosen.availableDays.includes(day.date))
              .map((day) => (
                <Chip
                  key={day.date}
                  pressed={person.entry?.days.includes(day.date) ?? false}
                  disabled={!day.bookable}
                  onToggle={() => {
                    dispatch({ type: "dayToggled", id: person.id, day: day.date });
                    dispatch({ type: "fieldTouched", key: daysKey });
                  }}
                >
                  {shortDayLabel(day.date)}
                </Chip>
              ))}
          </div>
          <FieldMessages fieldKey={daysKey} />
        </fieldset>
      )}
    </div>
  );
}

/** Why this ticket can't be picked for this person, or null when it can. */
function unavailableReason(
  product: CatalogEntryProduct,
  band: TicketedBand | null,
  rules: Parameters<typeof bandAgeRange>[1],
): string | null {
  if (product.availability === "sold_out") return "Sold out";
  if (product.availability === "sale_closed") return "No longer on sale";
  if (band === null || admitsBand(product, band)) return null;
  const fits = product.admits.adults > 0 ? "adult" : "child";
  const range = bandAgeRange(fits, rules);
  return `${range.charAt(0).toUpperCase()}${range.slice(1)} only`;
}

function ticketNote(product: CatalogEntryProduct, festivalDays: number): string {
  const { adults, children } = product.admits;
  if (adults > 0 && children > 0) {
    return `${String(adults)} adults + ${String(children)} children together, per day`;
  }
  return product.dayScope === "whole_event" ? `All ${String(festivalDays)} days` : "Pick your days";
}
