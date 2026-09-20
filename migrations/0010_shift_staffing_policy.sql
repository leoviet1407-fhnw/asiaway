-- =============================================================================
-- Carry the template's staffing policy onto the shift it generates.
--
-- 0009 let a template override its station: the food pass is "Kellner selbst"
-- at lunch and staffed at dinner, which the September plan could only say in
-- prose. But the validator reads the STATION's policy, so those lunch bands
-- were still counted as understaffed — the override was written and never read.
--
-- Nullable: NULL means "whatever the station says", which is the normal case.
-- =============================================================================

ALTER TABLE shifts ADD COLUMN staffing_policy station_staffing_policy;

COMMENT ON COLUMN shifts.staffing_policy IS
  'Overrides stations.staffing_policy for this shift alone. NULL = inherit.';
