-- =============================================================================
-- Workforce planning, phase B3: what actually happened.
--
-- The roster says what was planned. This records what was worked, so the two
-- can be compared — which is the thing the September 2026 Arbeitsplan could
-- never do, because a shift ending in "END" has no length to compare against.
--
-- PAY IS OUT OF SCOPE (Part 9 of the plan). There is no rate here, no wage, no
-- balance and no carry-over. What there is, deliberately, is every fact a pay
-- run would ever need, recorded at full fidelity: exact times, who changed
-- them, when, and why. The interpretation is deferred; the evidence is not.
-- =============================================================================

CREATE TYPE time_entry_source AS ENUM ('CLOCK', 'MANAGER', 'IMPORTED');
CREATE TYPE time_entry_state  AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'DISPUTED');

CREATE TABLE time_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** NULL for work nobody planned: a call-in, or staying past the close. */
  shift_id       uuid REFERENCES shifts(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  /** The day the work belongs to. A shift ending at 00:30 stays on its own day. */
  business_date  date NOT NULL,
  clock_in_at    timestamptz NOT NULL,
  clock_out_at   timestamptz,
  break_minutes  smallint NOT NULL DEFAULT 0,
  source         time_entry_source NOT NULL,
  state          time_entry_state NOT NULL DEFAULT 'OPEN',
  note           text,
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT time_entries_window CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at),
  CONSTRAINT time_entries_break  CHECK (break_minutes >= 0),
  -- OPEN means "still on the floor". The two cannot disagree: a finished entry
  -- is never OPEN, and a running one is never awaiting approval.
  CONSTRAINT time_entries_open_means_running
    CHECK ((state = 'OPEN') = (clock_out_at IS NULL)),
  CONSTRAINT time_entries_approval
    CHECK ((state = 'APPROVED') = (approved_at IS NOT NULL))
);

-- One person cannot be clocked in twice.
CREATE UNIQUE INDEX time_entries_one_open_idx ON time_entries (user_id) WHERE state = 'OPEN';
CREATE INDEX time_entries_person_idx ON time_entries (user_id, business_date);
CREATE INDEX time_entries_shift_idx  ON time_entries (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX time_entries_pending_idx ON time_entries (state, business_date)
  WHERE state IN ('SUBMITTED', 'DISPUTED');

-- ---------- corrections -------------------------------------------------------
-- Append-only, full snapshots, the same shape as order_revisions: "what did
-- this entry say before someone changed it" is one row read, with no replay.
-- A wage dispute turns on exactly this trail, so it outlives the entry.
CREATE TABLE time_entry_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id    uuid NOT NULL REFERENCES time_entries(id),
  revision_number  integer NOT NULL,
  actor_user_id    uuid REFERENCES users(id),
  reason           text,
  before_snapshot  jsonb,
  after_snapshot   jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entry_revisions_unique UNIQUE (time_entry_id, revision_number)
);
CREATE INDEX time_entry_revisions_entry_idx ON time_entry_revisions (time_entry_id, revision_number);

-- The same guard the order history has: corrections are new rows, never edits.
CREATE TRIGGER time_entry_revisions_append_only
  BEFORE UPDATE OR DELETE ON time_entry_revisions
  FOR EACH ROW EXECUTE FUNCTION refuse_history_mutation();

-- ---------- the month's answer -------------------------------------------------
-- Note what is NOT here: no balance, no carry-over, no money. A balance is an
-- interpretation of these numbers under a pay rule, and no pay rule has been
-- chosen. Storing one would bake in a decision nobody has made. The inputs are
-- lossless, so whichever rule is chosen later applies to months already closed.
CREATE TABLE monthly_statements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id           uuid NOT NULL REFERENCES roster_periods(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id),
  /** The pensum corridor for this month. NULL for an Aushilfe, who is owed no hours. */
  target_min_minutes  integer,
  target_max_minutes  integer,
  planned_minutes     integer NOT NULL,
  worked_minutes      integer NOT NULL,
  absence_days        integer NOT NULL DEFAULT 0,
  closed_at           timestamptz NOT NULL DEFAULT now(),
  closed_by           uuid REFERENCES users(id),
  CONSTRAINT monthly_statements_unique UNIQUE (period_id, user_id),
  CONSTRAINT monthly_statements_target
    CHECK ((target_min_minutes IS NULL) = (target_max_minutes IS NULL))
);
CREATE INDEX monthly_statements_person_idx ON monthly_statements (user_id);
