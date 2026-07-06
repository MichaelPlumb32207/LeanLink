-- The REAL Sunbiz lookup index (DEF-007). The officer lookup matches
-- officer_name_norm with a leading-wildcard LIKE ('%<last>%'), which no btree
-- can serve — migration 015's name index never helped the actual query shape.
-- But the lookup already restricts to the voter's zip5, so (snapshot_id,
-- officer_zip5) narrows each probe to a few hundred rows and the LIKE runs as
-- an in-memory filter. Additive and re-runnable.

CREATE INDEX IF NOT EXISTS idx_sunbiz_officer_zip
  ON sunbiz_officers (snapshot_id, officer_zip5);
