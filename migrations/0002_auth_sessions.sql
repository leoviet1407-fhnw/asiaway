-- =============================================================================
-- Waiter authentication sessions.
--
-- Only a SHA-256 hash of the cookie value is stored, so a database leak does
-- not hand over live sessions. Expiry is enforced in SQL as well as in code.
-- =============================================================================
CREATE TABLE auth_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  user_agent_hash text
);
CREATE INDEX auth_sessions_user_idx    ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx  ON auth_sessions (expires_at) WHERE revoked_at IS NULL;

-- Failed login attempts, for rate limiting and for the audit trail.
CREATE TABLE login_attempts (
  id           bigserial PRIMARY KEY,
  email_lower  text NOT NULL,
  ip_hash      text,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (email_lower, attempted_at);
CREATE INDEX login_attempts_ip_idx    ON login_attempts (ip_hash, attempted_at);
