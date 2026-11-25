import { describe, expect, it } from "vitest";
import { fieldErrors, formatPath } from "./common";
import { QUOTE_LIMITS, QuoteRequest, QuoteResponse } from "./quote";

const adult = { ageYears: 35, entry: { productCode: "DAY_PASS_ADULT", days: ["2026-12-12"] } };

/** The field errors a request would get back in its 400. */
function errorsFor(body: unknown) {
  const result = QuoteRequest.safeParse(body);
  if (result.success) throw new Error("expected the request to be rejected");
  return fieldErrors(result.error);
}

describe("QuoteRequest: a valid cart", () => {
  it("only `attendees` is required; everything else has a default", () => {
    expect(QuoteRequest.parse({ attendees: [adult] })).toEqual({
      booker: null,
      attendees: [adult],
      extras: [],
      promoCode: null,
    });
  });

  it("whole-event passes may leave out `days`, whole-event extras may leave out `day`", () => {
    const parsed = QuoteRequest.parse({
      attendees: [{ ageYears: 8, entry: { productCode: "ALL_DAY_PASS_CHILD" } }],
      extras: [{ productCode: "DANDIYA_STICKS", quantity: 2 }],
    });
    expect(parsed.attendees[0]?.entry?.days).toEqual([]);
    expect(parsed.extras[0]?.day).toBeNull();
  });

  it("an under-5 has no ticket", () => {
    expect(QuoteRequest.parse({ attendees: [{ ageYears: 2, entry: null }] }).attendees).toEqual([
      { ageYears: 2, entry: null },
    ]);
  });

  it("leaves booking rules to the server: age 150, quantity 0 and unknown codes are well-formed", () => {
    const body = {
      booker: { ageYears: 150 },
      attendees: [{ ageYears: -1, entry: { productCode: "NO_SUCH_TICKET", days: [] } }],
      extras: [{ productCode: "DINNER_PLATE", day: "2026-12-12", quantity: 0 }],
      promoCode: "anything",
    };
    expect(QuoteRequest.safeParse(body).success).toBe(true);
  });
});

describe("QuoteRequest: the client can't send prices or anything else unexpected", () => {
  it.each([
    ["a total", { attendees: [adult], totalCents: 0 }, "totalCents"],
    ["a discount", { attendees: [adult], discountCents: 9_999 }, "discountCents"],
    [
      "a price on a ticket",
      { attendees: [{ ...adult, entry: { ...adult.entry, unitPriceCents: 1 } }] },
      "attendees[0].entry.unitPriceCents",
    ],
    [
      "a price on an extra",
      { attendees: [adult], extras: [{ productCode: "DANDIYA_STICKS", quantity: 1, price: 0 }] },
      "extras[0].price",
    ],
    ["a name on an attendee", { attendees: [{ ...adult, name: "Asha" }] }, "attendees[0].name"],
    ["a prototype key", JSON.parse('{"attendees":[],"__proto__":{"x":1}}') as unknown, "__proto__"],
  ])("rejects %s", (_, body, path) => {
    expect(errorsFor(body)).toContainEqual({ path, message: "This field is not allowed." });
  });
});

describe("QuoteRequest: types", () => {
  it.each([
    ["a missing attendees list", {}, "attendees"],
    ["an age sent as text", { attendees: [{ ...adult, ageYears: "35" }] }, "attendees[0].ageYears"],
    ["a fractional age", { attendees: [{ ...adult, ageYears: 35.5 }] }, "attendees[0].ageYears"],
    [
      "a fractional quantity",
      { attendees: [adult], extras: [{ productCode: "DANDIYA_STICKS", quantity: 1.5 }] },
      "extras[0].quantity",
    ],
    [
      "a date that doesn't exist",
      { attendees: [{ ...adult, entry: { ...adult.entry, days: ["2026-02-30"] } }] },
      "attendees[0].entry.days[0]",
    ],
    [
      "a US-style date",
      { attendees: [{ ...adult, entry: { ...adult.entry, days: ["12/12/2026"] } }] },
      "attendees[0].entry.days[0]",
    ],
    ["a missing entry", { attendees: [{ ageYears: 35 }] }, "attendees[0].entry"],
    [
      "an empty product code",
      { attendees: [{ ...adult, entry: { productCode: "" } }] },
      "attendees[0].entry.productCode",
    ],
    ["a numeric promo code", { attendees: [adult], promoCode: 10 }, "promoCode"],
  ])("rejects %s, pointing at the field", (_, body, path) => {
    expect(errorsFor(body).map((e) => e.path)).toEqual([path]);
  });

  it("reports every bad field at once", () => {
    const paths = errorsFor({
      attendees: [{ ageYears: "x", entry: null }],
      extras: [{ productCode: 7, quantity: "2" }],
      promoCode: false,
    }).map((e) => e.path);
    expect(paths).toEqual([
      "attendees[0].ageYears",
      "extras[0].productCode",
      "extras[0].quantity",
      "promoCode",
    ]);
  });

  it("rejects a body that isn't an object", () => {
    for (const body of [null, [], "cart", 42]) {
      expect(QuoteRequest.safeParse(body).success).toBe(false);
    }
  });
});

