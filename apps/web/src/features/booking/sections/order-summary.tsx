"use client";

import { useRef, useState } from "react";
import { PaymentPanel } from "../checkout/payment-panel";
import type { Checkout } from "../checkout/use-checkout";
import type { LiveQuote } from "../api/use-live-quote";
import { useBooking } from "../booking-context";
import type { QuoteResponse } from "@ticketing/contracts";
import { fieldDomId, fieldGroupId, fieldKey } from "../state/fields";
import type { BookingState } from "../state/types";
import { focusRing } from "../ui/controls";
import { ErrorIcon } from "../ui/field-messages";
import { dayLabel, formatCents } from "../ui/format";
import { inputId } from "../ui/text-field";

interface OrderSummaryProps {
  readonly live: LiveQuote;
  /** True when nothing the browser can check is wrong either. */
  readonly locallyValid: boolean;
  readonly checkout: Checkout;
}

/** The server's bill, the promo code, and the pay button. Every amount here is the quote's. */
export function OrderSummary({ live, locallyValid, checkout }: OrderSummaryProps) {
  const { state, dispatch, messages } = useBooking();
  const summaryRef = useRef<HTMLDivElement>(null);
  const quote = live.latest?.quote;
  const ready = Boolean(quote?.canBook) && locallyValid && !live.stale && live.problem === null;
  const { phase } = checkout.state;

  return (
    <section
      aria-labelledby="order-heading"
      className="rounded-2xl border border-gold/50 bg-white/[0.07] p-5 sm:p-6"
    >
      <h2 id="order-heading" className="font-serif text-2xl text-bright-gold">
        Your order
      </h2>

      <ConnectionNotice live={live} />

      <div
        aria-live="polite"
        aria-busy={live.stale}
        className={live.stale ? "opacity-60 transition-opacity" : "transition-opacity"}
      >
        {!quote ? (
          <p className="mt-4 text-white/65">Working out your total…</p>
        ) : quote.lines.length === 0 ? (
          <p className="mt-4 text-white/65">Choose tickets for your group to see the total.</p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {quote.lines.map((line) => (
              <li
                key={`${line.productCode}-${line.day ?? "all"}`}
                className="flex justify-between gap-3 text-sm"
              >
                <span>
                  <span className="tabular-nums">{line.quantity} ×</span> {line.productName}
                  <span className="block text-white/65">
                    {line.day ? dayLabel(line.day) : "Whole festival"}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatCents(line.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
        )}

        {quote && quote.notices.length > 0 && (
          <ul className="mt-4 space-y-2">
            {quote.notices.map((notice) => (
              <li
                key={notice.message}
                className="rounded-xl border border-gold/50 bg-gold/10 px-3.5 py-3 text-sm text-cream"
              >
                <span className="font-semibold text-bright-gold">
                  Save {formatCents(notice.savingsCents)}:{" "}
                </span>
                {notice.message}
              </li>
            ))}
          </ul>
        )}

        {/* No changing the code once the booking is being made or paid for. */}
        <fieldset disabled={phase !== "editing"} className="disabled:opacity-60">
          <PromoField quote={quote} />
        </fieldset>

        {quote && (
          <dl className="mt-5 space-y-1.5 border-t border-white/15 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-white/65">Subtotal</dt>
              <dd className="tabular-nums">{formatCents(quote.subtotalCents)}</dd>
            </div>
            {quote.discountCents > 0 && (
              <div className="flex justify-between text-success-text">
                <dt>Discount</dt>
                <dd className="tabular-nums">−{formatCents(quote.discountCents)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between pt-2">
              <dt className="font-serif text-lg">Total</dt>
              <dd className="font-serif text-3xl text-bright-gold tabular-nums">
                {formatCents(quote.totalCents)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div ref={summaryRef} tabIndex={-1} className="outline-none">
        {state.payAttempted && !ready && phase === "editing" && (
          <ErrorSummary state={state} messages={messages} />
        )}
      </div>

      {checkout.state.phase === "editing" && checkout.state.notice && (
        <p
          role="alert"
          className={`mt-4 flex gap-2 rounded-xl px-4 py-3 text-sm ${
            checkout.state.notice.tone === "error"
              ? "border border-error/70 bg-error/10 text-error-text"
              : "bg-white/10 text-white"
          }`}
        >
          {checkout.state.notice.tone === "error" && <ErrorIcon />}
          {checkout.state.notice.text}
        </p>
      )}

      {checkout.state.phase === "paying" ? (
        <PaymentPanel
          booking={checkout.state.booking}
          clientSecret={checkout.state.clientSecret}
          amountCents={checkout.state.amountCents}
          onPaid={checkout.paid}
          onChangeBooking={checkout.changeBooking}
          onHoldEnded={checkout.holdEnded}
        />
      ) : (
        <>
          <button
            type="button"
            disabled={!quote || phase !== "editing"}
            aria-busy={phase !== "editing"}
            onClick={() => {
              dispatch({ type: "payAttempted" });
              if (ready && quote) {
                void checkout.pay(quote.totalCents);
              } else {
                // Wait a frame for the summary to render, then take the reader there.
                requestAnimationFrame(() => summaryRef.current?.focus());
              }
            }}
            className={`mt-5 h-14 w-full rounded-xl bg-primary text-lg font-semibold text-heading transition-colors hover:bg-bright-gold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          >
            {phase === "submitting"
              ? "Holding your tickets…"
              : phase === "done"
                ? "Opening your booking…"
                : quote && quote.totalCents > 0
                  ? `Pay ${formatCents(quote.totalCents)}`
                  : "Book"}
          </button>
          <p className="mt-2 text-center text-xs text-white/65">
            Prices are checked again when you pay. Tickets are held for 15 minutes while you do.
          </p>
        </>
      )}
    </section>
  );
}

function ConnectionNotice({ live }: { live: LiveQuote }) {
  if (live.problem === "offline") {
    return (
      <p role="status" className="mt-3 rounded-xl bg-white/10 px-3.5 py-2.5 text-sm">
        You're offline. Your choices are kept; the total updates when you're back.
      </p>
    );
  }
  if (live.problem === "failed") {
    return (
      <p role="status" className="mt-3 rounded-xl bg-white/10 px-3.5 py-2.5 text-sm">
        {live.problemMessage ?? "We couldn't update the total."}{" "}
        <button
          type="button"
          onClick={live.retry}
          className={`font-medium text-bright-gold underline ${focusRing}`}
        >
          Try again
        </button>
      </p>
    );
  }
  return null;
}

function PromoField({ quote }: { quote: QuoteResponse | undefined }) {
  const { state, dispatch } = useBooking();
  const [text, setText] = useState(state.promoCode);
  const applied = state.promoCode.trim();
  const promo = quote?.promo;
  const id = inputId(fieldKey.promo);

  return (
    <div className="mt-5 border-t border-white/15 pt-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          dispatch({ type: "promoCodeChanged", code: text.trim() });
        }}
      >
        <label htmlFor={id} className="sr-only">
          Promo code
        </label>
        <input
          id={id}
          value={text}
          maxLength={32}
          placeholder="Promo code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby={promo ? fieldDomId(fieldKey.promo) : undefined}
          onChange={(event) => {
            setText(event.target.value);
          }}
          className="h-11 min-w-0 flex-1 rounded-lg border border-white/20 bg-white/5 px-3 text-base uppercase placeholder:text-white/40 placeholder:normal-case focus-visible:border-bright-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright-gold"
        />
        <button
          type="submit"
          className={`h-11 shrink-0 rounded-lg border border-primary px-4 text-sm font-medium text-bright-gold hover:bg-primary/15 ${focusRing}`}
        >
          Apply
        </button>
      </form>
      {applied && promo && (
        <p
          id={fieldDomId(fieldKey.promo)}
          className={`mt-2 flex items-start justify-between gap-3 text-sm ${promo.status === "applied" ? "text-success-text" : "text-error-text"}`}
        >
          <span>
            {promo.status === "applied" ? "✓ " : ""}
            <span className="font-semibold">{promo.code}</span>: {promo.message}
          </span>
          <button
            type="button"
            className={`shrink-0 text-white/65 underline hover:text-white ${focusRing}`}
            onClick={() => {
              setText("");
              dispatch({ type: "promoCodeChanged", code: "" });
            }}
          >
            Remove
          </button>
        </p>
      )}
    </div>
  );
}

/** Every problem on the page, each linking to its field. Shown after a pay attempt. */
function ErrorSummary({
  state,
  messages,
}: {
  state: BookingState;
  messages: ReadonlyMap<string, readonly string[]>;
}) {
  const items = [...messages].flatMap(([key, list]) => list.map((message) => ({ key, message })));
  if (items.length === 0) {
    return (
      <p className="mt-4 text-sm text-white/65">Finishing your total… try again in a moment.</p>
    );
  }
  return (
    <div role="alert" className="mt-5 rounded-xl border border-error/70 bg-error/10 p-4">
      <p className="flex gap-2 font-semibold text-white">
        <ErrorIcon />
        Please fix {items.length === 1 ? "this" : `these ${String(items.length)} things`} first
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {items.map(({ key, message }) => (
          <li key={`${key}-${message}`}>
            <a
              href={`#${inputId(key)}`}
              onClick={(event) => {
                event.preventDefault();
                jumpTo(key);
              }}
              className={`text-error-text underline underline-offset-2 hover:text-white ${focusRing}`}
            >
              {whoFor(key, state)}
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The element a summary link takes you to: the text input, or the box around a group. */
function findTarget(key: string): HTMLElement | null {
  return document.getElementById(inputId(key)) ?? document.getElementById(fieldGroupId(key));
}

function jumpTo(key: string) {
  const target = findTarget(key);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = target.matches("input, button")
    ? target
    : target.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled])");
  focusable?.focus({ preventScroll: true });
}

/** "Riya: " for a person's field, so a message in the summary says who it's about. */
function whoFor(key: string, state: BookingState): string {
  const match = /^person:([^.]+)\./.exec(key);
  if (!match) return "";
  const person = state.people.find((p) => p.id === match[1]);
  if (!person) return "";
  const name = person.kind === "booker" ? state.booker.fullName || "You" : person.fullName;
  return name.trim() ? `${name.trim()}: ` : `Person ${String(state.people.indexOf(person) + 1)}: `;
}
