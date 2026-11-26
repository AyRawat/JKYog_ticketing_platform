# Test cases

The situations I thought were worth checking, and what the app does in each.

**How each one is checked**

- **Unit**: Vitest, in `packages/domain` (rules and pricing) and `apps/web/src` (form state).
- **Integration**: Vitest against a real Postgres test database, calling the route handlers (`apps/web/test/integration`).
- **Manual**: checked by hand in the browser, locally and on the live site.

The festival runs **Thu 10 Dec – Mon 14 Dec 2026** (the brief's November dates had already passed; see DESIGN.md). Ages are counted on 10 Dec.

---

## 1. Ages

| Case                                                 | What happens                                                                                                                                                                     | Checked by                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Age typed as `abc`, `-3`, `4.5`, `200` or left blank | "Please enter an age as a whole number, like 34 (0 for a baby)." The person is left out of the price until it's fixed. The server refuses the same values.                       | Unit, Integration         |
| A 4-year-old                                         | Free, no ticket and no line on the bill. Listed on the receipt as "free with their family", so the door team expects them.                                                       | Unit, Manual              |
| A booking with only under-5s                         | Refused: someone has to hold a ticket.                                                                                                                                           | Unit                      |
| A 7-year-old put on an adult ticket                  | Adult tickets are disabled for them in the form, showing the ages each one is for. If the request is edited by hand, the server refuses it and says which ticket is needed.      | Unit, Integration, Manual |
| Age changed after a ticket was chosen (35 → 9)       | The ticket follows the age once the field is left: Adult Day Pass becomes Child Day Pass on the same days. Typing "35" never passes through "3" and loses the ticket on the way. | Unit, Manual              |
| Age changed to under 5                               | The ticket and their extras are removed; they come free.                                                                                                                         | Unit                      |
| A child turns 12 during the festival                 | Their age on 10 Dec decides the band for the whole festival, so the price doesn't change mid-week.                                                                               | Unit                      |
| Booker aged 17                                       | Can't book, even for themselves: "The person booking must be 18 or over, as they are the one paying."                                                                            | Unit, Integration         |
| Booker isn't coming (a grandparent paying)           | "Booking for someone else?" switch. They get no ticket, and their details are kept for contact only. Turning it back off restores their card as it was.                          | Unit, Manual              |
| Someone edits the request to lie about an age        | Can't be detected (there's no ID check, by decision). The server still prices from the age it receives, so a lie only changes the band, never the price of a given band.         | n/a                       |

## 2. Tickets and days

| Case                                                 | What happens                                                                                                             | Checked by                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| A ticket chosen but no days picked                   | That person's extras stay disabled ("Pick your days first.") and "Add another person" is disabled until they have a day. | Manual                    |
| A Family Pass with no days picked                    | The family's places stay disabled until a day is picked ("Pick the family's days first.").                               | Manual                    |
| Day Pass with no days                                | "Please pick at least one day." The server refuses it too.                                                               | Unit                      |
| The same day sent twice (edited request)             | Refused.                                                                                                                 | Unit                      |
| Days sent out of order                               | Accepted, billed in date order.                                                                                          | Unit                      |
| All-Day Pass with days sent anyway                   | Refused: an all-day pass takes no days.                                                                                  | Unit                      |
| All-Day Pass – Adult (sold out)                      | Shown as sold out in the price list and disabled in every card. The server refuses it.                                   | Unit, Integration, Manual |
| An unknown ticket code, or an extra sent as a ticket | Refused at that person's ticket field.                                                                                   | Unit, Integration         |
| One person admitted twice on the same day            | Refused.                                                                                                                 | Unit                      |
| During the festival (e.g. on 12 Dec)                 | Past days can't be picked; all-day passes stop selling once the festival starts.                                         | Unit, Integration         |
| The date at midnight                                 | Dates use Allen's timezone, not UTC: 11 pm on 9 Dec in Allen is still before the festival.                               | Unit                      |

## 3. Family Pass

