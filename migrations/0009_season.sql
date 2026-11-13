-- A fixed weekly pattern per person (the "Standardwoche"), special days with their own staffing
-- need (holidays, Silvester, closed days) and limits on how many people may be on holiday at once.
CREATE TABLE availability_patterns (
  user_id   uuid    NOT NULL,
  weekday   integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  kind      text    NOT NULL CHECK (kind IN ('AVAILABLE', 'UNAVAILABLE')),
  from_min  integer,
  to_min    integer,
  PRIMARY KEY (user_id, weekday)
);

CREATE TABLE special_days (
  site         text    NOT NULL,
  work_date    date    NOT NULL,
  label        text    NOT NULL,
  closed       boolean NOT NULL DEFAULT false,
  lunch_people integer NOT NULL DEFAULT 0,
  dinner_people integer NOT NULL DEFAULT 0,
  PRIMARY KEY (site, work_date)
);

CREATE TABLE vacation_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site        text    NOT NULL,
  start_date  date    NOT NULL,
  end_date    date    NOT NULL,
  label       text    NOT NULL,
  max_people  integer NOT NULL CHECK (max_people >= 0),
  CHECK (end_date >= start_date)
);
CREATE INDEX vacation_rules_site_idx ON vacation_rules (site, start_date);
