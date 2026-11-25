-- =====================================================================
-- 002: headcount-capped extras + idempotency request fingerprint
-- =====================================================================

-- Per-day extras that are bought per person attending that day (Dinner Plate, Garba Workshop).
-- On each day, quantity may not exceed the number of ticketed attendees admitted that day.
-- Under-5s hold no ticket, so they never count towards the cap.
ALTER TABLE products
  ADD COLUMN capped_by_daily_headcount boolean NOT NULL DEFAULT false;

ALTER TABLE products
  ADD CONSTRAINT products_headcount_cap_only_per_day_extras
  CHECK (NOT capped_by_daily_headcount OR (kind = 'extra' AND day_scope = 'per_day'));

-- Backfill catalogues seeded before this migration (fresh databases get it from the seed).
UPDATE products p
SET capped_by_daily_headcount = true
FROM events e
WHERE p.event_id = e.id
  AND e.slug = 'sharad-utsav-2026'
  AND p.code IN ('DINNER_PLATE', 'GARBA_WORKSHOP');

-- SHA-256 (hex) of the canonicalised booking request. A retry with the same idempotency key
-- must carry the same request; a different request under a reused key is rejected (409).
ALTER TABLE bookings
  ADD COLUMN idempotency_request_hash text NOT NULL
  CHECK (idempotency_request_hash ~ '^[0-9a-f]{64}$');
