-- Only the Leitung with the PLANNER role makes the roster; staff ask for changes in the app.
ALTER TYPE role ADD VALUE IF NOT EXISTS 'PLANNER';

CREATE TABLE change_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  -- SHIFT_CHANGE: other times for a planned shift. SHIFT_CANCEL: cannot work it.
  -- WORKED_TIME: the hours actually worked differ from the plan (or extra hours).
  kind          text NOT NULL CHECK (kind IN ('SHIFT_CHANGE', 'SHIFT_CANCEL', 'WORKED_TIME')),
  shift_id      uuid,
  work_date     date NOT NULL,
  start_min     integer,
  end_min       integer,
  break_min     integer NOT NULL DEFAULT 0,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_requests_status_idx ON change_requests (status, created_at);
CREATE INDEX change_requests_user_idx ON change_requests (user_id, created_at);
