import type { QuoteResponse } from "@ticketing/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBooking, fetchBooking, fetchQuote } from "./client";

const quote: QuoteResponse = {
  lines: [],
  subtotalCents: 0,
  discountCents: 0,
  totalCents: 0,
  promo: null,
  issues: [],
  notices: [],
  canBook: false,
};

function respondWith(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("posts the quote as JSON and returns the parsed response", async () => {
    const fetchMock = respondWith(quote);
    const result = await fetchQuote("sharad-utsav-2026", { attendees: [] });

    expect(result).toEqual({ ok: true, status: 200, data: quote });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/events/sharad-utsav-2026/quote");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ attendees: [] }));
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("sends the idempotency key with a booking", async () => {
    const fetchMock = respondWith({ error: { code: "SOLD_OUT", message: "Sold out." } }, 409);
    await createBooking(
      "sharad-utsav-2026",
      {
        booker: { fullName: "A", email: "a@example.com", phone: "2145550100", ageYears: 40 },
        attendees: [],
        expectedTotalCents: 0,
      },
      "6b0f7a5e-3f0c-4a8e-9a7e-0d3f6b1c2a44",
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
      "6b0f7a5e-3f0c-4a8e-9a7e-0d3f6b1c2a44",
    );
  });

  it("returns the server's error code and message", async () => {
    respondWith(
      { error: { code: "PRICE_CHANGED", message: "The total has changed.", details: [] } },
      409,
    );
    expect(await fetchBooking("6b0f7a5e-3f0c-4a8e-9a7e-0d3f6b1c2a44")).toEqual({
      ok: false,
      kind: "error",
      status: 409,
      error: { code: "PRICE_CHANGED", message: "The total has changed.", details: [] },
    });
  });

  it("encodes ids so a crafted value can't change the path", async () => {
    const fetchMock = respondWith({ error: { code: "BOOKING_NOT_FOUND", message: "x" } }, 404);
    await fetchBooking("../events/x");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/bookings/..%2Fevents%2Fx");
  });

  it.each([
    ["a success that isn't the contract", { total: 5 }, 200],
    ["an error that isn't the contract", "<html>Bad gateway</html>", 502],
    ["an unknown error code", { error: { code: "TEAPOT", message: "x" } }, 418],
  ])("reports %s as unexpected", async (_, body, status) => {
    respondWith(body, status);
    expect(await fetchQuote("sharad-utsav-2026", { attendees: [] })).toEqual({
      ok: false,
      kind: "unexpected",
      status,
    });
  });

  it("reports a failed connection as a network problem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    expect(await fetchQuote("sharad-utsav-2026", { attendees: [] })).toEqual({
      ok: false,
      kind: "network",
    });
  });

  it("reports a cancelled request as aborted, not as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Aborted", "AbortError")),
    );
    const controller = new AbortController();
    controller.abort();
    expect(await fetchQuote("sharad-utsav-2026", { attendees: [] }, controller.signal)).toEqual({
      ok: false,
      kind: "aborted",
    });
  });
});
