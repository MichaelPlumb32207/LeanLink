-- Prefix-matching index for FL contribution entity lookups (DEF-008). The
-- layer-2 lookup matched contributor_name_norm with a leading-wildcard LIKE
-- over 14.2M rows — up to 3× per voter, several seconds each (the third member
-- of the leading-wildcard family after DEF-005/006's regexes and DEF-007's
-- officer lookup). The query now uses exact-or-PREFIX matching, which this
-- text_pattern_ops index serves. Additive and re-runnable.

CREATE INDEX IF NOT EXISTS idx_fl_contrib_name_prefix
  ON fl_contributions (snapshot_id, contributor_name_norm text_pattern_ops);
