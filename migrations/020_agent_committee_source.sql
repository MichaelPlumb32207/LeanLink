-- ENH-018 Unit B: let the Grok committee classifier write labels with source
-- 'agent'. Agent labels fill gaps the deterministic party-code/pattern layer
-- can't reach (committees with no party suffix, e.g. Harris Victory Fund, The
-- Lincoln Project). Precedence — enforced in the source-aware upsert, not the
-- schema — is human ('researcher'/'import') > agent > pattern/party-code:
--   * the agent NEVER overwrites a human label,
--   * a human label always overrides + locks a committee against the agent.
-- Apply after 019. Additive and idempotent.

ALTER TABLE committee_lean_labels DROP CONSTRAINT IF EXISTS committee_lean_labels_source_check;
ALTER TABLE committee_lean_labels ADD CONSTRAINT committee_lean_labels_source_check
  CHECK (source IN ('researcher', 'import', 'agent'));
