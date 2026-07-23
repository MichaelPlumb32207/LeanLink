-- Per-upload (and optional account default) for registration vs wallet lean conflicts.
-- Default wallet = public donation/evidence lean wins when both exist (D-044).

ALTER TABLE voter_uploads
  ADD COLUMN IF NOT EXISTS lean_precedence TEXT NOT NULL DEFAULT 'wallet'
    CHECK (lean_precedence IN ('wallet', 'registration', 'conflict_undetermined'));

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS lean_precedence TEXT
    CHECK (lean_precedence IS NULL OR lean_precedence IN ('wallet', 'registration', 'conflict_undetermined'));

COMMENT ON COLUMN voter_uploads.lean_precedence IS
  'Deliverable lean when party prior and evidence disagree: wallet (default) | registration | conflict_undetermined';
COMMENT ON COLUMN accounts.lean_precedence IS
  'Optional default for new billed uploads; upload.lean_precedence is authoritative once set.';
