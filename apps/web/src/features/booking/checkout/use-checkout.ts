"use client";

import type { BookingRequestInput } from "@ticketing/contracts";
import { useRouter } from "next/navigation";
import { useReducer, useState } from "react";
import { createBooking, fetchBooking, startPayment, type ApiResult } from "../api/client";
import { messagesByField } from "../state/issues";
import type { Messages } from "../state/messages";
import { toBookingRequest } from "../state/requests";
import type { BookingState } from "../state/types";
import {
  checkoutReducer,
  initialCheckout,
  type CheckoutState,
  type HeldBooking,
  type Notice,
} from "./checkout-state";
import { forgetIdempotencyKey, idempotencyKeyFor } from "./idempotency";

export interface Checkout {
  readonly state: CheckoutState;
  /** Problems the booking endpoint found, placed on the form. Only for the cart they were for. */
  readonly bookingErrors: Messages;
  /** Makes the booking (holding the tickets) and opens the payment form. */
  readonly pay: (totalCents: number) => Promise<void>;
  /** Paid: on to the receipt. */
  readonly paid: (bookingId: string) => void;
  /** Back to the form. The held tickets are let go when the hold ends. */
  readonly changeBooking: () => void;
  readonly holdEnded: () => void;
}

type Outcome =
  | { readonly kind: "refused"; readonly notice: Notice }
  | {
      readonly kind: "paying";
      readonly booking: HeldBooking;
      readonly clientSecret: string;
      readonly amountCents: number;
    }
  | { readonly kind: "done"; readonly bookingId: string };

const NO_MESSAGES: Messages = new Map();

const offline: Notice = {
  tone: "error",
  text: "We couldn't reach the server, so nothing was booked or charged. Check your connection and press Pay again. It won't book twice.",
};
const unexpected: Notice = {
  tone: "error",
  text: "Something went wrong on our side. Nothing was charged. Please press Pay again.",
};

export function useCheckout(
  slug: string,
  state: BookingState,
  { requote, onInvalid }: { requote: () => void; onInvalid: () => void },
): Checkout {
  const router = useRouter();
  const [checkout, dispatch] = useReducer(checkoutReducer, initialCheckout);
  // Kept with the cart they were for: once the family changes anything, they no longer show.
  const [errors, setErrors] = useState<{ for: BookingState; messages: Messages } | null>(null);

  const goToReceipt = (bookingId: string) => {
    forgetIdempotencyKey();
    dispatch({ type: "completed", bookingId });
    router.push(`/bookings/${bookingId}`);
  };

  /** Makes the booking and starts its payment. Says where the checkout goes next. */
  async function book(request: BookingRequestInput, attempt = 1): Promise<Outcome> {
    const key = idempotencyKeyFor(JSON.stringify(request));
    const created = await createBooking(slug, request, key);
    if (!created.ok) return { kind: "refused", notice: bookingRefused(created, request) };

    const booking = created.data;
    if (booking.status === "confirmed") return { kind: "done", bookingId: booking.id };
    if (booking.status !== "pending_payment") {
      // This exact cart was booked before in this tab and its hold has since ended: book again.
      forgetIdempotencyKey();
      return attempt === 1 ? book(request, 2) : { kind: "refused", notice: unexpected };
    }

    const payment = await startPayment(booking.id);
    if (payment.ok) {
      return {
        kind: "paying",
        booking: {
          id: booking.id,
          reference: booking.reference,
          holdExpiresAt: booking.holdExpiresAt,
        },
        clientSecret: payment.data.clientSecret,
        amountCents: payment.data.amountCents,
      };
    }
    if (payment.kind === "network") return { kind: "refused", notice: offline };
    if (payment.kind === "error" && payment.error.code === "BOOKING_NOT_PAYABLE") {
      // Clients switch on codes, never on messages: ask the booking what happened to it.
      const current = await fetchBooking(booking.id);
      if (current.ok && current.data.status === "confirmed") {
        return { kind: "done", bookingId: booking.id };
      }
      forgetIdempotencyKey();
    }
    return {
      kind: "refused",
      notice: {
        tone: "error",
        text: payment.kind === "error" ? payment.error.message : unexpected.text,
      },
    };
  }

  /** What to tell the family when the booking is refused, after putting the form right. */
  function bookingRefused(
    result: Exclude<ApiResult<unknown>, { ok: true }>,
    request: BookingRequestInput,
  ): Notice {
    if (result.kind === "network") return offline;
    if (result.kind !== "error") return unexpected;
    const { code, message, details } = result.error;
    switch (code) {
      case "PRICE_CHANGED":
      case "SOLD_OUT":
      case "PROMO_UNAVAILABLE":
        // Something changed since the price was shown: fetch the new one and ask again.
        requote();
        return { tone: "error", text: message };
      case "BOOKING_INVALID":
      case "INVALID_REQUEST": {
        const draft = toBookingRequest(state, request.expectedTotalCents);
        if (draft.ok && details) {
          setErrors({
            for: state,
            messages: messagesByField(details, {
              attendeeIds: draft.attendeeIds,
              extras: draft.request.extras ?? [],
            }),
          });
        }
        onInvalid();
        return { tone: "error", text: "Please fix the highlighted details, then press Pay again." };
      }
      case "IDEMPOTENCY_KEY_REUSED":
        forgetIdempotencyKey();
        return { tone: "error", text: "Please press Pay again." };
      default:
        return { tone: "error", text: message };
    }
  }

  return {
    state: checkout,
    bookingErrors: errors?.for === state ? errors.messages : NO_MESSAGES,
    async pay(totalCents) {
      if (checkout.phase !== "editing") return;
      const draft = toBookingRequest(state, totalCents);
      if (!draft.ok) return;
      dispatch({ type: "submitted" });
      setErrors(null);
      let outcome: Outcome;
      try {
        outcome = await book(draft.request);
      } catch {
        outcome = { kind: "refused", notice: unexpected };
      }
      switch (outcome.kind) {
        case "refused":
          dispatch({ type: "refused", notice: outcome.notice });
          break;
        case "paying":
          dispatch({ type: "paymentReady", ...outcome });
          break;
        case "done":
          goToReceipt(outcome.bookingId);
          break;
      }
    },
    paid: goToReceipt,
    changeBooking() {
      dispatch({ type: "returnedToForm", notice: null });
    },
    holdEnded() {
      forgetIdempotencyKey();
      dispatch({
        type: "returnedToForm",
        notice: {
          tone: "info",
          text: "Your hold ended, so the tickets went back on sale. Everything you entered is still here: press Pay to book again.",
        },
      });
    },
  };
}
