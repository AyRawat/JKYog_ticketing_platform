"use client";

import { useBooking } from "../booking-context";
import { fieldDomId, fieldGroupId, fieldKey } from "../state/fields";
import { admittedDays, type CatalogExtraProduct } from "../state/reducer";
import type { Person } from "../state/types";
import { Chip, Stepper } from "../ui/controls";
import { FieldMessages, useMessageId } from "../ui/field-messages";
import { formatPrice, shortDayLabel, shortDayList } from "../ui/format";

interface PersonExtrasProps {
  readonly person: Person;
  readonly firstName: string;
}

/** This person's extras: day chips for per-day ones, a stepper for whole-festival ones. */
export function PersonExtrasFields({ person, firstName }: PersonExtrasProps) {
  const { catalog } = useBooking();
  const extras = catalog.products.filter((p): p is CatalogExtraProduct => p.kind === "extra");

  return (
    <div className="space-y-5 border-t border-white/10 pt-5">
      <h4 className="font-serif text-lg text-white">Extras for {firstName}</h4>
      {extras.map((product) =>
        product.dayScope === "per_day" ? (
          <DayExtra key={product.code} product={product} person={person} firstName={firstName} />
        ) : (
          <CountExtra key={product.code} product={product} person={person} firstName={firstName} />
        ),
      )}
    </div>
  );
}

interface ExtraProps {
  readonly product: CatalogExtraProduct;
  readonly person: Person;
  readonly firstName: string;
}

function DayExtra({ product, person, firstName }: ExtraProps) {
  const { catalog, dispatch } = useBooking();
  const attending = new Set(admittedDays(person.entry, catalog));
  const chosen = person.extras.days[product.code] ?? [];
  const soldOut = product.availability !== "on_sale";
  const onlySomeDays = product.availableDays.length < catalog.event.days.length;
  const anyOpen = product.availableDays.some((day) => attending.has(day));
  const groupId = `${fieldDomId(fieldKey.extra(product.code, null))}-${person.id}`;

  let hint: string | null = null;
  if (soldOut) hint = "Sold out";
  else if (attending.size === 0) hint = `Choose ${firstName}'s ticket and days first.`;
  else if (!anyOpen)
    hint = `Runs ${shortDayList(product.availableDays)}. Add one of those days to ${firstName}'s ticket to join.`;
  else if (onlySomeDays) hint = `Runs ${shortDayList(product.availableDays)} only.`;

  return (
    <fieldset
      id={chosen[0] ? fieldGroupId(fieldKey.extra(product.code, chosen[0])) : undefined}
      aria-describedby={hint ? `${groupId}-hint` : undefined}
    >
      <legend className="flex w-full items-baseline justify-between gap-3">
        <span className="text-white">{product.name}</span>
        <span className="text-sm text-white/65 tabular-nums">
          {formatPrice(product.unitPriceCents)} each
        </span>
      </legend>
      {hint && (
        <p id={`${groupId}-hint`} className="mt-0.5 text-sm text-white/65">
          {hint}
        </p>
      )}
      {!soldOut && anyOpen && (
        <div className="mt-2 flex flex-wrap gap-2">
          {product.availableDays
            .filter((day) => attending.has(day))
            .map((day) => (
              <Chip
                key={day}
                pressed={chosen.includes(day)}
                label={`${product.name} on ${shortDayLabel(day)} for ${firstName}`}
                onToggle={() => {
                  dispatch({
                    type: "extraDayToggled",
                    id: person.id,
                    productCode: product.code,
                    day,
                  });
                  dispatch({ type: "fieldTouched", key: fieldKey.extra(product.code, day) });
                }}
              >
                {shortDayLabel(day)}
              </Chip>
            ))}
        </div>
      )}
      {chosen.map((day) => (
        <FieldMessages key={day} fieldKey={fieldKey.extra(product.code, day)} />
      ))}
    </fieldset>
  );
}

function CountExtra({ product, person, firstName }: ExtraProps) {
  const { state, dispatch } = useBooking();
  const key = fieldKey.extra(product.code, null);
  const messageId = useMessageId(key);
  const mine = person.extras.quantities[product.code] ?? 0;
  const others = state.people
    .filter((other) => other.id !== person.id)
    .reduce((sum, other) => sum + (other.extras.quantities[product.code] ?? 0), 0);
  const max = product.maxPerBooking === null ? 99 : Math.max(product.maxPerBooking - others, 0);
  const soldOut = product.availability !== "on_sale";

  return (
    <div
      id={mine > 0 ? fieldGroupId(key) : undefined}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <div>
        <p className="text-white">{product.name}</p>
        <p className="text-sm text-white/65">
          {soldOut
            ? "Sold out"
            : `${formatPrice(product.unitPriceCents)} each${
                product.maxPerBooking === null
                  ? ""
                  : ` · up to ${String(product.maxPerBooking)} per booking`
              }`}
        </p>
      </div>
      {!soldOut && (
        <Stepper
          value={mine}
          max={Math.max(max, mine)}
          thing={`${product.name} for ${firstName}`}
          describedBy={messageId}
          onChange={(quantity) => {
            dispatch({
              type: "extraQuantitySet",
              id: person.id,
              productCode: product.code,
              quantity,
            });
            dispatch({ type: "fieldTouched", key });
          }}
        />
      )}
      <div className="w-full">
        <FieldMessages fieldKey={key} />
      </div>
    </div>
  );
}
