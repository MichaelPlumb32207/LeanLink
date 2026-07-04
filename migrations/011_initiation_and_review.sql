-- Phase D — initiation fee + researcher review controls.
-- Additive and idempotent. Apply after 010_fec_retry.sql.

-- ---------------------------------------------------------------------------
-- Initiation (kickoff) fee: a one-time engagement charge per account, priced on
-- the rate card like every other fee. The ledger CHECK gains an 'initiation'
-- kind; the partial unique index makes the charge once-per-account, ever.
-- (DROP-then-ADD keeps the constraint edit re-runnable.)
-- ---------------------------------------------------------------------------
ALTER TABLE billing_ledger DROP CONSTRAINT IF EXISTS billing_ledger_kind_check;
ALTER TABLE billing_ledger ADD CONSTRAINT billing_ledger_kind_check
  CHECK (kind IN ('deposit', 'baseline', 'charge', 'attempt', 'adjustment', 'initiation'));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_initiation_per_account
  ON billing_ledger (account_id) WHERE kind = 'initiation';

ALTER TABLE rate_cards
  ADD COLUMN IF NOT EXISTS initiation_usd NUMERIC(12, 4);

-- Seed the default kickoff fee without clobbering an operator edit.
UPDATE rate_cards SET initiation_usd = 2500
  WHERE scope = 'default' AND initiation_usd IS NULL;

-- ---------------------------------------------------------------------------
-- Researcher review controls. Settlement (billing, sticky) and research flow
-- are now separate switches:
--   review_status = 'accepted'  → lean is affirmed and frozen; the voter is
--                                 excluded from ALL further arms and fusion
--                                 stops updating the deliverable values.
--   research_status = 're_enrolled' → the voter re-enters later arms even
--                                 though already settled (billed once; further
--                                 evidence may still revise lean/confidence).
-- Default (both NULL) keeps today's waterfall: research stops at settlement.
-- ---------------------------------------------------------------------------
ALTER TABLE voter_lean_fusion
  ADD COLUMN IF NOT EXISTS review_status TEXT
    CHECK (review_status IS NULL OR review_status IN ('accepted'));
ALTER TABLE voter_lean_fusion
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE voter_lean_fusion
  ADD COLUMN IF NOT EXISTS research_status TEXT
    CHECK (research_status IS NULL OR research_status IN ('re_enrolled'));
ALTER TABLE voter_lean_fusion
  ADD COLUMN IF NOT EXISTS re_enrolled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_voter_lean_fusion_review
  ON voter_lean_fusion (upload_id, review_status)
  WHERE review_status IS NOT NULL;
