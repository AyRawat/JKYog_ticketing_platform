-- =====================================================================
-- Sharad Utsav booking — Postgres schema (Neon)
-- Three layers:
--   1. CATALOG      what can be bought, when, and its rules   (admin-owned, rarely changes)
--   2. STOCK/PROMO  counters that change under concurrency     (hot rows, guarded updates)
--   3. BOOKINGS     what a family actually bought              (append-mostly, immutable once paid)
-- Money is always integer cents. Rules key off data columns, never names/labels.
-- Seed data lives in ../seeds (applied by `pnpm db:seed`), not in migrations.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- Enums (closed sets the code switches on) ----------
CREATE TYPE product_kind   AS ENUM ('entry', 'extra');
CREATE TYPE day_scope      AS ENUM ('per_day', 'whole_event');   -- does a line need a day?
CREATE TYPE discount_type  AS ENUM ('percent_off_total', 'amount_off_total', 'child_entry_free');
CREATE TYPE booking_status AS ENUM ('pending_payment', 'confirmed', 'expired', 'cancelled');

-- =====================================================================
-- 1. CATALOG
-- =====================================================================

CREATE TABLE events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE,                 -- 'sharad-utsav-2026'
  name                text NOT NULL,
  venue               text NOT NULL,
  timezone            text NOT NULL,                        -- 'America/Chicago'
  currency            char(3) NOT NULL DEFAULT 'USD',
  -- Age rules are config, not code constants -> next year's committee change is a data change
  age_reference_date  date NOT NULL,                        -- ages are "age on this date"
  child_min_age       smallint NOT NULL,                    -- 5  (below = free, no ticket)
  adult_min_age       smallint NOT NULL,                    -- 12
  booker_min_age      smallint NOT NULL,                    -- 18
  hold_minutes        smallint NOT NULL DEFAULT 15,         -- how long a pending booking holds stock
  CHECK (0 <= child_min_age AND child_min_age < adult_min_age AND adult_min_age <= booker_min_age)
);

CREATE TABLE event_days (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES events(id),
  day_date  date NOT NULL,                                  -- DATE, not timestamp: no TZ drift
  UNIQUE (event_id, day_date)
);

CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES events(id),
  code              text NOT NULL,                          -- stable machine key: 'DAY_PASS_ADULT'
  display_name      text NOT NULL,                          -- free to rename; nothing depends on it
  kind              product_kind NOT NULL,
  day_scope         day_scope NOT NULL,
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  -- Who an entry product admits. Drives age checks, family composition AND KIDSFREE.
  admits_adults     smallint NOT NULL DEFAULT 0 CHECK (admits_adults   >= 0),
  admits_children   smallint NOT NULL DEFAULT 0 CHECK (admits_children >= 0),
  max_per_booking   smallint CHECK (max_per_booking > 0),   -- "reasonable quantity" for extras
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        smallint NOT NULL DEFAULT 0,
  UNIQUE (event_id, code),
  CHECK (
    (kind = 'entry' AND admits_adults + admits_children >= 1) OR
    (kind = 'extra' AND admits_adults = 0 AND admits_children = 0)
  )
);

-- Which days a product can be used/bought for. Garba = only 11 & 13 Dec.
-- Whole-event products list every day (an all-day pass admits on all of them).
CREATE TABLE product_days (
  product_id    uuid NOT NULL REFERENCES products(id),
  event_day_id  uuid NOT NULL REFERENCES event_days(id),
  PRIMARY KEY (product_id, event_day_id)
);

-- =====================================================================
-- 2. STOCK & PROMO COUNTERS
-- =====================================================================

-- Kept apart from products: hot, frequently-updated row vs. cold catalog row.
-- One stock pool per product. Units consumed = booking_lines.quantity
-- (so a day pass for 2 adults x 3 days = 6 units). Per-day pools would add event_day_id here.
CREATE TABLE inventory (
  product_id  uuid PRIMARY KEY REFERENCES products(id),
  remaining   integer NOT NULL CHECK (remaining >= 0)       -- DB-level backstop against overselling
);

CREATE TABLE promo_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events(id),
  code             citext NOT NULL,                         -- case-insensitive: 'seva10' works
  discount_type    discount_type NOT NULL,
  percent_bps      integer,                                 -- basis points: 1000 = 10%
  amount_cents     integer,
  valid_from       timestamptz,
  valid_until      timestamptz,
  max_redemptions  integer CHECK (max_redemptions > 0),
  times_redeemed   integer NOT NULL DEFAULT 0 CHECK (times_redeemed >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  UNIQUE (event_id, code),
  CHECK (max_redemptions IS NULL OR times_redeemed <= max_redemptions),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
  CHECK (
    (discount_type = 'percent_off_total' AND percent_bps BETWEEN 1 AND 10000 AND amount_cents IS NULL) OR
    (discount_type = 'amount_off_total'  AND amount_cents > 0 AND percent_bps IS NULL) OR
    (discount_type = 'child_entry_free'  AND percent_bps IS NULL AND amount_cents IS NULL)
  )
);