| Case                                                               | What happens                                                                                              | Checked by        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------- |
| Family Pass chosen in someone's card                               | That card becomes one family card with 2 adult and 2 child places, days chosen once for the whole family. | Unit, Manual      |
| An age that doesn't fit its place (a 30-year-old in a child place) | "This place is for a child, ages 5–11."                                                                   | Unit, Manual      |
| A 3-year-old in a child place                                      | Told under-5s come free and should be added with "Add a person" instead.                                  | Unit, Manual      |
| 2 adults + 1 child on a Family Pass (edited request)               | Refused, saying what the family has on that day.                                                          | Unit              |
| 4 adults + 4 children on one day                                   | Two Family Passes, $80.                                                                                   | Unit              |
| A family member wants another day too                              | "Add them on a separate ticket" adds them again with their own Day Pass (name and age filled in).         | Manual            |
| "Switch to separate tickets"                                       | Back to one card each: names and ages stay, tickets are cleared, empty places go.                         | Unit, Manual      |
| 2 adults + 2 children on Day Passes for one day                    | A notice says a Family Pass would save $6. Advice only: the cart and total don't change.                  | Unit, Integration |
| A child on Day Passes for 4 or 5 days                              | A notice suggests the All-Day Child pass ($30 vs $32 / $40). No notice at 3 days ($24).                   | Unit              |

## 4. Extras

| Case                                                     | What happens                                                                                                               | Checked by        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Dinner for someone on a day they have no ticket          | Can't be picked: dinner chips only show that person's days. The server refuses plates beyond the ticketed people that day. | Unit, Manual      |
| Dinner and under-5s                                      | Under-5s have no extras and don't count toward the plate limit.                                                            | Unit              |
| Garba Workshop on 12 Dec                                 | Not offered; it runs on 11 and 13 Dec only. Refused by the server.                                                         | Unit              |
| Garba: 2 places left, 3 wanted                           | Reported with what's left; the booking can't be made.                                                                      | Unit, Integration |
| 8 families booking the last 2 Garba places at once       | Exactly 2 bookings succeed; stock never goes below zero.                                                                   | Integration       |
| Dandiya: 20 pairs / 21 pairs                             | 20 is fine; 21 is refused (max 20 per booking). The stepper stops at 20 across the whole group.                            | Unit, Manual      |
| The same extra listed twice for one day (edited request) | Refused, not merged.                                                                                                       | Unit              |

## 5. Promo codes

| Code                                      | What happens                                                                                                                                          | Checked by        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `SEVA10`                                  | 10% off the whole booking, extras included, rounded half up to the cent.                                                                              | Unit, Integration |
| `FLAT20`                                  | $20 off; on a booking under $20 the total stops at $0.                                                                                                | Unit, Integration |
| `KIDSFREE`                                | Child Day and All-Day Child passes free. The Family Pass and extras are not discounted. Example: Family Pass + 3 Child Day + 1 Adult Day = $79 → $55. | Unit, Integration |
| `EXPIRED5`                                | "This code expired on 30 Oct." Nothing taken off.                                                                                                     | Unit, Integration |
| `MAXEDOUT`                                | "This code has reached its usage limit."                                                                                                              | Unit              |
| A made-up code                            | "We don't recognise that code. Please check the spelling." A refused code blocks Pay, so nobody is charged without the discount they expected.        | Unit              |
| An empty code                             | Treated as no code.                                                                                                                                   | Integration       |
| `KIDSFREE` with no child tickets          | "This code makes child tickets free, but there are none in this booking."                                                                             | Unit              |
| Lowercase or spaces (`seva10 `)           | Accepted.                                                                                                                                             | Unit              |
| Two families racing for a code's last use | Exactly one gets the discount; the other is told the code is no longer available.                                                                     | Integration       |
| Guessing codes one after another          | After 10 codes that don't exist in 10 minutes, any quote with a code is refused for a while. Quotes without a code still work.                        | Integration       |
| A child-only booking with KIDSFREE ($0)   | Confirmed straight away, with no payment step.                                                                                                        | Unit, Integration |

## 6. Price and trust

