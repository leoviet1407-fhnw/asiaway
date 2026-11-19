-- Personal details every staff member fills in once (first login) and can update later.
-- Only the person themself and admins can read a row (enforced in the service).
CREATE TABLE staff_onboarding (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  private_email    text NOT NULL,
  mobile           text NOT NULL,
  birth_date       date NOT NULL,
  street           text NOT NULL,
  zip              text NOT NULL,
  city             text NOT NULL,
  nationality      text,
  iban             text NOT NULL,
  ahv_number       text,
  emergency_name   text,
  emergency_phone  text,
  completed_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
