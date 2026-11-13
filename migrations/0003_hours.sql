-- Vacation balance, overtime opening balance, and the hours staff actually worked.

-- One row per person and year. No row = defaults (25 vacation days, nothing carried over).
CREATE TABLE yearly_balances (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year               integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  vacation_days      numeric(5,1) NOT NULL DEFAULT 25 CHECK (vacation_days >= 0),
  vacation_carry     numeric(5,1) NOT NULL DEFAULT 0,
  overtime_carry_min integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year)
);

-- What was really worked. shift_id links an entry to the planned shift it confirms.
CREATE TABLE time_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date  date NOT NULL,
  start_min  integer NOT NULL CHECK (start_min >= 0),
  end_min    integer NOT NULL,
  break_min  integer NOT NULL DEFAULT 0 CHECK (break_min >= 0),
  shift_id   uuid REFERENCES shifts(id) ON DELETE SET NULL,
  note       text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_min > start_min AND end_min <= 1800 AND break_min < end_min - start_min)
);
CREATE INDEX time_entries_user_date ON time_entries (user_id, work_date);
CREATE UNIQUE INDEX time_entries_one_per_shift ON time_entries (shift_id) WHERE shift_id IS NOT NULL;

-- The Leitung approves a person's month; afterwards the entries are locked.
CREATE TABLE time_month_approvals (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);
