-- Unified data-driven lean-pattern registry (ENH-008, D-031). Replaces the two
-- hardcoded pattern lists that forked once already (DEF-005/006). Seeds are the
-- exact post-DEF-005/006 lists, PER SCOPE, in each scanner's original order —
-- a unified order would change behavior (e.g. "WINRED REPUBLICAN FUND": fec
-- order → WinRed/90, fl order → Republican/85). sort_order encodes the block
-- precedence (Right 10–90, Left 110–190, Neutral 300).
--
-- lib/lean-patterns/patterns.ts FALLBACK_LEAN_PATTERN_ROWS mirrors these rows
-- byte-for-byte; scripts/smoke-golden-voters.ts asserts parity — edit BOTH or
-- the golden fails. Additive and re-runnable (UNIQUE key + ON CONFLICT).

CREATE TABLE IF NOT EXISTS lean_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('fec', 'fl', 'both')),
  pattern TEXT NOT NULL,                -- RegExp source string
  flags TEXT NOT NULL DEFAULT 'i',
  lean TEXT NOT NULL CHECK (lean IN ('Left', 'Right', 'Independent')),
  confidence INTEGER NOT NULL DEFAULT 70 CHECK (confidence BETWEEN 0 AND 100),
  label TEXT NOT NULL,                  -- evidence string — rendered verbatim in deliverables
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL,          -- scan order within scope; first match wins
  source TEXT NOT NULL DEFAULT 'researcher' CHECK (source IN ('seed', 'researcher')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, scope, pattern)
);

CREATE INDEX IF NOT EXISTS idx_lean_patterns_user_scope
  ON lean_patterns (user_id, scope, sort_order);

ALTER TABLE lean_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lean_patterns_user_isolation ON lean_patterns;
CREATE POLICY lean_patterns_user_isolation ON lean_patterns
  FOR ALL
  USING (user_id = current_setting('app.current_user', true))
  WITH CHECK (user_id = current_setting('app.current_user', true));

-- Single-user reality: seed under the operator email (smoke-billing's default).
-- Other environments see zero rows and fall back to the hardcoded lists.
INSERT INTO lean_patterns (user_id, scope, pattern, lean, confidence, label, sort_order, source)
VALUES
  -- fec scope: lib/fec/donation-lean.ts order (Right → Left → Neutral)
  ('meplumb@gmail.com','fec','\bwinred\b','Right',90,'WinRed conduit',10,'seed'),
  ('meplumb@gmail.com','fec','\btrump\b','Right',88,'Trump-affiliated recipient',20,'seed'),
  ('meplumb@gmail.com','fec','\brepublican\b','Right',85,'Republican committee/candidate',30,'seed'),
  ('meplumb@gmail.com','fec','\bkatherine\s+harris\b','Right',88,'Katherine Harris (R)',40,'seed'),
  ('meplumb@gmail.com','fec','\b(?:rnc|gop)\b','Right',85,'RNC/GOP',50,'seed'),
  ('meplumb@gmail.com','fec','\bmaga\b','Right',82,'MAGA-affiliated',60,'seed'),
  ('meplumb@gmail.com','fec','\bconservative\b','Right',70,'Conservative committee',70,'seed'),
  ('meplumb@gmail.com','fec','\bliberty\b','Right',65,'Liberty-oriented PAC',80,'seed'),
  ('meplumb@gmail.com','fec','\(rep\)','Right',82,'recipient party code (REP)',90,'seed'),
  ('meplumb@gmail.com','fec','\bactblue\b','Left',90,'ActBlue conduit',110,'seed'),
  ('meplumb@gmail.com','fec','\bdemocrat(ic)?\b','Left',85,'Democratic committee/candidate',120,'seed'),
  ('meplumb@gmail.com','fec','\b(?:dnc|democratic national)\b','Left',85,'DNC',130,'seed'),
  ('meplumb@gmail.com','fec','\bbiden\b','Left',82,'Biden-affiliated',140,'seed'),
  ('meplumb@gmail.com','fec','\b(?:kamala\s+)?harris\s+(?:for|2024)\b','Left',80,'Harris campaign',150,'seed'),
  ('meplumb@gmail.com','fec','\bprogressive\b','Left',72,'Progressive committee',160,'seed'),
  ('meplumb@gmail.com','fec','\b(?:emily''?s list|moveon)\b','Left',78,'Progressive advocacy PAC',170,'seed'),
  ('meplumb@gmail.com','fec','\(dem\)','Left',82,'recipient party code (DEM)',180,'seed'),
  ('meplumb@gmail.com','fec','\(dfl\)','Left',82,'recipient party code (DFL — Democratic affiliate)',190,'seed'),
  ('meplumb@gmail.com','fec','\b(?:bipartisan|nonpartisan|independent)\b','Independent',55,'Nonpartisan committee',300,'seed'),
  -- fl scope: lib/committee-lean/infer.ts order (Right → Left)
  ('meplumb@gmail.com','fl','\brepublican\b','Right',85,'Republican committee/candidate',10,'seed'),
  ('meplumb@gmail.com','fl','\b(?:rpo|rpoa|republican party of florida)\b','Right',88,'Republican Party of Florida',20,'seed'),
  ('meplumb@gmail.com','fl','\bwinred\b','Right',90,'WinRed conduit',30,'seed'),
  ('meplumb@gmail.com','fl','\bgop\b','Right',85,'GOP',40,'seed'),
  ('meplumb@gmail.com','fl','\bconservative\b','Right',70,'Conservative committee',50,'seed'),
  ('meplumb@gmail.com','fl','\(rep\)','Right',82,'FL recipient (REP)',60,'seed'),
  ('meplumb@gmail.com','fl','\(pty\).*republican','Right',88,'Republican party committee (PTY)',70,'seed'),
  ('meplumb@gmail.com','fl','\bflorida house republican\b','Right',85,'Florida House Republican',80,'seed'),
  ('meplumb@gmail.com','fl','\btrump\b','Right',88,'Trump-affiliated recipient',90,'seed'),
  ('meplumb@gmail.com','fl','\bdemocrat(ic)?\b','Left',85,'Democratic committee/candidate',110,'seed'),
  ('meplumb@gmail.com','fl','\b(?:fdp|florida democratic)\b','Left',88,'Florida Democratic Party',120,'seed'),
  ('meplumb@gmail.com','fl','\bactblue\b','Left',90,'ActBlue conduit',130,'seed'),
  ('meplumb@gmail.com','fl','\bprogressive\b','Left',72,'Progressive committee',140,'seed'),
  ('meplumb@gmail.com','fl','\(dem\)','Left',82,'FL recipient (DEM)',150,'seed'),
  ('meplumb@gmail.com','fl','\b(?:dnc|democratic national)\b','Left',85,'DNC',160,'seed'),
  ('meplumb@gmail.com','fl','\bbiden\b','Left',82,'Biden-affiliated',170,'seed')
ON CONFLICT (user_id, scope, pattern) DO NOTHING;
