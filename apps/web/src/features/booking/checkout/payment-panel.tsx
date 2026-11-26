"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useEffect, useState } from "react";
import { focusRing } from "../ui/controls";
import { ErrorIcon } from "../ui/field-messages";
import { formatCents } from "../ui/format";
import type { HeldBooking } from "./checkout-state";
import { getStripe, stripeAppearance } from "./stripe";

interface PaymentPanelProps {
  readonly booking: HeldBooking;
  readonly clientSecret: string;
  readonly amountCents: number;
  readonly onPaid: (bookingId: string) => void;
  readonly onChangeBooking: () => void;
  readonly onHoldEnded: () => void;
}

/** Stripe's card form for a booking that is holding its tickets, with the time left to pay. */
export function PaymentPanel(props: PaymentPanelProps) {
  return (
    <div className="mt-5 border-t border-white/15 pt-5">
      <Elements
        stripe={getStripe()}
        options={{ clientSecret: props.clientSecret, appearance: stripeAppearance }}
      >
        <PaymentForm {...props} />
      </Elements>
    </div>
  );
}

function PaymentForm({
  booking,
  amountCents,
  onPaid,
  onChangeBooking,
  onHoldEnded,
}: PaymentPanelProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formReady, setFormReady] = useState(false);

  async function submit() {
    if (!stripe || !elements || paying) return;
    setPaying(true);
    setError(null);
    const { error: failure, paymentIntent } = await stripe.confirmPayment({
      elements,
      // Only used by payment methods that leave the page (some banks' checks); cards stay here.
      confirmParams: { return_url: `${window.location.origin}/bookings/${booking.id}` },
      redirect: "if_required",
    });
    if (failure) {
      // Declined cards, wrong numbers, failed bank checks: Stripe's message says what to do.
      setError(failure.message ?? "The payment didn't go through. Please try again.");
      setPaying(false);
      return;
    }
    if (paymentIntent.status === "succeeded" || paymentIntent.status === "processing") {
      onPaid(booking.id);
      return;
    }
    setError("The payment didn't go through. Please try again.");
    setPaying(false);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-labelledby="payment-heading"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="payment-heading" className="font-serif text-xl text-white">
          Payment
        </h3>
        <HoldCountdown until={booking.holdExpiresAt} onEnded={onHoldEnded} />
      </div>
      <p className="mt-1 text-sm text-white/65">
        Booking {booking.reference}. Your tickets are held while you pay.
      </p>

      <div className="mt-4 min-h-40">
        <PaymentElement
          options={{ layout: "tabs" }}
          onReady={() => {
            setFormReady(true);
          }}
        />
        {!formReady && <p className="text-sm text-white/65">Loading the secure card form…</p>}
      </div>

      {error && (
        <p role="alert" className="mt-4 flex gap-2 text-sm text-error-text">
          <ErrorIcon />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || !formReady || paying}
        className={`mt-5 h-14 w-full rounded-xl bg-primary text-lg font-semibold text-heading transition-colors hover:bg-bright-gold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
      >
        {paying ? "Paying…" : `Pay ${formatCents(amountCents)}`}
      </button>
      <button
        type="button"
        disabled={paying}
        onClick={onChangeBooking}
        className={`mt-3 w-full rounded-lg py-2 text-sm text-white/65 underline-offset-4 hover:text-white hover:underline disabled:opacity-50 ${focusRing}`}
      >
        Change booking
      </button>
    </form>
  );
}

/** Minutes and seconds left on the hold. Tells the parent once, when it runs out. */
function HoldCountdown({ until, onEnded }: { until: string; onEnded: () => void }) {
  const end = Date.parse(until);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let ended = false;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= end && !ended) {
        ended = true;
        clearInterval(timer);
        onEnded();
      }
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [end, onEnded]);

  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  const urgent = left < 120;
  return (
    <p
      className={`shrink-0 text-sm tabular-nums ${urgent ? "font-semibold text-error-text" : "text-bright-gold"}`}
      // A timer is read when reached, not announced every second.
      role="timer"
    >
      <span className="sr-only">Time left to pay: </span>
      {minutes}:{seconds}
    </p>
  );
}
