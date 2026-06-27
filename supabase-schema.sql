-- Uploads table
CREATE TABLE voter_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- meplumb@gmail.com
  filename TEXT,
  row_count INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Results table
CREATE TABLE lean_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID REFERENCES voter_uploads(id),
  voter_hash TEXT UNIQUE NOT NULL, -- hashed PII
  lean TEXT CHECK (lean IN ('Left', 'Right', 'Independent', 'Undetermined')),
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  evidence JSONB, -- array of strings
  matched_social JSONB,
  audit_log JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Row Level Security) for your user only
ALTER TABLE lean_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only see their own data" ON lean_results
  USING (user_id = current_setting('app.current_user'));
