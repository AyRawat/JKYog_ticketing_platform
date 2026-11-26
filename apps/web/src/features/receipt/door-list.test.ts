import type { BookingResponse } from "@ticketing/contracts";
import { describe, expect, it } from "vitest";
import { doorList } from "./door-list";

const line = (productCode: string, productName: string, day: string | null) => ({
  productCode,
  productName,
  day,
  quantity: 1,
  unitPriceCents: 100,
  lineTotalCents: 100,
});

const booking: BookingResponse = {
  id: "6b0f7a5e-3f0c-4a8e-9a7e-0d3f6b1c2a44",
  event: { slug: "sharad-utsav-2026", name: "Sharad Utsav 2026" },
  reference: "SU26-7K3QX",
  status: "confirmed",
  holdExpiresAt: "2026-11-25T18:15:00.000Z",
  currency: "USD",
  lines: [
    line("DAY_PASS_ADULT", "Day Pass – Adult", "2026-12-12"),
    line("FAMILY_PASS", "Family Pass", "2026-12-12"),
    line("ALL_DAY_PASS_CHILD", "All-Day Pass – Child", null),
  ],
  subtotalCents: 300,
  discountCents: 0,
  totalCents: 300,
  promoCode: null,
  attendees: [
    { fullName: "Asha", ageYears: 40, productCode: "FAMILY_PASS", days: ["2026-12-12"] },
    {
      fullName: "Kamla",
      ageYears: 68,
      productCode: "DAY_PASS_ADULT",
      days: ["2026-12-13", "2026-12-12"],
    },
    { fullName: "Mira", ageYears: 2, productCode: null, days: [] },
    {
      fullName: "Dev",
      ageYears: 9,
      productCode: "ALL_DAY_PASS_CHILD",
      days: ["2026-12-10", "2026-12-14"],
    },
  ],
};

describe("doorList", () => {
  it("lists who comes in each day, in date order, with their ticket", () => {
    expect(doorList(booking).days).toEqual([
      { day: "2026-12-10", people: [{ fullName: "Dev", ticket: "All-Day Pass – Child" }] },
      {
        day: "2026-12-12",
        people: [
          { fullName: "Asha", ticket: "Family Pass" },
          { fullName: "Kamla", ticket: "Day Pass – Adult" },
        ],
      },
      { day: "2026-12-13", people: [{ fullName: "Kamla", ticket: "Day Pass – Adult" }] },
      { day: "2026-12-14", people: [{ fullName: "Dev", ticket: "All-Day Pass – Child" }] },
    ]);
  });

  it("lists free under-5s apart, with no ticket and no day", () => {
    expect(doorList(booking).freeChildren).toEqual(["Mira"]);
  });

  it("falls back to the code if a ticket's line is missing", () => {
    const odd = { ...booking, lines: [] };
    expect(doorList(odd).days[0]?.people[0]?.ticket).toBe("ALL_DAY_PASS_CHILD");
  });
});
