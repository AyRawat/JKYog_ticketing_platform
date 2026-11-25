/** Money is always an integer number of cents. Formatting happens only at the edges. */
export type Cents = number;

/** 1005 -> "$10.05" (integer maths, no floating point). */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * `bps` basis points of an amount (1000 bps = 10%), rounded half up to the nearest cent.
 * Integer arithmetic only: 1005 cents at 10% is 100.5, which rounds to 101.
 */
export function percentOfCents(amount: Cents, bps: number): Cents {
  return Math.floor((amount * bps + 5_000) / 10_000);
}
