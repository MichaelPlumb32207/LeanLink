-- Sunbiz officer-name lookup index (ENH-001). The officer lookup filters on
-- (snapshot_id, officer_name_norm); without this index every voter lookup was
-- ten sequential scans of ~2M rows each (~7 s/voter — county scale infeasible).
-- Additive and re-runnable. Build takes a few minutes over ~20.6M rows.

CREATE INDEX IF NOT EXISTS idx_sunbiz_officer_name
  ON sunbiz_officers (snapshot_id, officer_name_norm);
