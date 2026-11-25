import { requireProduct, type RuleContext } from "./context";
import type { Cents } from "./money";
import type { BookingLine, PricedLine } from "./types";

/** Every line prices the same way, from the server's own catalog: unit price x quantity. */
export function priceLines(lines: readonly BookingLine[], ctx: RuleContext): PricedLine[] {
  return lines.map((line) => {
    const product = requireProduct(ctx, line.productCode);
    return {
      ...line,
      productName: product.name,
      unitPriceCents: product.unitPriceCents,
      lineTotalCents: product.unitPriceCents * line.quantity,
    };
  });
}

export function subtotalOf(lines: readonly PricedLine[]): Cents {
  return lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
}
