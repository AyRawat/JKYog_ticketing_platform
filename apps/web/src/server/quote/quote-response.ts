import "server-only";
import type { QuoteResponse } from "@ticketing/contracts";
import type { Quote } from "@ticketing/domain";

/** The public view of a quote. The door list (`admissions`) stays on the server. */
export function toQuoteResponse(quote: Quote): QuoteResponse {
  return {
    lines: quote.lines.map((line) => ({ ...line })),
    subtotalCents: quote.subtotalCents,
    discountCents: quote.discountCents,
    totalCents: quote.totalCents,
    promo: quote.promo ? { ...quote.promo } : null,
    issues: quote.issues.map((issue) => ({ ...issue })),
    notices: quote.notices.map((notice) => ({ ...notice })),
    canBook: quote.canBook,
  };
}
