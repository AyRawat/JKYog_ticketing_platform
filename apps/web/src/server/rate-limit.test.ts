import type { Database } from "@ticketing/db";
import { describe, expect, it, vi } from "vitest";
import { LIMITS, takeLimit, tooManyRequests, visitorOf } from "./rate-limit";

const request = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });

describe("visitorOf", () => {
  it("uses Vercel's x-real-ip, hashed so no address is kept", () => {
    const visitor = visitorOf(request({ "x-real-ip": "203.0.113.7" }));
    expect(visitor).toMatch(/^[0-9a-f]{24}$/);
    expect(visitor).not.toContain("203");
  });

  it("is the same visitor for the same address, and different for another", () => {
    const a = visitorOf(request({ "x-real-ip": "203.0.113.7" }));
    expect(visitorOf(request({ "x-real-ip": "203.0.113.7" }))).toBe(a);
    expect(visitorOf(request({ "x-real-ip": "198.51.100.4" }))).not.toBe(a);
  });

  it("falls back to the first x-forwarded-for address", () => {
    expect(visitorOf(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      visitorOf(request({ "x-real-ip": "203.0.113.7" })),
    );
  });

  it("is null without an address", () => {
    expect(visitorOf(request({}))).toBeNull();
  });
});

describe("takeLimit", () => {
  it("lets requests through when the limiter's database fails, and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = {
      insertInto: () => {
        throw new Error("relation rate_limit_hits does not exist");
      },
    } as unknown as Database;

    await expect(takeLimit(broken, LIMITS.booking, "visitor", new Date())).resolves.toEqual({
      allowed: true,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("doesn't touch the database for a visitor with no address", async () => {
    const untouchable = {} as unknown as Database;
    await expect(takeLimit(untouchable, LIMITS.quote, null, new Date())).resolves.toEqual({
      allowed: true,
    });
  });
});

describe("tooManyRequests", () => {
  it("is a 429 in the usual error shape, with Retry-After", async () => {
    const response = tooManyRequests(LIMITS.booking, 42);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toEqual({
      error: { code: "RATE_LIMITED", message: LIMITS.booking.message },
    });
  });
});
