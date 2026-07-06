-- Partial index for the unlabeled-committees counter (summary poll). Events
-- carry unresolved_committees as an EMPTY array when there are none, so the
-- predicate must test non-emptiness (a bare `payload ? 'unresolved_committees'`
-- matches every fl_contrib event and narrows nothing). Narrows the counter's
-- scan from every event in the upload (~146k at Duval scale, ~3 s/poll) to just
-- the events with actual unresolved committees (~hundreds). Additive and
-- re-runnable; the DROP clears the earlier too-broad version of this index.

DROP INDEX IF EXISTS idx_evidence_events_unresolved;
CREATE INDEX IF NOT EXISTS idx_evidence_events_unresolved
  ON evidence_events (upload_id, arm)
  WHERE payload -> 'unresolved_committees' <> '[]'::jsonb;
