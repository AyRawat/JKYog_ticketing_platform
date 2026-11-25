-- =====================================================================
-- SEED: Sharad Utsav 2026
-- Festival moved to 10–14 Dec 2026 (the brief's November dates had already passed).
-- Applied by `pnpm db:seed`, which skips it if the event already exists.
-- =====================================================================
WITH e AS (
  INSERT INTO events (slug, name, venue, timezone, age_reference_date, child_min_age, adult_min_age, booker_min_age)
  VALUES ('sharad-utsav-2026', 'Sharad Utsav 2026', 'Radha Krishna Temple, Allen, Texas',
          'America/Chicago', '2026-12-10', 5, 12, 18)
  RETURNING id
)
INSERT INTO event_days (event_id, day_date)
SELECT e.id, d::date FROM e, generate_series('2026-12-10'::date, '2026-12-14'::date, '1 day') d;

INSERT INTO products (event_id, code, display_name, kind, day_scope, unit_price_cents, admits_adults, admits_children, max_per_booking, capped_by_daily_headcount, sort_order)
SELECT id, v.* FROM events, (VALUES
  ('DAY_PASS_ADULT',     'Day Pass – Adult',      'entry'::product_kind, 'per_day'::day_scope,     1500, 1, 0, NULL::smallint, false, 1),
  ('DAY_PASS_CHILD',     'Day Pass – Child',      'entry',               'per_day',                 800, 0, 1, NULL, false, 2),
  ('ALL_DAY_PASS_ADULT', 'All-Day Pass – Adult',  'entry',               'whole_event',            6000, 1, 0, NULL, false, 3),
  ('ALL_DAY_PASS_CHILD', 'All-Day Pass – Child',  'entry',               'whole_event',            3000, 0, 1, NULL, false, 4),
  ('FAMILY_PASS',        'Family Pass',           'entry',               'per_day',                4000, 2, 2, NULL, false, 5),
  ('DANDIYA_STICKS',     'Dandiya Sticks (pair)', 'extra',               'whole_event',             500, 0, 0, 20,   false, 6),
  ('DINNER_PLATE',       'Dinner Plate',          'extra',               'per_day',                1200, 0, 0, NULL, true,  7),
  ('GARBA_WORKSHOP',     'Garba Workshop',        'extra',               'per_day',                2000, 0, 0, NULL, true,  8)
) AS v(code, display_name, kind, day_scope, unit_price_cents, admits_adults, admits_children, max_per_booking, capped_by_daily_headcount, sort_order)
WHERE events.slug = 'sharad-utsav-2026';

-- Every product on every day, except Garba (11 & 13 Dec only); Dandiya is a souvenir, no days.
INSERT INTO product_days (product_id, event_day_id)
SELECT p.id, d.id FROM products p JOIN event_days d ON d.event_id = p.event_id
WHERE p.code NOT IN ('GARBA_WORKSHOP', 'DANDIYA_STICKS')
   OR (p.code = 'GARBA_WORKSHOP' AND d.day_date IN ('2026-12-11', '2026-12-13'));

INSERT INTO inventory (product_id, remaining)
SELECT p.id, v.remaining FROM products p JOIN (VALUES
  ('DAY_PASS_ADULT', 380), ('DAY_PASS_CHILD', 260), ('ALL_DAY_PASS_ADULT', 0),
  ('ALL_DAY_PASS_CHILD', 140), ('FAMILY_PASS', 95), ('DANDIYA_STICKS', 900),
  ('DINNER_PLATE', 1700), ('GARBA_WORKSHOP', 2)
) AS v(code, remaining) ON v.code = p.code;

-- Validity windows use the event's timezone by name, so daylight saving is handled by Postgres
-- (Allen is UTC-5 in October but UTC-6 from 1 Nov).
INSERT INTO promo_codes (event_id, code, discount_type, percent_bps, amount_cents, valid_from, valid_until, max_redemptions, times_redeemed)
SELECT id, v.* FROM events, (VALUES
  ('SEVA10'::citext, 'percent_off_total'::discount_type, 1000, NULL::int, NULL::timestamptz, NULL::timestamptz, NULL::int, 0),
  ('FLAT20',   'amount_off_total',  NULL, 2000, NULL, NULL, NULL, 0),
  ('KIDSFREE', 'child_entry_free',  NULL, NULL, NULL, NULL, NULL, 0),
  ('EXPIRED5', 'amount_off_total',  NULL, 500,  '2026-10-01 00:00:00 America/Chicago', '2026-11-30 23:59:59.999999 America/Chicago', NULL, 0),
  ('MAXEDOUT', 'percent_off_total', 1500, NULL, NULL, NULL, 50, 50)
) AS v(code, discount_type, percent_bps, amount_cents, valid_from, valid_until, max_redemptions, times_redeemed)
WHERE events.slug = 'sharad-utsav-2026';
