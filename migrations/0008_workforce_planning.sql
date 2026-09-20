-- =============================================================================
-- Workforce planning, phase B1: contracts, the venue's stations, the monthly
-- period, and the availability staff submit into it.
--
-- Shifts, the rule validator and time recording are B2/B3. This migration
-- builds only what they will stand on.
--
-- Background: docs/ASIAWAY_PHASE2_WORKFORCE_PLAN.md
-- =============================================================================

-- ---------- the house basis -------------------------------------------------
-- A contract at Asiaway states a PERCENTAGE, not a number of hours, and 100%
-- is a corridor of 40–42.5 h/week rather than a single figure. So the hours a
-- person owes are derived, never stored on the person:
--
--   target_corridor = pensum_percent x [min, max]
--
-- Versioned by validity rather than mutated, so a month recorded in 2026 is
-- still settled against the 2026 corridor after the corridor changes.
--
-- The corridor is used for PLANNING WARNINGS ONLY. It is not a pay rule; pay is
-- deliberately out of scope (see Part 9 of the plan).
CREATE TABLE work_time_policy (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valid_from               date NOT NULL,
  valid_to                 date,             -- NULL = the policy in force now
  weekly_hours_min_at_100  numeric(4,2) NOT NULL,
  weekly_hours_max_at_100  numeric(4,2) NOT NULL,
  default_shift_end        time NOT NULL,    -- retires the literal "END"
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_time_policy_band_ordered
    CHECK (weekly_hours_min_at_100 <= weekly_hours_max_at_100),
  CONSTRAINT work_time_policy_band_sane
    CHECK (weekly_hours_min_at_100 > 0 AND weekly_hours_max_at_100 <= 60),
  CONSTRAINT work_time_policy_period
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- Exactly one open-ended policy may exist. Indexing the constant true is the
-- standard way to say "at most one row matching this predicate"; a unique index
-- on valid_to would not work, because NULLs do not conflict with each other.
CREATE UNIQUE INDEX work_time_policy_current_idx ON work_time_policy ((true)) WHERE valid_to IS NULL;
CREATE UNIQUE INDEX work_time_policy_from_idx    ON work_time_policy (valid_from);

-- Confirmed by the restaurant, 2026-09-20: close at 22:00; 100% is 40–42.5 h.
INSERT INTO work_time_policy
  (valid_from, weekly_hours_min_at_100, weekly_hours_max_at_100, default_shift_end)
VALUES
  (DATE '2026-01-01', 40.00, 42.50, TIME '22:00');

-- ---------- contracts --------------------------------------------------------
CREATE TYPE employment_type AS ENUM ('FULL_TIME', 'PART_TIME', 'ON_CALL');

-- History, not a mutable row: a pensum change closes one row and opens another,
-- so last month still resolves against last month's contract.
CREATE TABLE employments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employment_type  employment_type NOT NULL,
  pensum_percent   numeric(5,2),
  valid_from       date NOT NULL,
  valid_to         date,                     -- NULL = the current contract
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- An Aushilfe has no pensum and is owed no hours; they are scheduled from the
  -- availability they submit. Everyone else has a pensum and is owed a corridor.
  -- Storing one without the other is the mistake this prevents.
  CONSTRAINT employments_pensum_matches_type CHECK (
    (employment_type =  'ON_CALL' AND pensum_percent IS NULL) OR
    (employment_type <> 'ON_CALL' AND pensum_percent IS NOT NULL)
  ),
  CONSTRAINT employments_pensum_range
    CHECK (pensum_percent IS NULL OR (pensum_percent > 0 AND pensum_percent <= 100)),
  CONSTRAINT employments_period
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX employments_current_idx ON employments (user_id) WHERE valid_to IS NULL;
CREATE INDEX        employments_user_idx    ON employments (user_id, valid_from);

-- ---------- the venue --------------------------------------------------------
-- SELF_SERVE is a first-class answer, not a blank cell. The September plan wrote
-- "Kellner selbst" into all 14 bar slots and left the 1. OG lunch rows empty,
-- and nothing could tell the two apart. Now it can.
CREATE TYPE station_staffing_policy AS ENUM ('STAFFED', 'SELF_SERVE', 'CLOSED');

CREATE TABLE stations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name_de          text NOT NULL,
  name_en          text NOT NULL,
  -- How the station is normally covered. A single time band may differ — the
  -- food pass is self-serve at lunch and staffed at dinner — and that belongs on
  -- the shift template in B2, which overrides this default.
  staffing_policy  station_staffing_policy NOT NULL DEFAULT 'STAFFED',
  sort_order       integer NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The stations as they appear on the September 2026 Arbeitsplan.
INSERT INTO stations (code, name_de, name_en, staffing_policy, sort_order) VALUES
  ('EG_ALACARTE',   'EG / Terrasse — à la carte',      'Ground floor / terrace — à la carte', 'STAFFED',    10),
  ('EG_BUBBLE_TEA', 'EG — Bubble Tea',                  'Ground floor — bubble tea',           'STAFFED',    20),
  ('BUFFET',        'Lunch-Buffet',                     'Lunch buffet',                        'STAFFED',    30),
  ('OG_ALACARTE',   '1. OG Pavillon — à la carte',      'First floor pavilion — à la carte',   'STAFFED',    40),
  ('BAR',           'Bar',                              'Bar',                                 'SELF_SERVE', 50),
  ('FOODPASS',      'Food-Pass / Foodrunner',           'Food pass / food runner',             'STAFFED',    60),
  ('CLEANING',      'Reinigung (Buffet, Reiskocher)',   'Cleaning (buffet, rice cooker)',      'STAFFED',    70),
  ('OFFICE',        'Office / Administration',          'Office / administration',             'STAFFED',    80);

-- ---------- the month --------------------------------------------------------
CREATE TYPE roster_period_state AS ENUM
  ('DRAFT', 'AVAILABILITY_OPEN', 'PLANNING', 'PUBLISHED', 'LOCKED');

CREATE TABLE roster_periods (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_on              date NOT NULL UNIQUE,
  ends_on                date NOT NULL,
  state                  roster_period_state NOT NULL DEFAULT 'DRAFT',
  availability_deadline  timestamptz,
  published_at           timestamptz,
  published_by           uuid REFERENCES users(id),
  locked_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_periods_period CHECK (ends_on > starts_on)
);

-- ---------- what staff submit -------------------------------------------------
CREATE TYPE availability_kind AS ENUM ('AVAILABLE', 'PREFERRED', 'UNAVAILABLE');

-- One row means "on this date, between these times, I am X".
--
-- The same row carries two different weights depending on the contract behind
-- it, and the validator in B2 reads it accordingly:
--
--   ON_CALL  — an OFFER, and binding on the planner. Rule R8a hard-blocks any
--              assignment outside it. This is the only route by which JENNY,
--              PATRICIA and DENNIS get on the roster at all.
--   FULL/PART— a PREFERENCE. The contract already obliges the hours, so R8b
--              warns and a manager may override with a recorded reason.
CREATE TABLE availability (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_id     uuid NOT NULL REFERENCES roster_periods(id) ON DELETE CASCADE,
  on_date       date NOT NULL,
  from_time     time NOT NULL,
  to_time       time NOT NULL,
  kind          availability_kind NOT NULL,
  note          text,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_window CHECK (to_time > from_time)
);

CREATE UNIQUE INDEX availability_slot_idx   ON availability (user_id, on_date, from_time);
CREATE INDEX        availability_period_idx ON availability (period_id, on_date);
CREATE INDEX        availability_user_idx   ON availability (user_id, on_date);

-- ---------- absence ------------------------------------------------------------
-- So that a blank row on the plan can only ever mean "not needed". The September
-- plan had one person with no shifts and no way to say why.
CREATE TYPE absence_type  AS ENUM ('VACATION', 'SICK', 'MILITARY', 'UNPAID', 'PUBLIC_HOLIDAY');
CREATE TYPE absence_state AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

CREATE TABLE absences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  absence_type  absence_type NOT NULL,
  state         absence_state NOT NULL DEFAULT 'REQUESTED',
  note          text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  CONSTRAINT absences_period CHECK (ends_on >= starts_on),
  -- A decided absence records when it was decided. Paid/unpaid is already
  -- distinguished by absence_type, so the later pay phase needs no backfill.
  CONSTRAINT absences_decision CHECK (
    (state =  'REQUESTED' AND decided_at IS NULL) OR
    (state <> 'REQUESTED' AND decided_at IS NOT NULL)
  )
);

CREATE INDEX absences_user_idx  ON absences (user_id, starts_on);
CREATE INDEX absences_range_idx ON absences (starts_on, ends_on) WHERE state = 'APPROVED';