-- =====================================================================
-- 3. BOOKINGS
-- =====================================================================

CREATE TABLE bookings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- unguessable: safe in confirmation URL
  event_id                  uuid NOT NULL REFERENCES events(id),
  reference                 text NOT NULL UNIQUE,                         -- 'SU26-7K3QX', read out at the door
  status                    booking_status NOT NULL DEFAULT 'pending_payment',
  idempotency_key           uuid NOT NULL UNIQUE,                         -- client-generated; double-click Pay = same booking
  -- Booker (payer/contact). May or may not also be an attendee.
  contact_name              text NOT NULL,
  contact_email             citext NOT NULL,
  contact_phone             text NOT NULL,
  contact_age_years         smallint NOT NULL CHECK (contact_age_years BETWEEN 0 AND 120),
  -- Price snapshot computed by the server at creation time; never sent by the client
  promo_code_id             uuid REFERENCES promo_codes(id),
  subtotal_cents            integer NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents            integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents               integer NOT NULL,
  stripe_payment_intent_id  text UNIQUE,
  hold_expires_at           timestamptz NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  confirmed_at              timestamptz,
  CHECK (discount_cents <= subtotal_cents),
  CHECK (total_cents = subtotal_cents - discount_cents),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE INDEX bookings_pending_expiry_idx ON bookings (hold_expires_at) WHERE status = 'pending_payment';

-- Everyone in the group, including under-5s (headcount at the door, no ticket).
CREATE TABLE attendees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  position          smallint NOT NULL,                      -- stable order in the form
  full_name         text NOT NULL CHECK (length(trim(full_name)) > 0),
  age_years         smallint NOT NULL CHECK (age_years BETWEEN 0 AND 120),
  phone             text,                                   -- adults only, optional; never for children
  entry_product_id  uuid REFERENCES products(id),           -- the ONE entry kind; NULL = under 5
  UNIQUE (booking_id, position),
  UNIQUE (id, entry_product_id),                            -- target for composite FK below
  UNIQUE (id, booking_id)
);

-- Priced lines. Every line prices the same way: line_total = unit_price x quantity.
--   Day Pass Adult, Dec 10, qty 2   | All-Day Child, (no day), qty 1
--   Family Pass, Dec 12, qty 1      | Dinner Plate, Dec 12, qty 4 | Dandiya, (no day), qty 3
CREATE TABLE booking_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id),
  event_day_id      uuid REFERENCES event_days(id),         -- NULL for whole_event products
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),  -- snapshot: later price edits don't rewrite history
  line_total_cents  integer NOT NULL,
  CHECK (line_total_cents = unit_price_cents * quantity),
  UNIQUE (booking_id, product_id, event_day_id),            -- one line per product per day
  UNIQUE (id, product_id),
  UNIQUE (id, booking_id),
  -- Day must be valid for this product (Garba on Dec 12 is impossible). Skipped when day is NULL.
  FOREIGN KEY (product_id, event_day_id) REFERENCES product_days (product_id, event_day_id)
);

-- The door list: one row = "this person may enter on this day, via this line".
-- All-Day pass expands to 5 rows; Family Pass to 4 people x 1 day.
CREATE TABLE admissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL,
  attendee_id      uuid NOT NULL,
  booking_line_id  uuid NOT NULL,
  product_id       uuid NOT NULL,
  event_day_id     uuid NOT NULL REFERENCES event_days(id),
  checked_in_at    timestamptz,
  UNIQUE (attendee_id, event_day_id),                        -- nobody is admitted twice on one day
  -- Impossible states ruled out by the DB itself:
  FOREIGN KEY (attendee_id, booking_id)       REFERENCES attendees (id, booking_id) ON DELETE CASCADE,
  FOREIGN KEY (booking_line_id, booking_id)   REFERENCES booking_lines (id, booking_id) ON DELETE CASCADE,
  FOREIGN KEY (attendee_id, product_id)       REFERENCES attendees (id, entry_product_id),   -- line's product = person's one kind
  FOREIGN KEY (booking_line_id, product_id)   REFERENCES booking_lines (id, product_id),
  FOREIGN KEY (product_id, event_day_id)      REFERENCES product_days (product_id, event_day_id)
);
CREATE INDEX admissions_door_idx ON admissions (event_day_id);

-- Stripe webhook de-duplication (Stripe retries deliveries).
CREATE TABLE processed_stripe_events (
  stripe_event_id  text PRIMARY KEY,
  processed_at     timestamptz NOT NULL DEFAULT now()
);
