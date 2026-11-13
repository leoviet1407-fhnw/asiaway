-- Managers (Belle, Xuan) and a few others work at both sites. Their main site stays in
-- staff_profiles.site; extra_sites lists the other roster sites they can be planned at.
ALTER TABLE staff_profiles ADD COLUMN extra_sites text[] NOT NULL DEFAULT '{}';
