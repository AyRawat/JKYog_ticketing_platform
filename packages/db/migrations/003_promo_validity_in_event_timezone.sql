-- =====================================================================
-- 003: EXPIRED5 ends at the end of 30 Nov in the event's own timezone
-- =====================================================================

-- The original seed wrote the end of 30 Nov with a fixed -05 offset, but Allen is on
-- Central Standard Time (UTC-6) from 1 Nov, so the code stopped working an hour early.
-- Naming the timezone lets Postgres apply daylight saving. Fresh databases get this from the seed.
UPDATE promo_codes pc
SET valid_until = '2026-11-30 23:59:59.999999 America/Chicago'
FROM events e
WHERE pc.event_id = e.id
  AND e.slug = 'sharad-utsav-2026'
  AND pc.code = 'EXPIRED5';
