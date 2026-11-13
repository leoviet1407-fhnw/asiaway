-- Some people work at a site only on certain weekdays (e.g. Belle at Oerlikon only on Saturdays).
-- No rows for a person and site = no restriction. weekday: 1 = Monday … 7 = Sunday.
CREATE TABLE site_days (
  user_id uuid    NOT NULL,
  site    text    NOT NULL,
  weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  PRIMARY KEY (user_id, site, weekday)
);
