-- lean_results was UNIQUE (user_id, voter_hash), which forbids the same FL voter
-- (voterId-keyed hash) appearing on two uploads for one user — e.g. NPA research
-- extract + later GOTV re-ingest of the same county. FEC/fusion then aborts mid-run
-- with lean_results_user_id_voter_hash_key when the second upload settles.
--
-- Correct scope: one lean_results row per voter_record (per upload). Keep
-- UNIQUE (voter_record_id); replace global hash uniqueness with (upload_id, voter_hash).

ALTER TABLE lean_results
  DROP CONSTRAINT IF EXISTS lean_results_user_id_voter_hash_key;

-- Within an upload, hash remains unique (mirrors voter_records).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lean_results_upload_id_voter_hash_key'
  ) THEN
    ALTER TABLE lean_results
      ADD CONSTRAINT lean_results_upload_id_voter_hash_key
      UNIQUE (upload_id, voter_hash);
  END IF;
END $$;
