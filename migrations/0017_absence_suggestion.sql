-- Holiday requests: when the Leitung says no, a short reason and other days they suggest.
-- The employee then takes the suggestion, asks for other days, or drops the holiday.
ALTER TABLE absences ADD COLUMN decision_note text;
ALTER TABLE absences ADD COLUMN suggested_start date;
ALTER TABLE absences ADD COLUMN suggested_end date;
