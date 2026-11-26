-- =====================================================================
-- 004: request counts for rate limiting
-- =====================================================================

-- On serverless hosting each request may run on a fresh instance, so counts kept in memory
-- would reset and not be shared. Like stock, they live in Postgres.
--
-- One row per bucket per fixed time window, e.g. ('bookings:203.0.113.7', 12:40). A request
-- adds one with an upsert and is refused once its window is over the limit. Old windows are
-- deleted as the table is used.
CREATE TABLE rate_limit_hits (
  bucket        text NOT NULL,
  window_start  timestamptz NOT NULL,
  hits          integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX rate_limit_hits_window_idx ON rate_limit_hits (window_start);
