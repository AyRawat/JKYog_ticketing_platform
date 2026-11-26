import type { QuoteResponse } from "@ticketing/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toQuoteRequest, type QuoteDraft } from "../state/requests";
import type { BookingState } from "../state/types";
import { fetchQuote } from "./client";

/** Wait this long after the last change before asking for a price. */
export const QUOTE_DEBOUNCE_MS = 300;

export interface PricedQuote {
  readonly quote: QuoteResponse;
  /** The request this quote priced, to match its issues to people and extras. */
  readonly draft: QuoteDraft;
}

export interface LiveQuote {
  /** The latest price from the server. Kept on screen while a newer one loads or fails. */
  readonly latest: PricedQuote | null;
  /** True when `latest` is not for the cart as it is now (being typed, or loading). */
  readonly stale: boolean;
  /** Why the current cart has no price: no connection, or the server couldn't answer. */
  readonly problem: "offline" | "failed" | null;
  /** The server's own words for a failure it explained (e.g. too many requests), if any. */
  readonly problemMessage: string | null;
  readonly retry: () => void;
}

/**
 * The server's price for the cart, kept up to date as the family edits it. Only the latest
 * request counts: an older one is cancelled when the cart changes, so a slow answer can never
 * overwrite a newer one. Re-quotes when the connection comes back.
 */
export function useLiveQuote(slug: string, state: BookingState): LiveQuote {
  const online = useOnline();
  const current = useCurrentDraft(state);
  const [latest, setLatest] = useState<(PricedQuote & { key: string }) | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    kind: "offline" | "failed";
    message: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchQuote(slug, current.draft.request, controller.signal).then((result) => {
        if (result.ok) {
          setLatest({ key: current.key, quote: result.data, draft: current.draft });
          setFailure(null);
        } else if (result.kind !== "aborted") {
          setFailure({
            key: current.key,
            kind: result.kind === "network" ? "offline" : "failed",
            message: result.kind === "error" ? result.error.message : null,
          });
        }
      });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, current, online, attempt]);

  const failed = failure?.key === current.key ? failure : null;
  return {
    latest: latest && { quote: latest.quote, draft: latest.draft },
    stale: latest?.key !== current.key,
    problem: online ? (failed?.kind ?? null) : "offline",
    problemMessage: online ? (failed?.message ?? null) : null,
    retry: () => {
      setFailure(null);
      setAttempt((n) => n + 1);
    },
  };
}

/**
 * The quote request for the cart, as a value that only changes when the request does: typing
 * a name or moving between steps changes the state but not what gets priced.
 */
function useCurrentDraft(state: BookingState): { key: string; draft: QuoteDraft } {
  const draft = toQuoteRequest(state);
  const key = JSON.stringify(draft);
  const [current, setCurrent] = useState({ key, draft });
  // Adjusting state while rendering (not in an effect) is React's pattern for this.
  if (current.key !== key) setCurrent({ key, draft });
  return current.key === key ? current : { key, draft };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    () => true,
  );
}

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
