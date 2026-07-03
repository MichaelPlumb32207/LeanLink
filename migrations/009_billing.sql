-- Phase C — prepaid billing subsystem.
-- Single-operator now: an account_id owns a prepaid balance; batches reference an
-- account; charges deduct per accepted record (baseline), per settled lean (tier),
-- and per OSINT attempt. Additive/idempotent. Apply after 008.

-- Client accounts that hold a prepaid balance. account_id is a human-issued slug
-- ("campaign id"); fec_committee_id is optional context. user_id = operator email
-- (the seam that later becomes a real tenant/login key).
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  fec_committee_id TEXT,
  contact_email TEXT,
  prepaid_balance_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only money log. amount_usd is signed (deposits +, charges -). The row's
-- amount IS the rate snapshot: an invoice sums ledger rows, so a later rate edit
-- can never shift an already-billed batch.
CREATE TABLE IF NOT EXISTS billing_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  upload_id UUID REFERENCES voter_uploads(id) ON DELETE SET NULL,
  voter_record_id UUID REFERENCES voter_records(id) ON DELETE SET NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('deposit', 'baseline', 'charge', 'attempt', 'adjustment')),
  arm TEXT,
  tier INTEGER CHECK (tier IS NULL OR tier BETWEEN 0 AND 3),
  amount_usd NUMERIC(12, 4) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_account
  ON billing_ledger (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_ledger_upload
  ON billing_ledger (upload_id);
-- One settlement charge per voter, ever (baseline/attempt use distinct kinds).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_settlement_per_voter
  ON billing_ledger (voter_record_id) WHERE kind = 'charge';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_baseline_per_voter
  ON billing_ledger (voter_record_id) WHERE kind = 'baseline';

-- Editable rate card. scope = 'default' seeds fees; scope = account_id overrides
-- them (volume discounts). Any fee left NULL on an override falls back to default.
CREATE TABLE IF NOT EXISTS rate_cards (
  scope TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  baseline_usd NUMERIC(12, 4),
  tier1_usd NUMERIC(12, 4),
  tier2_usd NUMERIC(12, 4),
  tier3_usd NUMERIC(12, 4),
  osint_attempt_usd NUMERIC(12, 4),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the default rate card (idempotent — do nothing if it already exists).
INSERT INTO rate_cards (scope, user_id, baseline_usd, tier1_usd, tier2_usd, tier3_usd, osint_attempt_usd)
VALUES ('default', 'system', 0.03, 0.15, 0.25, 0.33, 0.05)
ON CONFLICT (scope) DO NOTHING;

-- Batches reference the account they bill to (NULL = internal/test, unbilled).
ALTER TABLE voter_uploads
  ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;

-- Accounts / ledger isolate on the operator's user_id. The default rate card is
-- world-readable (user_id = 'system') so any operator can resolve it.
-- (DROP-then-CREATE keeps this migration re-runnable — CREATE POLICY has no
-- IF NOT EXISTS.)
DROP POLICY IF EXISTS accounts_user_isolation ON accounts;
CREATE POLICY accounts_user_isolation ON accounts
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

DROP POLICY IF EXISTS billing_ledger_user_isolation ON billing_ledger;
CREATE POLICY billing_ledger_user_isolation ON billing_ledger
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

DROP POLICY IF EXISTS rate_cards_user_isolation ON rate_cards;
CREATE POLICY rate_cards_user_isolation ON rate_cards
  FOR ALL
  USING (user_id = current_setting('app.current_user', true) OR user_id = 'system')
  WITH CHECK (user_id = current_setting('app.current_user', true));
