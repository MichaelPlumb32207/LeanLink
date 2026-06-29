-- Deterministic FEC identity scoring + donation lean (post-sweep)

ALTER TABLE fec_lookup_results
  ADD COLUMN IF NOT EXISTS identity_band TEXT
    CHECK (identity_band IN ('confirmed', 'probable', 'ambiguous', 'unlikely', 'none')),
  ADD COLUMN IF NOT EXISTS identity_best_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS probable_same_person BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS identity_scored JSONB,
  ADD COLUMN IF NOT EXISTS fec_lean TEXT
    CHECK (fec_lean IS NULL OR fec_lean IN ('Left', 'Right', 'Independent', 'Undetermined')),
  ADD COLUMN IF NOT EXISTS fec_lean_confidence INTEGER;

CREATE INDEX IF NOT EXISTS idx_fec_lookup_results_upload_confirmed
  ON fec_lookup_results (upload_id, probable_same_person)
  WHERE probable_same_person = TRUE;

ALTER TABLE fec_sweep_jobs
  ADD COLUMN IF NOT EXISTS confirmed_hits_count INTEGER NOT NULL DEFAULT 0;