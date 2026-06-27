-- LeanLink initial schema (Neon Postgres)
-- Single-user MVP: meplumb@gmail.com

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Upload metadata
CREATE TABLE IF NOT EXISTS voter_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  filename TEXT,
  row_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per CSV record
CREATE TABLE IF NOT EXISTS voter_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  voter_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (upload_id, row_index),
  UNIQUE (upload_id, voter_hash)
);

-- Job runner state
CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Inference output
CREATE TABLE IF NOT EXISTS lean_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES voter_uploads(id) ON DELETE CASCADE,
  voter_record_id UUID NOT NULL REFERENCES voter_records(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  lean TEXT CHECK (lean IN ('Left', 'Right', 'Independent', 'Undetermined')),
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  evidence JSONB,
  matched_social JSONB,
  audit_log JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (voter_record_id),
  UNIQUE (user_id, voter_hash)
);

-- Indexes for worker + dashboard
CREATE INDEX IF NOT EXISTS idx_voter_records_upload_status
  ON voter_records (upload_id, status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_heartbeat
  ON processing_jobs (status, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_lean_results_upload
  ON lean_results (upload_id);
CREATE INDEX IF NOT EXISTS idx_voter_uploads_user
  ON voter_uploads (user_id, created_at DESC);

-- RLS: defense in depth (app sets app.current_user per request)
ALTER TABLE voter_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE voter_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lean_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY voter_uploads_user_isolation ON voter_uploads
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

CREATE POLICY voter_records_user_isolation ON voter_records
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

CREATE POLICY processing_jobs_user_isolation ON processing_jobs
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

CREATE POLICY lean_results_user_isolation ON lean_results
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));