# Sharad Utsav 2026: family booking

**Live:** https://jk-yog-ticketing-platform.vercel.app

A booking page for the temple's 5-day festival. One person books for their group: picks the days, adds everyone with their age, chooses tickets and extras, applies a promo code and pays by card (Stripe test mode). The server prices everything, holds the stock for 15 minutes while they pay, and confirms the booking when Stripe says the payment went through. The confirmation page is the receipt and the door list.

Other documents:

- [DESIGN.md](DESIGN.md): the design note I wrote before coding. Left as it was, so the plan and the result can be compared (see [What changed from the design note](#what-changed-from-the-design-note)).
- [TEST-CASES.md](TEST-CASES.md): the edge cases I checked and what the app does in each.

To try a payment on the live site, use the card `4242 4242 4242 4242`, any future date and any CVC. `4000 0000 0000 0002` is declined.

---

## Contents

1. [Running it locally](#running-it-locally)
2. [Environment variables](#environment-variables)
3. [How it's built](#how-its-built)
4. [API](#api)
5. [Decisions I made](#decisions-i-made)
6. [What changed from the design note](#what-changed-from-the-design-note)
7. [Unfinished, and known gaps](#unfinished-and-known-gaps)
8. [Ten festivals with ten rule sets](#ten-festivals-with-ten-rule-sets)

---

## Running it locally

You need Node 22.12+, pnpm 10 (`corepack enable`), and Docker for Postgres.

```bash
pnpm install
docker compose up -d          # Postgres 16 on localhost:5432
cp .env.example .env          # local database URL, plus Stripe placeholders
pnpm db:migrate               # runs packages/db/migrations in order
pnpm db:seed                  # the festival, its products, stock and promo codes
pnpm dev                      # http://localhost:3000
```

The page works without Stripe keys up to the payment step. To pay locally, put your Stripe **test** keys in `.env`, then forward webhooks in a second terminal:

```bash
stripe listen --events payment_intent.succeeded,payment_intent.payment_failed \
  --forward-to localhost:3000/api/webhooks/stripe
```

It prints a `whsec_…` secret; set it as `STRIPE_WEBHOOK_SECRET` and restart `pnpm dev`.

> If a `.env.local` exists, it overrides `.env`, and the db scripts use it too. Make sure it doesn't point at a database you don't want migrated or seeded.

### Checks

```bash
pnpm test               # unit tests: rules, pricing, form state (no database)
pnpm test:integration   # API tests against a real Postgres (needs docker compose up)
pnpm typecheck
pnpm lint
pnpm format:check
```

The integration tests create and reset their own database, `sharad_utsav_test`, on the local Postgres. They refuse to run against anything that isn't local and named `*_test`. CI runs all of the above on every push.

---

## Environment variables

Set on Vercel under Project → Settings → Environment Variables (and in `.env` locally):

| Variable                             | What it's for                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                       | Postgres connection used by the app. On Vercel this is Neon's **pooled** URL, since every serverless function opens connections. |
| `DATABASE_URL_UNPOOLED`              | Optional. Neon's direct URL, used by the migrate and seed scripts when set. Not needed on Vercel.                                |
| `STRIPE_SECRET_KEY`                  | Stripe **test** secret key (`sk_test_…`). Creates the payment for a booking and issues refunds. Server only.                     |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test** publishable key (`pk_test_…`). Loads the card form in the browser.                                               |
| `STRIPE_WEBHOOK_SECRET`              | Signing secret of the webhook endpoint (`whsec_…`). Every webhook is verified with it before anything is changed.                |

No secrets are committed; `.env*` files are ignored, except `.env.example`, which holds placeholders.

---

## How it's built

Next.js 16 (App Router) with route handlers for the API, React 19, Tailwind 4, TypeScript (strict, no `any`), Postgres on Neon through Kysely, Zod for the API contracts, Stripe for payment, Vitest for tests.

It's a pnpm monorepo, split so that the rules don't live in the UI:

```
packages/domain      the booking rules and pricing, as plain functions with no I/O.
                     quoteCart() is the one place a price is calculated.
packages/contracts   Zod schemas for every request and response, shared by the
                     server (which parses with them) and the page.
packages/db          SQL migrations, the seed, and test database helpers.
apps/web
  src/app/api        route handlers: thin, they parse, call the server code, respond.
  src/server         database access, bookings, holds, payments, rate limits.
  src/features       the booking page (features/booking) and the receipt (features/receipt).
  test/integration   API tests against a real database.
```

**The server decides everything that costs money.** The page shows a live total, but it comes from the quote endpoint: the browser never adds anything up. Requests that contain a price, a total or a status are refused. Prices, ages, stock and promo codes are all checked again when the booking is made, whatever the page did.

**Rules are data, not names.** Every product says how many adults and children it admits, whether it's per day or for the whole festival, and on which days it runs. The age check, the Family Pass check and KIDSFREE all read those columns. Renaming a ticket changes only its label.

**Stock can't be oversold.** Booking takes stock with `UPDATE inventory SET remaining = remaining - n WHERE remaining >= n`, in one transaction with the booking and the promo use, rows locked in a fixed order. If any part fails, nothing is taken. Postgres also has `CHECK (remaining >= 0)` as a backstop. A test sends 8 bookings at once for the last 2 Garba places: exactly 2 succeed.

**Money is integer cents** everywhere, in the database, the API and the domain. Percentages round half up to the cent.

**The page keeps its state in one reducer** (`features/booking/state/reducer.ts`), with the people, their tickets and extras as typed data. Field text such as ages stays as typed until it's committed, so a half-typed age is never lost or misread.

---

## API

All endpoints are JSON. Every error has the same shape, and clients switch on `code`, never on `message`:

```json
{
  "error": {
    "code": "BOOKING_INVALID",
    "message": "…",
    "details": [{ "path": "attendees[1].entry", "message": "…", "code": "AGE_TICKET_MISMATCH" }]
  }
}
```

| Endpoint                          | What it does                                                                                                                      | Success                                                            | Errors                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/events/:slug/catalog`   | The festival, its days, age rules and products, with availability                                                                 | 200                                                                | 404 `EVENT_NOT_FOUND`                                                                                                             |
| `POST /api/events/:slug/quote`    | Prices a cart and checks the rules. Changes nothing.                                                                              | 200, with problems listed in `issues`                              | 400 `INVALID_REQUEST`, 404, 413, 415, 429 `RATE_LIMITED`                                                                          |
| `POST /api/events/:slug/bookings` | Checks and prices the cart again, takes the stock and promo use, and holds them for 15 minutes. Header `Idempotency-Key: <uuid>`. | 201 new booking; 200 the same booking again for a repeated request | 400, 404, 409 `PRICE_CHANGED` / `SOLD_OUT` / `PROMO_UNAVAILABLE` / `IDEMPOTENCY_KEY_REUSED`, 413, 415, 422 `BOOKING_INVALID`, 429 |
| `GET /api/bookings/:id`           | A booking: status, lines, totals, who's coming on which day. No contact details.                                                  | 200                                                                | 404 `BOOKING_NOT_FOUND`                                                                                                           |
| `POST /api/bookings/:id/payment`  | Starts the card payment for a held booking (or returns the same one again). Empty body.                                           | 200                                                                | 404, 409 `BOOKING_NOT_PAYABLE`, 429, 503 `PAYMENT_UNAVAILABLE`                                                                    |
| `POST /api/webhooks/stripe`       | Stripe tells us a payment succeeded or failed. Signature checked.                                                                 | 200                                                                | 400 `WEBHOOK_SIGNATURE_INVALID`                                                                                                   |
| `GET /api/health`                 | Checks the app can reach the database                                                                                             | 200                                                                | 503                                                                                                                               |

The full schemas are in `packages/contracts/src`, with comments. The main shapes:

**Quote request** (the booking request adds names, contact details and `expectedTotalCents`):

```json
{
  "booker": { "ageYears": 40 },
  "attendees": [
    { "ageYears": 40, "entry": { "productCode": "FAMILY_PASS", "days": ["2026-12-12"] } },
    { "ageYears": 38, "entry": { "productCode": "FAMILY_PASS", "days": ["2026-12-12"] } },
    { "ageYears": 9, "entry": { "productCode": "FAMILY_PASS", "days": ["2026-12-12"] } },
    { "ageYears": 7, "entry": { "productCode": "FAMILY_PASS", "days": ["2026-12-12"] } },
    { "ageYears": 2, "entry": null }
  ],
  "extras": [
    { "productCode": "DINNER_PLATE", "day": "2026-12-12", "quantity": 4 },
    { "productCode": "DANDIYA_STICKS", "day": null, "quantity": 2 }
  ],
  "promoCode": "SEVA10"
}
```

**Quote response:**

```json
{
  "lines": [
    {
      "productCode": "FAMILY_PASS",
      "productName": "Family Pass",
      "day": "2026-12-12",
      "quantity": 1,
      "unitPriceCents": 4000,
      "lineTotalCents": 4000
    },
    {
      "productCode": "DINNER_PLATE",
      "productName": "Dinner Plate",
      "day": "2026-12-12",
      "quantity": 4,
      "unitPriceCents": 1200,
      "lineTotalCents": 4800
    },
    {
      "productCode": "DANDIYA_STICKS",
      "productName": "Dandiya Sticks (pair)",
      "day": null,
      "quantity": 2,
      "unitPriceCents": 500,
      "lineTotalCents": 1000
    }
  ],
  "subtotalCents": 9800,
  "discountCents": 980,
  "totalCents": 8820,
  "promo": {
    "status": "applied",
    "code": "SEVA10",
    "discountCents": 980,
    "message": "10% off your booking."
  },
  "issues": [],
  "notices": [],
  "canBook": true
}
```

A broken rule (a 7-year-old on an adult ticket, dinner on a day nobody has a ticket) comes back in `issues` with a `path` pointing at the part of the request, so the page shows it next to the right field. The quote still prices the valid parts, so the total keeps working on a half-filled form. `notices` are savings tips, such as "a Family Pass would save $6", and never block booking.

**Booking response** (also the body of `GET /api/bookings/:id`):

```json
{
  "id": "6f1c…", "reference": "SU26-7K3QX", "status": "pending_payment",
  "event": { "slug": "sharad-utsav-2026", "name": "Sharad Utsav 2026" },
  "holdExpiresAt": "2026-12-01T07:30:00.000Z", "currency": "USD",
  "lines": [ … ], "subtotalCents": 9800, "discountCents": 980, "totalCents": 8820, "promoCode": "SEVA10",
  "attendees": [ { "fullName": "Riya", "ageYears": 9, "productCode": "FAMILY_PASS", "days": ["2026-12-12"] } ]
}
```

`status` is `pending_payment`, `confirmed`, `expired` or `cancelled`.

**Payment response:** `{ bookingId, clientSecret, amountCents, currency, holdExpiresAt }`. The amount is the booking's stored total, never anything the browser sends.

### Status codes

| Code                      | When                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 `INVALID_REQUEST`     | The request is the wrong shape: missing or wrong-typed fields, or fields the API doesn't accept (a price, a status). Each field is listed.                                                          |
| 404                       | No such event or booking. A booking reference is not an id: references are for the door, not for lookups.                                                                                           |
| 409                       | Something changed between the quote and Pay: the price, the stock, the promo code's last use. Or an idempotency key reused for a different cart. The page re-prices and asks the family to confirm. |
| 413 / 415                 | Body over 64 KB / not JSON. Requiring JSON also stops cross-site form posts.                                                                                                                        |
| 422 `BOOKING_INVALID`     | A booking rule is broken. `details` lists each one with its path and rule code.                                                                                                                     |
| 429 `RATE_LIMITED`        | Too many requests from one connection. Has `Retry-After`.                                                                                                                                           |
| 503 `PAYMENT_UNAVAILABLE` | Stripe couldn't be reached. The tickets stay held.                                                                                                                                                  |

### How a booking is paid

1. **Pay** creates the booking (`POST /bookings`) with an idempotency key, so a double-click or a retry after a lost connection can't make two. The stock and the promo use are taken now, and held for 15 minutes.
2. The page asks for the payment (`POST /bookings/:id/payment`) and shows Stripe's card form, with a countdown.
3. Stripe calls the webhook. It's verified, applied once per event, and checked against the booking's amount and currency. The booking becomes `confirmed`.
4. The receipt page checks the booking every few seconds until it's confirmed.

If the hold runs out first, the booking expires and gives its stock and promo use back. If a payment arrives after that, the tickets are taken again if they're still there; if not, the money is refunded automatically. A booking that comes to $0 (KIDSFREE on a child-only booking) is confirmed straight away, with no payment step.

---

## Decisions I made

The brief leaves some situations open on purpose. These are the ones I found, what I decided, and why.

### Ages and people

1. **Age is a whole number, as on the first day (10 Dec).** A child who turns 12 on 12 Dec stays a child for the whole festival. One age per person keeps the price from changing mid-week, and nobody has to enter a date of birth.
2. **Under-5s are added to the group but get no ticket.** They're free, but the door team should still expect them, so they're on the door list as "free with their family". They don't count for the Family Pass, for dinner plates or for workshop places, and they can't have extras.
3. **The booker doesn't have to be coming.** A grandparent paying for the family is a normal case, so "Booking for someone else?" takes the booker off the guest list. Their contact details belong to the booking, not to a ticket.
4. **A booking with only under-5s can't be made.** Someone has to hold a ticket. A child-only booking (an older sibling bringing a younger one, booked by a parent who isn't coming) is allowed: the brief has no supervision rule, so I didn't invent one.
5. **Children give a name and age only.** A nine-year-old has no phone number to give. Adults' phone numbers are optional; the booker's is required.
6. **Ages that aren't whole numbers from 0 to 120 are refused.** The page and the server both check.
7. **No government ID.** I considered asking for one so the same person couldn't be booked twice. I decided against it: IDs differ by country (and the festival welcomes visitors), an ID we can't verify proves nothing, and storing ID numbers would make a ticket site a store of sensitive documents. Overselling and double payment are stopped in other ways (stock guards, idempotency, webhook checks), and abuse by rate limits. A door volunteer can look at a photo ID without us storing it. The gap this leaves is in [Known gaps](#unfinished-and-known-gaps).

### Tickets and days

8. **The festival is 10–14 Dec 2026, not November.** The brief's dates had passed by the time I built it, so the seed moves the whole festival a month later. The dates are data; nothing in the code assumes them.
9. **Days before anything that depends on them.** People were choosing a ticket, skipping the days, and carrying on with the next person, only to find out at Pay. Each person still picks their own days in their card, but their extras stay disabled until they have a day, a Family Pass's places wait for the family's days, and "Add another person" waits until everyone above has their days.
10. **Past days can't be booked, and all-day passes stop selling once the festival starts.** An all-day pass bought on day 3 would charge for two days already gone. "Today" is Allen's date, not UTC.
11. **Family Pass = exactly 2 adults + 2 children, per day.** The brief says $40 for "one single day", so it's priced per day, like a day pass, and a family coming two days buys two. A bigger joint family can hold several: 4 adults + 4 children on one day is two passes. 2 adults + 1 child is refused, since the pass is for that exact group; Day Passes are cheaper for them anyway ($38).
12. **Family Pass members can also hold another ticket.** The brief says each person buys exactly one kind of ticket. But if a Family Pass covers Saturday and Mum is also coming on Friday, she needs a Day Pass for Friday. I relaxed the rule: a family member who wants other days is added again on a separate ticket ("Add Priya on a separate ticket" does this with her name and age filled in). The server refuses the same day twice on one ticket; the same person on two tickets for the same day can't be detected (see [Known gaps](#unfinished-and-known-gaps)).
13. **Cheaper options are suggested, never applied.** If 2 adults and 2 children are on Day Passes for a day, the page says a Family Pass would save $6; a child on Day Passes for 4+ days is told about the All-Day Child pass. The family decides. Changing their cart for them would surprise them, and they may have reasons.
14. **Sold-out and unsuitable tickets are shown but disabled, with the reason** ("Sold out", "Ages 5–11 only"), instead of hidden. People can see what exists and why they can't pick it.

### Extras

15. **Dinner and Garba are per person, per day, and only for someone with a ticket that day.** You can't have more dinner plates on a day than ticketed people coming that day. Each person chooses their own extras on their card.
16. **The 2 Garba places are one pool across both days** (11 and 13 Dec), since the brief gives one number.
17. **Dandiya sticks: at most 20 pairs per booking.** "Any reasonable quantity" needed a number; 20 covers a large family and stops one booking emptying the stock.

### Promo codes and money

18. **KIDSFREE makes child-only tickets free (Child Day and All-Day Child), not the Family Pass, and not extras.** The Family Pass is a bundle with no separate child price, so there is nothing clean to take off. Brief's example: Family Pass + 3 Child Day + 1 Adult Day = $79 → $55.
19. **SEVA10 and FLAT20 apply to the whole booking, extras included. FLAT20 never takes the total below $0.**
20. **One code per booking.**
21. **A refused code blocks Pay.** If someone typed a code and it didn't work, charging them the full price without asking would be a nasty surprise. They remove the code or fix it.
22. **EXPIRED5 expired at the end of 30 Oct, in Allen's time.** "Last month" relative to when the site is reviewed (November). Validity uses the festival's timezone, not the server's.
23. **A promo use is taken when the booking is made, like stock, and given back if the booking expires unpaid.** Otherwise the last use of MAXEDOUT could go to two families at once.
24. **Prices are fixed when the booking is made.** If a price changes later, existing bookings keep what they were sold at. If it changes between the quote and Pay, the booking is refused (409) and the page shows the new total to confirm: never charge an amount the family didn't see.
25. **Integer cents, half-up rounding.**

### Booking and payment

26. **Tickets are held for 15 minutes while the family pays.** Long enough to find a card, short enough that abandoned checkouts don't lock the last places for long.
27. **Late payments are honoured if possible.** A payment that arrives after the hold ended takes the tickets again if they're still there; if they've gone, it's refunded automatically.
28. **A free booking is confirmed straight away**, with no card step.
29. **Rate limits per connection**, counted in Postgres so every serverless instance shares them: 10 bookings and 20 payment attempts per 10 minutes, 120 quotes a minute, and 10 promo codes that don't exist per 10 minutes. They stop bots holding all the stock and guessing codes; a family never hits them. IP addresses are hashed, not stored. If the limiter's database fails, requests are let through rather than stopping bookings.
30. **Card payments only.** Stripe's form also offered Link and bank payments, which add redirects and delayed confirmations for little gain here.

---

## What changed from the design note

DESIGN.md was written before the code and left as it was. The main differences:

- **Endpoints.** Bookings moved under the event (`POST /api/events/:slug/bookings`), and starting the payment became its own endpoint (`POST /api/bookings/:id/payment`), so a declined card or a refresh can get the same payment again without re-booking. The error codes were simplified: booking rules are one `422 BOOKING_INVALID` with each rule's code in `details`, rather than a status code per rule.
- **No cron job for expired holds.** Expired holds are released by the next request that reads stock (a quote, a booking, a payment or a booking page), just before it reads, so stock is always right when it's read. Vercel's free plan only runs cron jobs daily, which wouldn't add much.
- **Family Pass members may hold a second ticket** (decision 12). The note said one ticket per person.
- **Extras are chosen per person** on the page, instead of as booking-wide quantities. The API still takes booking-wide quantities; the page adds them up.
- **The receipt page polls the booking**, and no email is sent: the confirmation is logged with the email masked, ready for an email service.
- **Rate limiting** wasn't in the plan; it was added after thinking through how the holds could be abused.

---

## Unfinished, and known gaps

- **The same person on two tickets on the same day is charged twice.** People aren't identified, so the server can't tell two "Asha Patel, 40" apart. A warning on matching names would help; it isn't built.
- **No confirmation email.** The receipt page is the confirmation and can be printed or saved as PDF. The message is logged on the server instead.
- **No Content-Security-Policy yet.** The other security headers are set (nosniff, frame denial, referrer and permissions policies). A CSP needs Stripe's script and frame origins allowed and testing; I ran out of time.
- **Stock-short items stay on the bill.** If 3 Garba places are wanted and 2 are left, the total still counts 3 until the cart is fixed. Pay is blocked, so nobody is charged for them.
- **Some server messages miss plurals** ("2 Garba Workshop left").
- **Out of scope:** cancellations and refunds after payment, accounts, an admin screen (prices, stock and codes are set in the seed), and a door check-in app. The data has room for each: a `cancelled` status, and an `admissions` table with one row per person per day and a `scanned_at` column.

---

## Ten festivals with ten rule sets

A lot of this already belongs to the event rather than the code: the URL carries the event slug, and each event has its own days, timezone, currency, age thresholds, hold time, products, prices, stock and promo codes. Rules read product data (who a ticket admits, which days it runs, limits per booking, whether an extra is capped by headcount), not names. A second festival with different prices, days or ages is a new seed, not a code change.

What I'd change for ten festivals:

- **An admin screen** for events, products, stock and codes, instead of seed files.
- **Rules as configuration per event.** Things that are code today but differ between festivals (the Family Pass mix, whether children may book alone, which tickets KIDSFREE covers) would become per-event settings that the same domain functions read. The domain package is already pure functions taking the event's rules as input, so this is mostly moving constants into the database.
- **Discount types as data**, so a new kind of code doesn't need a deploy.
- **Per-event payment settings**, if festivals collect money into different accounts.
- **A door check-in app** reading the `admissions` table.
