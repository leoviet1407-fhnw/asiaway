-- Past shifts of published weeks count as worked "as planned" automatically: the app creates the
-- time entry itself, so a shift can never have two of them.
CREATE UNIQUE INDEX time_entries_shift_uniq ON time_entries (shift_id) WHERE shift_id IS NOT NULL;
