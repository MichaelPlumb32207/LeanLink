-- Multi-arm evidence ledger + fused lean state

CREATE TABLE IF NOT EXISTS evidence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  voter_record_id UUID NOT NULL REFERENCES voter_records(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  arm TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  identity_band TEXT
    CHECK (identity_band IS NULL OR identity_band IN ('confirmed', 'probable', 'ambiguous', 'unlikely', 'none')),
  identity_score DOUBLE PRECISION,
  probable_same_person BOOLEAN NOT NULL DEFAULT FALSE,
  lean_signal TEXT
    CHECK (lean_signal IS NULL OR lean_signal IN ('Left', 'Right', 'Independent', 'Undetermined')),
  lean_confidence INTEGER CHECK (lean_confidence IS NULL OR lean_confidence BETWEEN 0 AND 100),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB,
  dedupe_key TEXT NOT NULL DEFAULT '',
  cost_usd DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (voter_record_id, arm, source, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_evidence_events_voter_created
  ON evidence_events (voter_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_events_upload_arm
  ON evidence_events (upload_id, arm);

CREATE TABLE IF NOT EXISTS voter_lean_fusion (
  voter_record_id UUID PRIMARY KEY REFERENCES voter_records(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  lean TEXT NOT NULL DEFAULT 'Undetermined'
    CHECK (lean IN ('Left', 'Right', 'Independent', 'Undetermined')),
  confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  fusion_status TEXT NOT NULL DEFAULT 'undetermined'
    CHECK (fusion_status IN ('undetermined', 'provisional', 'fused', 'conflicted')),
  contributing_arms JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voter_lean_fusion_upload
  ON voter_lean_fusion (upload_id, lean);

ALTER TABLE evidence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE voter_lean_fusion ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_events_user_isolation ON evidence_events
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

CREATE POLICY voter_lean_fusion_user_isolation ON voter_lean_fusion
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));