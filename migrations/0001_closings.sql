-- Daily closing (Tagesabschluss): till count, card and mobile payments, expected
-- sales from the POS, the resulting difference/tips and the cash to bank.
-- Only INPUTS are stored (in cents); the sums are calculated when shown, so the
-- formulas can never disagree with the data.

CREATE TYPE closing_status AS ENUM ('SUBMITTED', 'APPROVED');

CREATE TABLE daily_closings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         text NOT NULL REFERENCES locations(id),
  business_date       date NOT NULL,
  station             text NOT NULL,
  status              closing_status NOT NULL DEFAULT 'SUBMITTED',
  cash_counted_cents  integer NOT NULL CHECK (cash_counted_cents >= 0),
  start_float_cents   integer NOT NULL CHECK (start_float_cents >= 0),
  eft_cents           integer NOT NULL CHECK (eft_cents >= 0),
  mobile_cents        integer NOT NULL DEFAULT 0 CHECK (mobile_cents >= 0),
  pos_gross_cents     integer NOT NULL CHECK (pos_gross_cents >= 0),
  note                text,
  closed_by           uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  approved_by         uuid REFERENCES users(id),
  approved_at         timestamptz,
  UNIQUE (location_id, business_date, station)
);
CREATE INDEX daily_closings_date ON daily_closings (business_date DESC);

CREATE TABLE closing_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id  uuid NOT NULL REFERENCES daily_closings(id) ON DELETE CASCADE,
  mime        text NOT NULL,
  data        bytea NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX closing_photos_closing ON closing_photos (closing_id);
