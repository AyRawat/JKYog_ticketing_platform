"use client";

import type { CatalogResponse } from "@ticketing/contracts";
import { useMemo, useReducer } from "react";
import { useLiveQuote } from "./api/use-live-quote";
import { useCheckout } from "./checkout/use-checkout";
import { BookingContext, type BookingContextValue } from "./booking-context";
import { BookerSection } from "./sections/booker-section";
import { GroupSection } from "./sections/group-section";
import { MobileTotalBar } from "./sections/mobile-total-bar";
import { OrderSummary } from "./sections/order-summary";
import { PriceList } from "./sections/price-list";
import { VisitDaysSection } from "./sections/visit-days-section";
import { messagesByField } from "./state/issues";
import { localMessages, mergeMessages, visibleMessages } from "./state/messages";
import { createBookingReducer, initialBookingState } from "./state/reducer";

interface BookingFlowProps {
  readonly catalog: CatalogResponse;
}

/**
 * The booking page. Owns the one reducer that holds what the family has entered, asks the
 * server for the price as it changes, and shares both with the sections below.
 */
export function BookingFlow({ catalog }: BookingFlowProps) {
  const reducer = useMemo(() => createBookingReducer(catalog), [catalog]);
  const [state, dispatch] = useReducer(reducer, initialBookingState);
  const live = useLiveQuote(catalog.event.slug, state);

  const local = useMemo(() => localMessages(state, catalog), [state, catalog]);
  const fromServer = useMemo(() => {
    if (!live.latest) return new Map<string, readonly string[]>();
    const { quote, draft } = live.latest;
    // "Add at least one person" is wrong while people are listed but their ages are still
    // being typed (they're left out of the quote); the age fields say what's missing instead.
    const issues = quote.issues.filter(
      (issue) => !(issue.code === "NO_ATTENDEES" && draft.unreadableAgeIds.length > 0),
    );
    return messagesByField(issues, {
      attendeeIds: draft.attendeeIds,
      extras: draft.request.extras ?? [],
    });
  }, [live.latest]);
  const checkout = useCheckout(catalog.event.slug, state, {
    requote: live.retry,
    onInvalid: () => {
      dispatch({ type: "payAttempted" });
    },
  });
  const { bookingErrors } = checkout;
  const messages = useMemo(
    () => visibleMessages(mergeMessages(local, fromServer, bookingErrors), state),
    [local, fromServer, bookingErrors, state],
  );
  // While the booking is being made or paid for, the form can't change under it.
  const locked = checkout.state.phase !== "editing";

  const context = useMemo<BookingContextValue>(
    () => ({ catalog, state, dispatch, messages }),
    [catalog, state, messages],
  );

  return (
    <BookingContext value={context}>
      <PriceList />
      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-10">
        <div
          className={`space-y-12 transition-opacity ${locked ? "opacity-50" : ""}`}
          inert={locked}
        >
          <VisitDaysSection />
          <BookerSection />
          <GroupSection />
        </div>
        <aside id="order" className="scroll-mt-6 lg:sticky lg:top-6">
          <OrderSummary live={live} locallyValid={local.size === 0} checkout={checkout} />
        </aside>
      </div>
      <MobileTotalBar live={live} />
    </BookingContext>
  );
}
