import {
  BookingResponse,
  ErrorResponse,
  PaymentResponse,
  QuoteResponse,
  type BookingRequestInput,
  type QuoteRequestInput,
} from "@ticketing/contracts";
import type { z } from "zod";

// The browser's side of the API. Every response is parsed with the same contract schemas the
// server uses, so the UI only ever works with data of the shape it expects.

export type ApiError = ErrorResponse["error"];

export type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  /** The server answered with an error body; switch on `error.code`. */
  | {
      readonly ok: false;
      readonly kind: "error";
      readonly status: number;
      readonly error: ApiError;
    }
  /** No answer: offline, DNS, connection dropped. Safe to retry. */
  | { readonly ok: false; readonly kind: "network" }
  /** The request was cancelled by the caller, e.g. a newer quote replaced it. */
  | { readonly ok: false; readonly kind: "aborted" }
  /** An answer that isn't the contract: a proxy error page, or a mismatched deploy. */
  | { readonly ok: false; readonly kind: "unexpected"; readonly status: number };

const eventPath = (slug: string) => `/api/events/${encodeURIComponent(slug)}`;

export function fetchQuote(
  slug: string,
  request: QuoteRequestInput,
  signal?: AbortSignal,
): Promise<ApiResult<QuoteResponse>> {
  return send(`${eventPath(slug)}/quote`, QuoteResponse, { method: "POST", body: request, signal });
}

/** Send the same `idempotencyKey` again for the same checkout: it never makes a second booking. */
export function createBooking(
  slug: string,
  request: BookingRequestInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiResult<BookingResponse>> {
  return send(`${eventPath(slug)}/bookings`, BookingResponse, {
    method: "POST",
    body: request,
    headers: { "Idempotency-Key": idempotencyKey },
    signal,
  });
}

/** Starts the card payment for a held booking, or returns the one already started. */
export function startPayment(
  bookingId: string,
  signal?: AbortSignal,
): Promise<ApiResult<PaymentResponse>> {
  return send(`/api/bookings/${encodeURIComponent(bookingId)}/payment`, PaymentResponse, {
    method: "POST",
    body: {},
    signal,
  });
}

export function fetchBooking(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<BookingResponse>> {
  return send(`/api/bookings/${encodeURIComponent(id)}`, BookingResponse, {
    method: "GET",
    signal,
  });
}

interface SendOptions {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal | undefined;
}

async function send<T>(
  url: string,
  schema: z.ZodType<T>,
  { method, body, headers, signal }: SendOptions,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: signal ?? null,
      cache: "no-store",
    });
  } catch (error) {
    return isAbort(error, signal) ? { ok: false, kind: "aborted" } : { ok: false, kind: "network" };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    if (isAbort(error, signal)) return { ok: false, kind: "aborted" };
    return { ok: false, kind: "unexpected", status: response.status };
  }

  if (response.ok) {
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, status: response.status, data: parsed.data }
      : { ok: false, kind: "unexpected", status: response.status };
  }

  const parsed = ErrorResponse.safeParse(json);
  return parsed.success
    ? { ok: false, kind: "error", status: response.status, error: parsed.data.error }
    : { ok: false, kind: "unexpected", status: response.status };
}

const isAbort = (error: unknown, signal: AbortSignal | undefined) =>
  signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
