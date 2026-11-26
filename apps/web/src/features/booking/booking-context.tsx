"use client";

import type { CatalogResponse } from "@ticketing/contracts";
import { createContext, useContext, type Dispatch } from "react";
import type { Messages } from "./state/messages";
import type { BookingAction } from "./state/reducer";
import type { BookingState } from "./state/types";

export interface BookingContextValue {
  readonly catalog: CatalogResponse;
  readonly state: BookingState;
  readonly dispatch: Dispatch<BookingAction>;
  /** Only the messages that should be on screen right now. */
  readonly messages: Messages;
}

export const BookingContext = createContext<BookingContextValue | null>(null);

/** The booking form's catalog, state and messages, for any part of the form. */
export function useBooking(): BookingContextValue {
  const value = useContext(BookingContext);
  if (!value) throw new Error("useBooking must be used inside the booking form.");
  return value;
}
