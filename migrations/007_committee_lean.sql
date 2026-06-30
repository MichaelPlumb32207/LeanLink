-- Researcher-maintained committee → lean labels (opportunistic labeling)

CREATE TABLE IF NOT EXISTS committee_lean_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  committee_name_norm TEXT NOT NULL,
  committee_name TEXT NOT NULL,
  lean TEXT NOT NULL
    CHECK (lean IN ('Left', 'Right', 'Independent', 'Undetermined')),
  confidence INTEGER NOT NULL DEFAULT 70 CHECK (confidence BETWEEN 0 AND 100),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'researcher'
    CHECK (source IN ('researcher', 'import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, committee_name_norm)
);

CREATE INDEX IF NOT EXISTS idx_committee_lean_labels_user
  ON committee_lean_labels (user_id, updated_at DESC);

ALTER TABLE committee_lean_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY committee_lean_labels_user_isolation ON committee_lean_labels
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));