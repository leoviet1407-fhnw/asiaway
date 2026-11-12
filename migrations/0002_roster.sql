-- Dienstplan (staff roster): team profiles, shifts per week, availability and
-- holidays submitted a month ahead.
-- A roster covers a SITE ('oerlikon' | 'winterthur'): in Winterthur the Thai and
-- the Vietnamese restaurant share the same staff and one plan.

CREATE TYPE employment_type AS ENUM ('FULL_TIME', 'PART_TIME', 'ON_CALL', 'MANAGEMENT');
CREATE TYPE roster_week_status AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE availability_kind AS ENUM ('AVAILABLE', 'UNAVAILABLE');
CREATE TYPE absence_type AS ENUM ('VACATION', 'SICK', 'OTHER');
CREATE TYPE absence_status AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

CREATE TABLE staff_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  site            text NOT NULL,
  employment_type employment_type NOT NULL,
  pensum_percent  integer CHECK (pensum_percent BETWEEN 1 AND 100),
  active          boolean NOT NULL DEFAULT true,
  sort            integer NOT NULL DEFAULT 0,
  -- contracts state a percentage; Aushilfen and the management have none
  CHECK ((employment_type IN ('FULL_TIME', 'PART_TIME')) = (pensum_percent IS NOT NULL))
);
CREATE INDEX staff_profiles_site ON staff_profiles (site);

CREATE TABLE roster_weeks (
  site         text NOT NULL,
  week_start   date NOT NULL,
  status       roster_week_status NOT NULL DEFAULT 'DRAFT',
  published_by uuid REFERENCES users(id),
  published_at timestamptz,
  PRIMARY KEY (site, week_start)
);

-- user_id NULL = an open shift nobody has been given yet.
-- Times are minutes after midnight of work_date; an end above 1440 is after midnight.
CREATE TABLE shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site        text NOT NULL,
  work_date   date NOT NULL,
  user_id     uuid REFERENCES users(id),
  start_min   integer NOT NULL CHECK (start_min >= 0),
  end_min     integer NOT NULL,
  break_min   integer NOT NULL DEFAULT 0 CHECK (break_min >= 0),
  station     text NOT NULL,
  role_label  text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_min > start_min AND end_min <= 1800 AND break_min < end_min - start_min)
);
CREATE INDEX shifts_site_date ON shifts (site, work_date);
CREATE INDEX shifts_user_date ON shifts (user_id, work_date);

-- One row per person and day. from/to NULL = the whole day.
CREATE TABLE availability (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date  date NOT NULL,
  kind       availability_kind NOT NULL,
  from_min   integer,
  to_min     integer,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date),
  CHECK ((from_min IS NULL) = (to_min IS NULL) AND (from_min IS NULL OR to_min > from_min))
);

-- "I am done for this month": lets the planner see who has reported.
CREATE TABLE availability_submissions (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month        text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

CREATE TABLE absences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  type         absence_type NOT NULL,
  status       absence_status NOT NULL DEFAULT 'REQUESTED',
  note         text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL REFERENCES users(id),
  decided_by   uuid REFERENCES users(id),
  decided_at   timestamptz,
  CHECK (end_date >= start_date)
);
CREATE INDEX absences_user ON absences (user_id, start_date);
