-- A usual station and usual times per person (used by "Plan vorschlagen"), and a phone number
-- for the WhatsApp links.
ALTER TABLE staff_profiles ADD COLUMN usual_station text;
ALTER TABLE staff_profiles ADD COLUMN usual_from_min integer;
ALTER TABLE staff_profiles ADD COLUMN usual_to_min integer;
ALTER TABLE staff_profiles ADD COLUMN phone text;
