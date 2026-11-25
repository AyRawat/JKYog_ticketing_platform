"use client";

import type { CatalogResponse } from "@ticketing/contracts";

interface BookingFlowProps {
  readonly catalog: CatalogResponse;
}

/** The booking form. Owns the flow's state; the steps are built inside it. */
export function BookingFlow({ catalog }: BookingFlowProps) {
  const { event } = catalog;

  return (
    <section aria-labelledby="booking-heading" className="mt-10">
      <h2 id="booking-heading" className="font-serif text-2xl text-bright-gold">
        Book your tickets
      </h2>
      <p className="mt-2 text-white/70">
        Ages are counted on {event.ageRules.referenceDate}. Tickets are held for {event.holdMinutes}{" "}
        minutes while you pay.
      </p>
    </section>
  );
}
