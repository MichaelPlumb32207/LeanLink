-- Posture guardrail (D-027): FL DOS voter-registration extracts are research-track
-- only — that data carries use restrictions that exclude commercial/marketing use,
-- so an upload sourced from the FL extract may never bill to (or deliver against) a
-- client account. The upload route already never attaches an account on that path;
-- this constraint makes the policy structural rather than behavioral.
-- Additive and re-runnable (DROP-then-ADD). Apply after 011.

ALTER TABLE voter_uploads DROP CONSTRAINT IF EXISTS voter_uploads_fl_extract_unbilled;
ALTER TABLE voter_uploads ADD CONSTRAINT voter_uploads_fl_extract_unbilled
  CHECK (source_type <> 'fl_extract' OR account_id IS NULL);
