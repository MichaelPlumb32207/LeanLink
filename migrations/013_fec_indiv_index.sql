-- FEC federal individual-contributions index (Florida-filtered bulk load) — D-028.
-- Third bulk reference index, mirroring fl_contributions / sunbiz_officers (006).
-- Kills the FEC API bottleneck: Tier 1 becomes a local index lookup (minutes per
-- county) instead of a throttled multi-day API sweep. Additive and re-runnable.
-- Apply after 012.

-- reference_snapshots learns the new source, plus a completion marker so lookups
-- never read a snapshot that is still loading. (Bulk loads run ~30 min and the
-- snapshot row is created up front and updated live for progress tracking —
-- `completed_at IS NOT NULL` is what makes a snapshot eligible for lookups.)
ALTER TABLE reference_snapshots DROP CONSTRAINT IF EXISTS reference_snapshots_source_check;
ALTER TABLE reference_snapshots ADD CONSTRAINT reference_snapshots_source_check
  CHECK (source IN ('fl_contrib', 'sunbiz_cor', 'fec_indiv'));

ALTER TABLE reference_snapshots ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE reference_snapshots SET completed_at = imported_at WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS fec_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES reference_snapshots(id) ON DELETE CASCADE,
  sub_id BIGINT NOT NULL,               -- FEC unique row id (resume/idempotency key)
  cmte_id TEXT,
  committee_name TEXT,                  -- denormalized from the cycle's committee master
  committee_party TEXT,                 -- CMTE_PTY_AFFILIATION (DEM/REP/...) — bonus lean signal
  contributor_name TEXT NOT NULL,       -- file format: "LAST, FIRST MIDDLE [SUFFIX]"
  contributor_name_norm TEXT NOT NULL,  -- normalizeNameKey + suffix strip → "last first middle"
  city TEXT,
  state TEXT,
  zip5 TEXT,
  employer TEXT,
  occupation TEXT,
  amount DOUBLE PRECISION,
  contribution_date DATE,               -- TRANSACTION_DT (MMDDYYYY) parsed
  transaction_tp TEXT,
  memo_cd TEXT
);
-- No raw JSONB column (unlike fl_contributions): at ~5M rows per cycle it would
-- roughly double storage, and every field we use is already first-class.

-- Resume key: re-running the loader skips rows already present.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fec_contrib_snapshot_sub
  ON fec_contributions (snapshot_id, sub_id);
CREATE INDEX IF NOT EXISTS idx_fec_contrib_name_zip
  ON fec_contributions (contributor_name_norm, zip5);
-- text_pattern_ops so prefix LIKE ('smith john%') is indexed under any collation.
CREATE INDEX IF NOT EXISTS idx_fec_contrib_name_prefix
  ON fec_contributions (contributor_name_norm text_pattern_ops);
