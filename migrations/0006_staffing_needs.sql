-- How many people each site needs per weekday, for Lunch and for Dinner.
-- It is compared with what staff offered and with the roster. weekday: 1 = Monday … 7 = Sunday.
CREATE TABLE staffing_needs (
  site          text NOT NULL,
  weekday       integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  lunch_people  integer NOT NULL DEFAULT 0 CHECK (lunch_people BETWEEN 0 AND 60),
  dinner_people integer NOT NULL DEFAULT 0 CHECK (dinner_people BETWEEN 0 AND 60),
  PRIMARY KEY (site, weekday)
);
