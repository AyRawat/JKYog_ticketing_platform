"use client";

import type { LiveQuote } from "../api/use-live-quote";
import { useBooking } from "../booking-context";
import { focusRing } from "../ui/controls";
import { formatCents } from "../ui/format";

/** On a phone, the total stays in view at the bottom, with a jump to the order and pay button. */
export function MobileTotalBar({ live }: { live: LiveQuote }) {
  const { state } = useBooking();
  const quote = live.latest?.quote;
  const people = state.people.length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gold/40 bg-primary-dark/95 px-4 py-3 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
        <div aria-live="polite" className={live.stale ? "opacity-60" : undefined}>
          <p className="text-xs text-white/65">
            Total · {people} {people === 1 ? "person" : "people"}
          </p>
          <p className="font-serif text-2xl text-bright-gold tabular-nums">
            {quote ? formatCents(quote.totalCents) : "—"}
          </p>
        </div>
        <a
          href="#order"
          className={`inline-flex h-12 items-center rounded-xl bg-primary px-5 font-semibold text-heading hover:bg-bright-gold ${focusRing}`}
        >
          Review & pay
        </a>
      </div>
    </div>
  );
}
