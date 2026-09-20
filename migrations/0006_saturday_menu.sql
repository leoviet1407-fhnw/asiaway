-- The Saturday menu.
--
-- Two things the restaurant asked for on 2026-09-20: a special dish that
-- changes every Saturday, at CHF 33.50, with its own photograph; and Bánh Mì,
-- which is always on the menu on a Saturday, at CHF 14.50.

-- Which days a dish is sold on, as ISO-8601 weekday numbers (Monday 1 …
-- Sunday 7), so Saturday is 6. NULL means every day, which is almost every
-- dish — a column that had to be filled in for all 106 existing items would be
-- 106 chances to get one wrong.
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS available_weekdays smallint[];

ALTER TABLE menu_items
  DROP CONSTRAINT IF EXISTS menu_items_available_weekdays_valid;
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_available_weekdays_valid CHECK (
    available_weekdays IS NULL
    OR (
      array_length(available_weekdays, 1) BETWEEN 1 AND 7
      AND available_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    )
  );

-- One row per Saturday: the dish that week, in all three languages, and its
-- photograph.
--
-- The photograph lives in the database rather than on disk because the
-- application runs on a read-only serverless filesystem, and because a weekly
-- upload by restaurant staff must not require a deployment. At one downscaled
-- photo a week this is a few hundred kilobytes a year.
CREATE TABLE IF NOT EXISTS weekly_specials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Saturday this dish is served on. One special per day.
  service_date    date NOT NULL UNIQUE,
  menu_item_id    uuid NOT NULL REFERENCES menu_items(id),
  name_en         text NOT NULL,
  name_de         text NOT NULL,
  name_vi         text NOT NULL,
  description_en  text NOT NULL DEFAULT '',
  description_de  text NOT NULL DEFAULT '',
  description_vi  text NOT NULL DEFAULT '',
  image_data      bytea NOT NULL,
  image_mime      text  NOT NULL,
  -- Lets a phone cache the photo and revalidate cheaply.
  image_etag      text  NOT NULL,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weekly_specials_date_idx ON weekly_specials (service_date DESC);

-- A row must be for a Saturday. Without this a typo puts the special on a
-- Tuesday, where nothing will ever show it and nobody will know why.
ALTER TABLE weekly_specials
  DROP CONSTRAINT IF EXISTS weekly_specials_is_saturday;
ALTER TABLE weekly_specials
  ADD CONSTRAINT weekly_specials_is_saturday CHECK (EXTRACT(ISODOW FROM service_date) = 6);
