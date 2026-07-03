-- Phase A (generic intake) + Phase B (waterfall settlement)
-- Additive and idempotent. Apply after 007_committee_lean.sql.

-- ---------------------------------------------------------------------------
-- Generic intake: batches can now originate from a flexible client list, not
-- just the FL DOS extract. Records carry a data-completeness score.
-- ---------------------------------------------------------------------------
ALTER TABLE voter_uploads
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'fl_extract'
    CHECK (source_type IN ('fl_extract', 'generic'));

ALTER TABLE voter_records
  ADD COLUMN IF NOT EXISTS completeness_score INTEGER
    CHECK (completeness_score IS NULL OR completeness_score BETWEEN 0 AND 100);
ALTER TABLE voter_records
  ADD COLUMN IF NOT EXISTS completeness_band TEXT
    CHECK (completeness_band IS NULL OR completeness_band IN ('thin', 'moderate', 'rich'));
ALTER TABLE voter_records
  ADD COLUMN IF NOT EXISTS completeness JSONB;

-- ---------------------------------------------------------------------------
-- Waterfall settlement: once an arm returns a confident lean, the voter is
-- "settled" at that tier and excluded from later (more expensive) arms.
-- tier 0 = provided-party prior (free/unbilled), 1 = FEC, 2 = FL/Sunbiz,
-- 3 = OSINT.
-- ---------------------------------------------------------------------------
ALTER TABLE voter_lean_fusion
  ADD COLUMN IF NOT EXISTS settled_arm TEXT;
ALTER TABLE voter_lean_fusion
  ADD COLUMN IF NOT EXISTS settled_tier INTEGER
    CHECK (settled_tier IS NULL OR settled_tier BETWEEN 0 AND 3);
ALTER TABLE voter_lean_fusion
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_voter_lean_fusion_settled
  ON voter_lean_fusion (upload_id, settled_tier);
