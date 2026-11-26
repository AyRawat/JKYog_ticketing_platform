"use client";

import { useBooking } from "../booking-context";
import { fieldGroupId, fieldKey } from "../state/fields";
import { Card, Chip, SectionHeading } from "../ui/controls";
import { FieldMessages, useMessageId } from "../ui/field-messages";
import { formatPrice, shortDayLabel } from "../ui/format";

/**
 * The days the group is coming, asked first: tickets start on these days, so nobody fills in
 * the group and then finds out at Pay that no day was picked.
 */
export function VisitDaysSection() {
  const { catalog, state, dispatch } = useBooking();
  const key = fieldKey.visitDays;
  const messageId = useMessageId(key);
  const { days } = catalog.event;
  const bookable = days.filter((day) => day.bookable);
  const everyDay =
    bookable.length > 1 && bookable.every((day) => state.visitDays.includes(day.date));
  const allDayPasses = catalog.products.filter(
    (product) =>
      product.kind === "entry" &&
      product.dayScope === "whole_event" &&
      product.availability === "on_sale",
  );

  return (
    <section aria-labelledby="visit-days-heading" className="space-y-4">
      <div>
        <SectionHeading id="visit-days-heading">When are you coming?</SectionHeading>
        <p className="mt-1 text-white/65">
          Pick every day anyone in your group is coming. You can take a day off for one person
          later.
        </p>
      </div>
      <Card>
        <fieldset id={fieldGroupId(key)} aria-describedby={messageId}>
          <legend className="sr-only">Days you're coming</legend>
          <div className="flex flex-wrap gap-2">
            {days.map((day) => (
              <Chip
                key={day.date}
                pressed={state.visitDays.includes(day.date)}
                disabled={!day.bookable}
                onToggle={() => {
                  dispatch({ type: "visitDayToggled", day: day.date });
                  dispatch({ type: "fieldTouched", key });
                }}
              >
                {shortDayLabel(day.date)}
              </Chip>
            ))}
          </div>
          <FieldMessages fieldKey={key} />
        </fieldset>
        {everyDay && allDayPasses.length > 0 && (
          <p className="mt-4 text-sm text-white/75">
            Coming every day? An All-Day Pass covers the whole festival from{" "}
            {formatPrice(Math.min(...allDayPasses.map((product) => product.unitPriceCents)))}.
          </p>
        )}
      </Card>
    </section>
  );
}
