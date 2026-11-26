import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetIdempotencyKey, idempotencyKeyFor } from "./idempotency";

function fakeSessionStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  return data;
}

let counter = 0;
const nextKey = () => `key-${String(++counter)}`;

afterEach(() => {
  forgetIdempotencyKey();
  vi.unstubAllGlobals();
});

describe("idempotencyKeyFor", () => {
  it("gives the same key for the same request, so retries make one booking", () => {
    fakeSessionStorage();
    const first = idempotencyKeyFor('{"cart":1}', nextKey);
    expect(idempotencyKeyFor('{"cart":1}', nextKey)).toBe(first);
  });

  it("gives a new key once the request changes", () => {
    fakeSessionStorage();
    const first = idempotencyKeyFor('{"cart":1}', nextKey);
    expect(idempotencyKeyFor('{"cart":2}', nextKey)).not.toBe(first);
  });

  it("survives a reload through sessionStorage", () => {
    const data = fakeSessionStorage();
    const first = idempotencyKeyFor('{"cart":1}', nextKey);
    expect(JSON.parse(data.get("sharad-utsav:checkout") ?? "{}")).toEqual({
      request: '{"cart":1}',
      key: first,
    });
  });

  it("starts fresh once forgotten", () => {
    fakeSessionStorage();
    const first = idempotencyKeyFor('{"cart":1}', nextKey);
    forgetIdempotencyKey();
    expect(idempotencyKeyFor('{"cart":1}', nextKey)).not.toBe(first);
  });

  it("still works in memory when storage throws (private mode)", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const first = idempotencyKeyFor('{"cart":1}', nextKey);
    expect(idempotencyKeyFor('{"cart":1}', nextKey)).toBe(first);
  });
});