describe("QuoteRequest: size limits", () => {
  it(`allows ${QUOTE_LIMITS.attendees} attendees, not one more`, () => {
    const at = (n: number) => ({ attendees: Array.from({ length: n }, () => adult) });
    expect(QuoteRequest.safeParse(at(QUOTE_LIMITS.attendees)).success).toBe(true);
    expect(errorsFor(at(QUOTE_LIMITS.attendees + 1)).map((e) => e.path)).toEqual(["attendees"]);
  });

  it(`allows ${QUOTE_LIMITS.extras} extra rows, not one more`, () => {
    const at = (n: number) => ({
      attendees: [adult],
      extras: Array.from({ length: n }, () => ({ productCode: "DANDIYA_STICKS", quantity: 1 })),
    });
    expect(QuoteRequest.safeParse(at(QUOTE_LIMITS.extras)).success).toBe(true);
    expect(QuoteRequest.safeParse(at(QUOTE_LIMITS.extras + 1)).success).toBe(false);
  });

  it("limits days per ticket, code lengths and promo code length", () => {
    const days = Array.from({ length: QUOTE_LIMITS.daysPerEntry + 1 }, () => "2026-12-12");
    expect(errorsFor({ attendees: [{ ...adult, entry: { ...adult.entry, days } }] })[0]?.path).toBe(
      "attendees[0].entry.days",
    );
    expect(
      errorsFor({ attendees: [{ ...adult, entry: { productCode: "X".repeat(65) } }] })[0]?.path,
    ).toBe("attendees[0].entry.productCode");
    expect(errorsFor({ attendees: [adult], promoCode: "S".repeat(33) })[0]?.path).toBe("promoCode");
  });
});

describe("QuoteResponse", () => {
  it("drops the door list and anything else internal", () => {
    const response = {
      lines: [
        {
          productCode: "DAY_PASS_ADULT",
          productName: "Day Pass – Adult",
          day: "2026-12-12",
          quantity: 1,
          unitPriceCents: 1500,
          lineTotalCents: 1500,
        },
      ],
      subtotalCents: 1500,
      discountCents: 0,
      totalCents: 1500,
      promo: null,
      issues: [],
      notices: [],
      canBook: true,
    };
    const withInternals = {
      ...response,
      admissions: [{ attendeeIndex: 0, day: "2026-12-12" }],
      promoId: "uuid",
    };
    expect(QuoteResponse.parse(withInternals)).toEqual(response);
  });

  it("only allows known issue codes and promo reasons", () => {
    const base = {
      lines: [],
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
      notices: [],
      canBook: false,
    };
    const issue = { code: "SOMETHING_ELSE", path: "", message: "" };
    expect(QuoteResponse.safeParse({ ...base, promo: null, issues: [issue] }).success).toBe(false);
    const promo = { status: "rejected", code: "X", reason: "PROMO_BAD", message: "" };
    expect(QuoteResponse.safeParse({ ...base, promo, issues: [] }).success).toBe(false);
  });
});

describe("formatPath", () => {
  it.each([
    [[], ""],
    [["promoCode"], "promoCode"],
    [["attendees", 1, "entry", "days", 0], "attendees[1].entry.days[0]"],
  ] as const)("%j -> %j", (path, expected) => {
    expect(formatPath(path)).toBe(expected);
  });
});
