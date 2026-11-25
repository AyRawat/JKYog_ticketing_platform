import { describe, expect, it } from "vitest";
import { unitsByProduct } from "./stock";
import { adultDayPass, extra, makeCatalog, person, quote } from "./test/fixtures";

describe("stock", () => {
  it("All-Day Pass – Adult is sold out", () => {
    const q = quote({ attendees: [person(30, "ALL_DAY_PASS_ADULT")] });
    expect(q.issues).toEqual([
      {
        code: "SOLD_OUT",
        path: "attendees[0].entry.productCode",
        message: "All-Day Pass – Adult is sold out.",
      },
    ]);
    expect(q.canBook).toBe(false);
  });

  it("only 2 Garba Workshop places are left", () => {
    const three = [1, 2, 3].map(() => adultDayPass(["2026-12-13"]));
    const q = quote({ attendees: three, extras: [extra("GARBA_WORKSHOP", 3, "2026-12-13")] });
    expect(q.issues).toEqual([
      {
        code: "INSUFFICIENT_STOCK",
        path: "extras[0].quantity",
        message: "Only 2 Garba Workshop left, and this booking needs 3.",
      },
    ]);
  });

  it("counts units across days: a day pass for 2 people x 3 days uses 6", () => {
    const days = ["2026-12-10", "2026-12-11", "2026-12-12"];
    const attendees = [adultDayPass(days), adultDayPass(days)];
    expect(unitsByProduct(quote({ attendees }).lines).get("DAY_PASS_ADULT")).toBe(6);

    const catalog = makeCatalog({ remaining: { DAY_PASS_ADULT: 5 } });
    const q = quote({ attendees }, { catalog });
    expect(q.issues.map((i) => i.code)).toEqual(["INSUFFICIENT_STOCK"]);
  });

  it("exactly the remaining stock is fine", () => {
    const catalog = makeCatalog({ remaining: { GARBA_WORKSHOP: 1 } });
    const q = quote(
      {
        attendees: [adultDayPass(["2026-12-11"])],
        extras: [extra("GARBA_WORKSHOP", 1, "2026-12-11")],
      },
      { catalog },
    );
    expect(q.issues).toEqual([]);
  });
});
