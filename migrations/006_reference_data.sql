-- Bulk reference indexes: FL state campaign finance + Sunbiz officers (Free Pass tier)

CREATE TABLE IF NOT EXISTS reference_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('fl_contrib', 'sunbiz_cor')),
  label TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0,
  date_from DATE,
  date_to DATE,
  notes TEXT,
  UNIQUE (source, label)
);

CREATE TABLE IF NOT EXISTS fl_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES reference_snapshots(id) ON DELETE CASCADE,
  contributor_name TEXT NOT NULL,
  contributor_name_norm TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip5 TEXT,
  amount DOUBLE PRECISION,
  contribution_date DATE,
  committee_name TEXT,
  contribution_type TEXT,
  occupation TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_fl_contrib_snapshot
  ON fl_contributions (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_fl_contrib_name_zip
  ON fl_contributions (contributor_name_norm, zip5);
CREATE INDEX IF NOT EXISTS idx_fl_contrib_name_city
  ON fl_contributions (contributor_name_norm, city);
CREATE INDEX IF NOT EXISTS idx_fl_contrib_committee
  ON fl_contributions (committee_name);

CREATE TABLE IF NOT EXISTS sunbiz_officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES reference_snapshots(id) ON DELETE CASCADE,
  corp_number TEXT NOT NULL,
  corp_name TEXT NOT NULL,
  corp_name_norm TEXT NOT NULL,
  corp_status TEXT,
  filing_type TEXT,
  principal_city TEXT,
  principal_zip5 TEXT,
  officer_title TEXT,
  officer_type TEXT,
  officer_name TEXT NOT NULL,
  officer_name_norm TEXT NOT NULL,
  officer_city TEXT,
  officer_zip5 TEXT,
  officer_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_sunbiz_snapshot
  ON sunbiz_officers (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sunbiz_officer_lookup
  ON sunbiz_officers (officer_name_norm, officer_zip5);
CREATE INDEX IF NOT EXISTS idx_sunbiz_corp_name
  ON sunbiz_officers (corp_name_norm);