-- Per-arm run tracking (D-029 Phase B) — generalizes the fec_sweep_jobs progress
-- pattern (003) to every runner, including CLI runs, so the dashboard's
-- current-inning panel can show live processed/rate/ETA for any arm.
-- Additive and re-runnable. Apply after 013 and BEFORE deploying code that
-- selects from arm_runs.

CREATE TABLE IF NOT EXISTS arm_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  arm TEXT NOT NULL,            -- EvidenceArmId ('fec','fl_contrib','sunbiz',…)
  runner TEXT NOT NULL,         -- 'fec_index_api' | 'fec_index_cli' | 'free_pass_api' | 'free_pass_cli'
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('queued','running','completed','failed','cancelled')),
  total_count INTEGER NOT NULL DEFAULT 0,       -- eligible pool at start (claim-predicate count)
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  hits_count INTEGER NOT NULL DEFAULT 0,        -- raw hits (rows with any match)
  confirmed_count INTEGER NOT NULL DEFAULT 0,   -- identity-confirmed
  lean_signal_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  meta JSONB,                                   -- snapshot label, chunk size, start offset, …
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- An upload legitimately re-runs an arm (re-enrollment, new reference cycles):
-- keep history, forbid concurrency — one ACTIVE run per (upload, arm).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_arm_runs_active
  ON arm_runs (upload_id, arm) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_arm_runs_upload_created
  ON arm_runs (upload_id, created_at DESC);

ALTER TABLE arm_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arm_runs_user_isolation ON arm_runs;
CREATE POLICY arm_runs_user_isolation ON arm_runs
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));
