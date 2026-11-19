-- A private link per person for subscribing to their own shifts in a calendar app
-- (Apple Calendar, Google Calendar). The token is the only key, so it is long and random.
ALTER TABLE users ADD COLUMN calendar_token text UNIQUE;
