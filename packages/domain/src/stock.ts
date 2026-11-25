import { requireProduct, type RuleContext } from "./context";
import { issue, type Issue } from "./issues";
import type { BookingLine } from "./types";

/** Units of each product a set of lines would consume (a Day Pass for 2 people x 3 days = 6). */
export function unitsByProduct(lines: readonly BookingLine[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const { productCode, quantity } of lines) {
    units.set(productCode, (units.get(productCode) ?? 0) + quantity);
  }
  return units;
}

/**
 * Early warning against the stock the catalog last saw. The database's guarded decrement is
 * what actually prevents overselling; this just lets the family know before they pay.
 */
export function checkStock(
  lines: readonly BookingLine[],
  ctx: RuleContext,
  pathFor: (productCode: string) => string,
): Issue[] {
  const issues: Issue[] = [];
  for (const [code, units] of unitsByProduct(lines)) {
    const product = requireProduct(ctx, code);
    if (units <= product.remaining) continue;
    issues.push(
      product.remaining === 0
        ? issue("SOLD_OUT", pathFor(code), `${product.name} is sold out.`)
        : issue(
            "INSUFFICIENT_STOCK",
            pathFor(code),
            `Only ${product.remaining} ${product.name} left, and this booking needs ${units}.`,
          ),
    );
  }
  return issues;
}
