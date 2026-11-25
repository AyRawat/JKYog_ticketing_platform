import { describe, expect, it } from "vitest";
import { canonicalJson, requestHash } from "./request-hash";

describe("request fingerprint", () => {
  it("ignores key order at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}',
    );
    expect(requestHash("e", { a: 1, b: 2 })).toBe(requestHash("e", { b: 2, a: 1 }));
  });

  it("changes with any value, array order, or the event", () => {
    const base = requestHash("e", { attendees: [1, 2], total: 100 });
    expect(requestHash("e", { attendees: [1, 2], total: 101 })).not.toBe(base);
    expect(requestHash("e", { attendees: [2, 1], total: 100 })).not.toBe(base);
    expect(requestHash("other", { attendees: [1, 2], total: 100 })).not.toBe(base);
  });

  it("is a 64-character hex SHA-256, as the database requires", () => {
    expect(requestHash("e", {})).toMatch(/^[0-9a-f]{64}$/);
  });
});