| Case                                           | What happens                                                                                                     | Checked by          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- |
| The browser sends a price, a total or a status | Refused (400): the server decides prices.                                                                        | Integration         |
| A price changes between the quote and Pay      | 409, and the form re-prices and asks the family to confirm the new total. Never charges a total they didn't see. | Integration, Manual |
| Booking charge vs quote                        | The booking always charges exactly what the quote showed for the same cart.                                      | Integration         |
| Payment amount vs booking                      | Stripe is asked for the booking's stored total, never a number from the browser.                                 | Integration         |
| Totals like $146.70000000000002                | Not possible: all money is integer cents.                                                                        | Unit                |
| A ticket renamed by an admin                   | No rule depends on names or labels; only the label changes.                                                      | Unit, Integration   |
| Prices or stock changed in the database        | Shown on the next page load or quote.                                                                            | Integration         |
| Catalog responses                              | No database ids, stock counts or promo codes in them.                                                            | Integration         |

## 7. Booking, holds and payment

| Case                                                          | What happens                                                                                                                  | Checked by          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Pay pressed twice, or five times at once                      | One booking. Each submit carries an idempotency key, and the button is disabled while it works.                               | Integration, Manual |
| The same key with a different cart                            | Refused (409); nothing changes.                                                                                               | Integration         |
| Tickets are held while paying                                 | 15 minutes, with a countdown. Stock and the code use are taken when the booking is made.                                      | Integration, Manual |
| The hold runs out without payment                             | The booking expires and gives its stock and code use back. The next family can book them.                                     | Integration         |
| Many requests notice the same expiry                          | Released exactly once.                                                                                                        | Integration         |
| "Change booking" during payment                               | Back to the form with everything as it was.                                                                                   | Manual              |
| Card declined (4000 0000 0000 0002)                           | Stripe's message is shown; the booking stays held so they can try another card.                                               | Integration, Manual |
| Card 4242 4242 4242 4242                                      | Confirmed by the Stripe webhook; the receipt page switches from "Confirming your payment…" to "You're booked!".               | Integration, Manual |
| Payment arrives just after the hold ended                     | Confirmed if the tickets are still there (taken again). If they've gone, the money is refunded and the booking stays expired. | Integration         |
| The same webhook delivered twice, or at the same time         | Applied once.                                                                                                                 | Integration         |
| A webhook with a changed body or bad signature                | Refused (400).                                                                                                                | Integration         |
| Paid amount or currency doesn't match the booking             | Not confirmed.                                                                                                                | Integration         |
| Stripe is down when payment starts                            | "Your tickets are still held", and nothing is saved.                                                                          | Integration         |
| A booking id that doesn't exist, or a reference used as an id | 404. References are for the door, not for lookups.                                                                            | Integration         |
| Receipt contents                                              | No booker email or phone on the receipt or in the booking API.                                                                | Integration         |

## 8. Connection and failures

| Case                                   | What happens                                                                             | Checked by  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- |
| Connection lost while filling the form | The total says it can't be updated; it re-prices when the connection comes back.         | Manual      |
| Connection lost on Pay                 | "We couldn't reach the server, so nothing was booked or charged… It won't book twice."   | Manual      |
| The database is down                   | 500 with a generic message; the cause is logged, not shown.                              | Integration |
| A body that isn't JSON, or over 64 KB  | 415 / 413.                                                                               | Integration |
| Too many bookings from one connection  | The 11th in 10 minutes gets 429 with Retry-After. IP addresses are hashed, never stored. | Integration |

## 9. Phone and keyboard

| Case            | What happens                                                                                                 | Checked by   |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| On a phone      | One column; a total bar stays at the bottom; tap targets are at least 44 px.                                 | Manual       |
| Keyboard only   | Every control is a native button, input or radio; focus is always visible.                                   | Manual       |
| Errors          | Shown after leaving a field or on Pay, never while typing. On Pay, a list at the top links to each problem.  | Unit, Manual |
| Colour contrast | Error and success text use lighter tints of the brand red and green to pass contrast on the dark background. | Manual       |

---

## Known gaps

Found, and left for now:

- **The same person twice on the same day.** Someone added on two tickets for the same day is charged twice. People aren't identified (no ID, by decision), so the server can't tell them apart; a warning on matching names is not built.
- **Stock-short items stay on the bill.** If 3 Garba places are wanted and 2 are left, the total still includes 3 until the cart is fixed. Pay is blocked, so nobody is charged for it.
- **Plurals in some messages**, e.g. "2 Garba Workshop left".
- **Expired holds are released when the next request sees them**, not on a timer. Stock is always right when it's read, but an abandoned booking stays "pending" in the database until then.
