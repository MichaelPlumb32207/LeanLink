ALTER TABLE voter_uploads
  ADD COLUMN IF NOT EXISTS history_filename TEXT,
  ADD COLUMN IF NOT EXISTS ballot_favors TEXT NOT NULL DEFAULT 'south'
    CHECK (ballot_favors IN ('south', 'north'));

ALTER TABLE voter_records
  ADD COLUMN IF NOT EXISTS history_summary JSONB;

ALTER TABLE lean_results
  ADD COLUMN IF NOT EXISTS turnout_propensity TEXT,
  ADD COLUMN IF NOT EXISTS turnout_score INTEGER,
  ADD COLUMN IF NOT EXISTS primary_engagement TEXT,
  ADD COLUMN IF NOT EXISTS opposition_mobilization_score INTEGER;