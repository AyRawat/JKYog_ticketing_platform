// One Idempotency-Key per exact booking request. Pressing Pay again for the same cart (a
// double click, a retry after the network dropped, a reload) sends the same key, so the server
// returns the booking it already made instead of holding a second set of tickets. Any change to
// the cart is a new request and gets a new key.
//
// Kept in sessionStorage: per tab, gone when the tab closes. Storage can be unavailable
// (private mode, blocked); then the key lives in memory for this page only.

const STORAGE_KEY = "sharad-utsav:checkout";

interface Stored {
  readonly request: string;
  readonly key: string;
}

let memory: Stored | null = null;

function read(): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return memory;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "request" in parsed &&
      "key" in parsed &&
      typeof parsed.request === "string" &&
      typeof parsed.key === "string"
    ) {
      return { request: parsed.request, key: parsed.key };
    }
  } catch {
    // Unavailable or corrupt: fall back to memory.
  }
  return memory;
}

function write(value: Stored | null) {
  memory = value;
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Memory still has it.
  }
}

/** The key for this exact request: the stored one if the request is unchanged, else a new one. */
export function idempotencyKeyFor(
  request: string,
  newKey: () => string = () => crypto.randomUUID(),
): string {
  const stored = read();
  if (stored?.request === request) return stored.key;
  const key = newKey();
  write({ request, key });
  return key;
}

/** Forget the key: the booking is done, or its hold ended and a new attempt must not reuse it. */
export function forgetIdempotencyKey(): void {
  write(null);
}
