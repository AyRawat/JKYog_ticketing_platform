import { describe, expect, it } from "vitest";
import {
  checkoutReducer,
  initialCheckout,
  type CheckoutAction,
  type CheckoutState,
} from "./checkout-state";

const booking = { id: "b1", reference: "SU26-7K3QX", holdExpiresAt: "2026-11-25T18:15:00.000Z" };
const ready: CheckoutAction = {
  type: "paymentReady",
  booking,
  clientSecret: "pi_1_secret_x",
  amountCents: 1350,
};
const run = (...actions: CheckoutAction[]): CheckoutState =>
  actions.reduce(checkoutReducer, initialCheckout);

describe("checkoutReducer", () => {
  it("goes editing → submitting → paying → done", () => {
    expect(run({ type: "submitted" }).phase).toBe("submitting");
    expect(run({ type: "submitted" }, ready)).toEqual({
      phase: "paying",
      booking,
      clientSecret: "pi_1_secret_x",
      amountCents: 1350,
    });
    expect(run({ type: "submitted" }, ready, { type: "completed", bookingId: "b1" })).toEqual({
      phase: "done",
      bookingId: "b1",
    });
  });

  it("ignores a second press while a booking is being made", () => {
    const submitting = run({ type: "submitted" });
    expect(checkoutReducer(submitting, { type: "submitted" })).toBe(submitting);
  });

  it("returns to the form with the reason when the server refuses", () => {
    const notice = { tone: "error" as const, text: "The total is now $15.00." };
    expect(run({ type: "submitted" }, { type: "refused", notice })).toEqual({
      phase: "editing",
      notice,
    });
  });

  it("goes straight to done for a free booking", () => {
    expect(run({ type: "submitted" }, { type: "completed", bookingId: "b1" }).phase).toBe("done");
  });

  it("lets the family go back and change the booking while paying", () => {
    const notice = { tone: "info" as const, text: "Hold ended." };
    expect(run({ type: "submitted" }, ready, { type: "returnedToForm", notice })).toEqual({
      phase: "editing",
      notice,
    });
  });

  it("ignores events that don't belong to the current phase", () => {
    expect(run(ready)).toBe(initialCheckout);
    expect(run({ type: "refused", notice: { tone: "error", text: "x" } })).toBe(initialCheckout);
    expect(run({ type: "returnedToForm", notice: null })).toBe(initialCheckout);
  });
});
