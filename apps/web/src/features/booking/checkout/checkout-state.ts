// The checkout as a small state machine, apart from the cart: what the family has chosen lives
// in the booking reducer; this only tracks where they are in paying for it.
//
//   editing ──pay──▶ submitting ──booking + payment ready──▶ paying ──paid──▶ done
//      ▲                 │                                      │
//      └──── refused ────┘◀──────── change booking / hold ended ┘

export interface Notice {
  readonly tone: "error" | "info";
  readonly text: string;
}

export interface HeldBooking {
  readonly id: string;
  readonly reference: string;
  readonly holdExpiresAt: string;
}

export type CheckoutState =
  | { readonly phase: "editing"; readonly notice: Notice | null }
  | { readonly phase: "submitting" }
  | {
      readonly phase: "paying";
      readonly booking: HeldBooking;
      readonly clientSecret: string;
      readonly amountCents: number;
    }
  /** Paid (or free): on the way to the receipt. */
  | { readonly phase: "done"; readonly bookingId: string };

export type CheckoutAction =
  | { readonly type: "submitted" }
  | { readonly type: "refused"; readonly notice: Notice }
  | {
      readonly type: "paymentReady";
      readonly booking: HeldBooking;
      readonly clientSecret: string;
      readonly amountCents: number;
    }
  | { readonly type: "completed"; readonly bookingId: string }
  /** Back to the form: the family chose to change something, or the hold ran out. */
  | { readonly type: "returnedToForm"; readonly notice: Notice | null };

export const initialCheckout: CheckoutState = { phase: "editing", notice: null };

export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case "submitted":
      // One booking attempt at a time: a second press while one is in flight does nothing.
      return state.phase === "editing" ? { phase: "submitting" } : state;
    case "refused":
      return state.phase === "submitting" ? { phase: "editing", notice: action.notice } : state;
    case "paymentReady":
      return state.phase === "submitting"
        ? {
            phase: "paying",
            booking: action.booking,
            clientSecret: action.clientSecret,
            amountCents: action.amountCents,
          }
        : state;
    case "completed":
      return state.phase === "done" ? state : { phase: "done", bookingId: action.bookingId };
    case "returnedToForm":
      return state.phase === "paying" || state.phase === "submitting"
        ? { phase: "editing", notice: action.notice }
        : state;
  }
}
