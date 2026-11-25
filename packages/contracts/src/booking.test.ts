import { describe, expect, it } from "vitest";
import {
  BookingRequest,
  BookingResponse,
  Email,
  IdempotencyKey,
  PersonName,
  Phone,
} from "./booking";
import { fieldErrors } from "./common";

const valid = {
  booker: {
    fullName: "Asha Patel",
    email: "asha@example.com",
    phone: "+1 214-555-0100",
    ageYears: 40,
  },
  attendees: [
    {
      fullName: "Asha Patel",
      ageYears: 40,
      entry: { productCode: "DAY_PASS_ADULT", days: ["2026-12-12"] },
    },
    { fullName: "Mira Patel", ageYears: 3, entry: null },
  ],
  expectedTotalCents: 1500,
};

const pathsFor = (body: unknown) => {
  const result = BookingRequest.safeParse(body);
  if (result.success) throw new Error("expected the request to be rejected");
  return fieldErrors(result.error).map((e) => e.path);
};

describe("BookingRequest", () => {
  it("accepts a booking and fills the defaults", () => {
    const parsed = BookingRequest.parse(valid);
    expect(parsed.extras).toEqual([]);
    expect(parsed.promoCode).toBeNull();
    expect(parsed.attendees.map((a) => a.phone)).toEqual([null, null]);
  });

  it("trims names and phone numbers", () => {
    const parsed = BookingRequest.parse({
      ...valid,
      booker: { ...valid.booker, fullName: "  Asha Patel ", phone: " 214 555 0100 " },
    });
    expect(parsed.booker.fullName).toBe("Asha Patel");
    expect(parsed.booker.phone).toBe("214 555 0100");
  });

  it.each([
    ["the booker", { ...valid, booker: undefined }, "booker"],
    ["the expected total", { ...valid, expectedTotalCents: undefined }, "expectedTotalCents"],
    [
      "the booker's email",
      { ...valid, booker: { ...valid.booker, email: undefined } },
      "booker.email",
    ],
    [
      "an attendee's name",
      { ...valid, attendees: [{ ageYears: 40, entry: null }] },
      "attendees[0].fullName",
    ],
  ])("requires %s", (_, body, path) => {
    expect(pathsFor(body)).toContain(path);
  });

  it.each([
    ["a total", { ...valid, totalCents: 0 }, "totalCents"],
    ["a status", { ...valid, status: "confirmed" }, "status"],
    ["a booking id", { ...valid, id: "8b1c6c1e-6d0c-4b41-9b7a-2f8d5d6e2a11" }, "id"],
    [
      "a line price",
      { ...valid, extras: [{ productCode: "DANDIYA_STICKS", quantity: 1, unitPriceCents: 0 }] },
      "extras[0].unitPriceCents",
    ],
  ])("rejects %s sent by the client", (_, body, path) => {
    expect(pathsFor(body)).toEqual([path]);
  });

  it("rejects a fractional or negative expected total", () => {
    expect(pathsFor({ ...valid, expectedTotalCents: 15.5 })).toEqual(["expectedTotalCents"]);
    expect(pathsFor({ ...valid, expectedTotalCents: -1 })).toEqual(["expectedTotalCents"]);
  });
});

describe("PersonName", () => {
  it.each(["Asha", "José Núñez-García", "O'Brien", "李小龍", "Anne-Marie d'Souza Jr."])(
    "accepts %j",
    (name) => {
      expect(PersonName.safeParse(name).success).toBe(true);
    },
  );

  it.each(["", "   ", "a".repeat(101), "Asha\u0000", "Asha\nPatel", "\u0007bell"])(
    "rejects %j",
    (name) => {
      expect(PersonName.safeParse(name).success).toBe(false);
    },
  );
});

describe("Email", () => {
  it.each(["asha@example.com", "a.b+tickets@temple.org"])("accepts %j", (email) => {
    expect(Email.safeParse(email).success).toBe(true);
  });

  it.each(["", "asha", "asha@", "@example.com", "asha@example", `${"a".repeat(250)}@x.com`])(
    "rejects %j",
    (email) => {
      expect(Email.safeParse(email).success).toBe(false);
    },
  );
});

describe("Phone", () => {
  it.each(["2145550100", "+1 (214) 555-0100", "214.555.0100", "+91 98765 43210"])(
    "accepts %j",
    (phone) => {
      expect(Phone.safeParse(phone).success).toBe(true);
    },
  );

  it.each(["", "555-01", "call me", "+1 214 555 0100 ext 5", "1234567890123456", "+-------"])(
    "rejects %j",
    (phone) => {
      expect(Phone.safeParse(phone).success).toBe(false);
    },
  );
});

describe("IdempotencyKey", () => {
  it("accepts a UUID", () => {
    expect(IdempotencyKey.safeParse("8b1c6c1e-6d0c-4b41-9b7a-2f8d5d6e2a11").success).toBe(true);
  });

  it.each([null, "", "abc", "8b1c6c1e6d0c4b419b7a2f8d5d6e2a11", "' OR 1=1 --"])(
    "rejects %j",
    (key) => {
      expect(IdempotencyKey.safeParse(key).success).toBe(false);
    },
  );
});

describe("field errors", () => {
  it("lists each bad field once, with its first problem", () => {
    const result = BookingRequest.safeParse({
      ...valid,
      booker: { ...valid.booker, phone: "12" },
      attendees: [{ fullName: " ", ageYears: 40, entry: null }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrors(result.error)).toEqual([
      { path: "booker.phone", message: "Please enter a valid phone number." },
      { path: "attendees[0].fullName", message: "Please enter a name." },
    ]);
  });
});

describe("BookingResponse", () => {
  const response = {
    id: "8b1c6c1e-6d0c-4b41-9b7a-2f8d5d6e2a11",
    event: { slug: "sharad-utsav-2026", name: "Sharad Utsav 2026" },
    reference: "SU26-ZAVQ5Q",
    status: "pending_payment",
    holdExpiresAt: "2026-11-25T18:15:00.000Z",
    currency: "USD",
    lines: [],
    subtotalCents: 0,
    discountCents: 0,
    totalCents: 0,
    promoCode: null,
    attendees: [{ fullName: "Asha Patel", ageYears: 40, productCode: null, days: [] }],
  };

  it("drops contact details and internal fields even if they reach it", () => {
    const leaky = {
      ...response,
      contactEmail: "asha@example.com",
      contactPhone: "214 555 0100",
      idempotencyKey: "x",
      stripePaymentIntentId: "pi_123",
      attendees: [{ ...response.attendees[0], phone: "214 555 0100", id: "uuid" }],
    };
    expect(BookingResponse.parse(leaky)).toEqual(response);
  });

  it("only allows the four statuses", () => {
    expect(BookingResponse.safeParse({ ...response, status: "paid" }).success).toBe(false);
  });
});
