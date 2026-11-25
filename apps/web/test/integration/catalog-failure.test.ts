import { ErrorResponse } from "@ticketing/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/events/[slug]/catalog/route";

// The database is unreachable, and the driver's error carries details a client must never see.
vi.mock("@/server/db", () => ({
  getDb: () => {
    throw new Error("connect ECONNREFUSED 10.0.0.7:5432 user=app password=hunter2");
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/events/:slug/catalog when the database fails", () => {
  it("returns 500 INTERNAL_ERROR with a generic message and logs the cause", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const slug = "sharad-utsav-2026";

    const response = await GET(new Request(`http://localhost/api/events/${slug}/catalog`), {
      params: Promise.resolve({ slug }),
    });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(ErrorResponse.parse(JSON.parse(text))).toEqual({
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
