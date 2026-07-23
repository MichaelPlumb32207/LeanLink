-- Per-upload FL extract universe (party + registration status filter).
-- JSONB so presets and custom multi-selects stay flexible without more columns.
-- Generic (client) intake leaves this NULL — the client list is already the universe.

ALTER TABLE voter_uploads
  ADD COLUMN IF NOT EXISTS ingest_universe JSONB;

COMMENT ON COLUMN voter_uploads.ingest_universe IS
  'FL extract filter snapshot: {preset, parties[], statuses[], exclude_exempt, exclude_suppressed}. NULL = generic list or pre-migration upload.';
