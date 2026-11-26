"use client";

import type { BookingResponse } from "@ticketing/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchBooking } from "../booking/api/client";
import { focusRing } from "../booking/ui/controls";
import { dayLabel, formatCents } from "../booking/ui/format";
import { doorList } from "./door-list";

interface ReceiptViewProps {
  readonly initial: BookingResponse;
  readonly venue: string;
  /** Stripe adds this when a payment method had to leave the page and came back failed. */
  readonly paymentFailed: boolean;
}

/** Ask often at first (the webhook usually lands in seconds), then back off. */
const pollDelay = (attempt: number) => (attempt < 30 ? 2_000 : 10_000);

/**
 * The family's booking: a receipt once paid, the door list for each day, and what was paid.
 * While the payment is being confirmed it checks back until the booking is confirmed.
 */
export function ReceiptView({ initial, venue, paymentFailed }: ReceiptViewProps) {
  const [booking, setBooking] = useState(initial);
  const waiting = booking.status === "pending_payment";

  useEffect(() => {
    if (!waiting) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const check = async () => {
      const result = await fetchBooking(booking.id, controller.signal);
      if (result.ok) setBooking(result.data);
      if (!result.ok || result.data.status === "pending_payment") {
        timer = setTimeout(() => void check(), pollDelay(++attempt));
      }
    };
    timer = setTimeout(() => void check(), pollDelay(attempt));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [waiting, booking.id]);

  const doors = doorList(booking);
  const paid = booking.status === "confirmed";

  return (
    <div className="space-y-8">
      <StatusBanner booking={booking} paymentFailed={paymentFailed} />

      {/* The reference is what the door asks for: big, high contrast, easy to read out. */}
      <section
        aria-labelledby="reference-heading"
        className="rounded-2xl bg-cream p-6 text-heading sm:p-8 print:border print:border-black"
      >
        <h2
          id="reference-heading"
          className="text-sm font-semibold tracking-widest uppercase text-primary-text"
        >
          Booking reference
        </h2>
        <p className="mt-2 font-mono text-4xl font-bold tracking-wider sm:text-5xl">
          {booking.reference}
        </p>
        <p className="mt-3 text-primary-text">
          {booking.event.name} · {venue}
        </p>
        {paid && (
          <p className="mt-1 text-primary-text">
            Show this reference at the door. Everyone below is on the list.
          </p>
        )}
      </section>

      <section aria-labelledby="door-heading" className="space-y-4">
        <h2 id="door-heading" className="font-serif text-2xl text-bright-gold print:text-black">
          Who's coming, day by day
        </h2>
        {doors.days.length === 0 && (
          <p className="text-white/65 print:text-black">No tickets in this booking.</p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {doors.days.map(({ day, people }) => (
            <li
              key={day}
              className="rounded-2xl border border-white/20 bg-white/5 p-4 print:border-black print:bg-transparent"
            >
              <h3 className="font-semibold text-white print:text-black">{dayLabel(day)}</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {people.map((person) => (
                  <li
                    key={`${person.fullName}-${person.ticket}`}
                    className="flex justify-between gap-3"
                  >
                    <span>{person.fullName}</span>
                    <span className="text-white/65 print:text-black">{person.ticket}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {doors.freeChildren.length > 0 && (
          <p className="text-sm text-white/65 print:text-black">
            Also coming, free with their family (under 5): {doors.freeChildren.join(", ")}.
          </p>
        )}
      </section>

      <section
        aria-labelledby="paid-heading"
        className="rounded-2xl border border-white/20 bg-white/5 p-5 sm:p-6 print:border-black print:bg-transparent"
      >
        <h2 id="paid-heading" className="font-serif text-2xl text-bright-gold print:text-black">
          {paid ? "What you paid" : "Your order"}
        </h2>
        <ul className="mt-4 space-y-2.5">
          {booking.lines.map((line) => (
            <li
              key={`${line.productCode}-${line.day ?? "all"}`}
              className="flex justify-between gap-3 text-sm"
            >
              <span>
                <span className="tabular-nums">{line.quantity} ×</span> {line.productName}
                <span className="block text-white/65 print:text-black">
                  {line.day ? dayLabel(line.day) : "Whole festival"}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatCents(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-5 space-y-1.5 border-t border-white/15 pt-4 text-sm print:border-black">
          <div className="flex justify-between">
            <dt className="text-white/65 print:text-black">Subtotal</dt>
            <dd className="tabular-nums">{formatCents(booking.subtotalCents)}</dd>
          </div>
          {booking.discountCents > 0 && (
            <div className="flex justify-between text-success-text print:text-black">
              <dt>Discount{booking.promoCode ? ` (${booking.promoCode})` : ""}</dt>
              <dd className="tabular-nums">−{formatCents(booking.discountCents)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-2">
            <dt className="font-serif text-lg">{paid ? "Total paid" : "Total"}</dt>
            <dd className="font-serif text-3xl text-bright-gold tabular-nums print:text-black">
              {formatCents(booking.totalCents)}
            </dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-3 print:hidden">
        {paid && (
          <button
            type="button"
            onClick={() => {
              window.print();
            }}
            className={`h-12 rounded-xl bg-primary px-6 font-semibold text-heading hover:bg-bright-gold ${focusRing}`}
          >
            Print or save as PDF
          </button>
        )}
        <Link
          href="/"
          className={`inline-flex h-12 items-center rounded-xl border border-gold px-6 text-bright-gold hover:bg-white/5 ${focusRing}`}
        >
          {paid ? "Make another booking" : "Back to booking"}
        </Link>
      </div>
    </div>
  );
}

function StatusBanner({
  booking,
  paymentFailed,
}: {
  booking: BookingResponse;
  paymentFailed: boolean;
}) {
  switch (booking.status) {
    case "confirmed":
      return (
        <div role="status" className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-xl text-white print:hidden"
          >
            ✓
          </span>
          <div>
            <h1 className="font-serif text-3xl text-white sm:text-4xl print:text-black">
              You're booked!
            </h1>
            <p className="mt-1 text-white/75 print:text-black">
              Your payment went through and your tickets are confirmed. A copy of this page is your
              receipt.
            </p>
          </div>
        </div>
      );
    case "pending_payment":
      return (
        <div role="status" aria-live="polite" className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1 size-8 shrink-0 animate-spin rounded-full border-4 border-white/20 border-t-bright-gold"
          />
          <div>
            <h1 className="font-serif text-3xl text-white sm:text-4xl">
              {paymentFailed ? "Your payment didn't go through" : "Confirming your payment…"}
            </h1>
            <p className="mt-1 text-white/75">
              {paymentFailed
                ? "Nothing was charged. Your tickets are still held for a short while: go back and try another card."
                : "This usually takes a few seconds. You can keep this page open; it updates by itself."}
            </p>
          </div>
        </div>
      );
    case "expired":
    case "cancelled":
      return (
        <div role="status">
          <h1 className="font-serif text-3xl text-white sm:text-4xl">
            This booking wasn't completed
          </h1>
          <p className="mt-1 text-white/75">
            It wasn't paid in time, so its tickets went back on sale and nothing was charged. You
            can book again; it only takes a minute.
          </p>
        </div>
      );
  }
}
