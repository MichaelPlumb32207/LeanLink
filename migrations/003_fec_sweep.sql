-- FEC Schedule A whole-upload sweep (free API — no Grok)

CREATE TABLE IF NOT EXISTS fec_sweep_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  hits_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fec_lookup_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_job_id UUID NOT NULL REFERENCES fec_sweep_jobs(id) ON DELETE CASCADE,
  voter_record_id UUID NOT NULL REFERENCES voter_records(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  voter_hash TEXT NOT NULL,
  contributor_name TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  has_hits BOOLEAN NOT NULL DEFAULT FALSE,
  match_level TEXT NOT NULL DEFAULT 'strict'
    CHECK (match_level IN ('strict', 'state_only', 'none')),
  contributions JSONB NOT NULL DEFAULT '[]'::jsonb,
  query JSONB,
  api_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sweep_job_id, voter_record_id)
);

CREATE INDEX IF NOT EXISTS idx_fec_sweep_jobs_upload_status
  ON fec_sweep_jobs (upload_id, status);
CREATE INDEX IF NOT EXISTS idx_fec_sweep_jobs_status_heartbeat
  ON fec_sweep_jobs (status, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_fec_lookup_results_upload_hits
  ON fec_lookup_results (upload_id, has_hits);
CREATE INDEX IF NOT EXISTS idx_fec_lookup_results_sweep
  ON fec_lookup_results (sweep_job_id);

ALTER TABLE fec_sweep_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fec_lookup_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY fec_sweep_jobs_user_isolation ON fec_sweep_jobs
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

CREATE POLICY fec_lookup_results_user_isolation ON fec_lookup_results
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));