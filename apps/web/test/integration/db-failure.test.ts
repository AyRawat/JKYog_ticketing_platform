import { ErrorResponse } from "@ticketing/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getCatalog } from "@/app/api/events/[slug]/catalog/route";
import { POST as postQuote } from "@/app/api/events/[slug]/quote/route";
import { call } from "./support/http";

// The database is unreachable, and the driver's error carries details a client must never see.
vi.mock("@/server/db", () => ({
  getDb: () => {
    throw new Error("connect ECONNREFUSED 10.0.0.7:5432 user=app password=hunter2");
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([
  ["GET catalog", () => call(getCatalog, "catalog")],
  ["POST quote", () => call(postQuote, "quote", { json: { attendees: [] } })],
])("%s when the database fails", (_, request) => {
  it("returns 500 INTERNAL_ERROR with a generic message and logs the cause", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { status, text, json, response } = await request();

    expect(status).toBe(500);
    expect(ErrorResponse.parse(json)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our side. Please try again.",
      },
    });
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.7|password|hunter2/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(log).toHaveBeenCalledOnce();
  });
});
