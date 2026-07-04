-- Background retry of FEC lookups that failed on a transient API error (502/504/
-- network). Track attempts + last attempt so a cron can re-try, spaced out and
-- capped, until the row recovers or exhausts its budget. Additive/idempotent.

ALTER TABLE fec_lookup_results
  ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fec_lookup_results
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- Fast lookup of the still-failing rows the retry job scans.
CREATE INDEX IF NOT EXISTS idx_fec_lookup_results_failed
  ON fec_lookup_results (retry_attempts, last_attempt_at)
  WHERE api_error IS NOT NULL;
