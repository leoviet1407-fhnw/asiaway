-- =============================================================================
-- Asiaway QR Ordering — Phase 1 initial schema
--
-- Hand-written rather than generated, because the guarantees that matter here
-- ARE SQL behaviour: sequence-backed order numbers, append-only history
-- enforced by triggers, and "one open session per table" enforced by a partial
-- unique index. A generated schema cannot express any of those.
-- =============================================================================

-- ---------- enums -----------------------------------------------------------
CREATE TYPE user_role            AS ENUM ('WAITER');
CREATE TYPE category_kind        AS ENUM ('FOOD', 'DRINK');
CREATE TYPE table_group_status   AS ENUM ('ACTIVE', 'DISSOLVED');
CREATE TYPE qr_policy            AS ENUM ('ANY_MEMBER', 'PRIMARY_ONLY');
CREATE TYPE session_status       AS ENUM ('OCCUPIED', 'ORDER_PENDING', 'CHECKOUT_REQUESTED', 'CLOSED');
CREATE TYPE order_status         AS ENUM ('SUBMITTED', 'EMPLOYEE_REVIEW', 'CONFIRMED', 'CANCELLED');
CREATE TYPE note_source          AS ENUM ('CUSTOMER', 'WAITER');
CREATE TYPE revision_type        AS ENUM ('ORIGINAL_SUBMISSION', 'WAITER_EDIT', 'FINAL_CONFIRMED', 'CANCELLATION');
CREATE TYPE actor_type           AS ENUM ('CUSTOMER', 'WAITER', 'SYSTEM');
CREATE TYPE notification_type    AS ENUM ('NEW_ORDER', 'CHECKOUT_REQUESTED', 'ORDER_UPDATED');
CREATE TYPE notification_status  AS ENUM ('PENDING', 'ACKNOWLEDGED');
CREATE TYPE idempotency_state    AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- ---------- sequences -------------------------------------------------------
-- nextval() is atomic and does not block, so concurrent submissions from
-- several phones can never collide on an order number. Gaps after a rolled-back
-- transaction are expected and harmless.
CREATE SEQUENCE order_number_seq   START WITH 1001 INCREMENT BY 1;
CREATE SEQUENCE session_number_seq START WITH 1    INCREMENT BY 1;

-- ---------- users -----------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  password_hash  text NOT NULL,
  display_name   text NOT NULL,
  role           user_role NOT NULL DEFAULT 'WAITER',
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- ---------- menu ------------------------------------------------------------
CREATE TABLE allergens (
  code     char(1) PRIMARY KEY,
  name_en  text NOT NULL,
  name_de  text NOT NULL,
  name_vi  text NOT NULL
);

CREATE TABLE menu_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  kind        category_kind NOT NULL,
  name_en     text NOT NULL,
  name_de     text NOT NULL,
  name_vi     text NOT NULL,
  sort_order  integer NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_categories_kind_sort_idx ON menu_categories (kind, sort_order);

CREATE TABLE menu_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id              uuid NOT NULL REFERENCES menu_categories(id),
  -- Display label as printed ("90.1"). NOT unique in the source data, so it is
  -- never used as a key.
  dish_number              text,
  -- Stable key derived from the source row; makes re-import idempotent.
  external_key             text NOT NULL UNIQUE,
  name_en                  text NOT NULL,
  name_de                  text NOT NULL,
  name_vi                  text NOT NULL,
  description_en           text NOT NULL,
  description_de           text NOT NULL,
  description_vi           text NOT NULL,
  price_cents              integer NOT NULL CHECK (price_cents >= 0),
  currency                 char(3) NOT NULL DEFAULT 'CHF',
  allergen_codes           text[] NOT NULL DEFAULT '{}',
  -- NULL means "no photograph exists"; the UI then renders no image element at
  -- all rather than a placeholder.
  image_path               text,
  sort_order               integer NOT NULL,
  is_available             boolean NOT NULL DEFAULT true,
  availability_changed_at  timestamptz,
  availability_changed_by  uuid REFERENCES users(id),
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_items_category_sort_idx ON menu_items (category_id, sort_order);
CREATE INDEX menu_items_available_idx     ON menu_items (is_available) WHERE is_active;

-- ---------- tables, groups, sessions ----------------------------------------
CREATE TABLE restaurant_tables (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number      text NOT NULL UNIQUE,
  display_name      text NOT NULL,
  qr_token          text NOT NULL UNIQUE,
  qr_token_version  integer NOT NULL DEFAULT 1,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE table_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name        text,
  status            table_group_status NOT NULL DEFAULT 'ACTIVE',
  -- Restaurant rule (E4): the anchor is the lowest-numbered member table.
  qr_policy         qr_policy NOT NULL DEFAULT 'ANY_MEMBER',
  anchor_table_id   uuid REFERENCES restaurant_tables(id),
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  dissolved_at      timestamptz
);

CREATE TABLE table_group_members (
  table_group_id  uuid NOT NULL REFERENCES table_groups(id) ON DELETE CASCADE,
  table_id        uuid NOT NULL REFERENCES restaurant_tables(id),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  PRIMARY KEY (table_group_id, table_id)
);
-- A table can belong to at most one active group at a time.
CREATE UNIQUE INDEX table_group_members_active_table_idx
  ON table_group_members (table_id) WHERE left_at IS NULL;

CREATE TABLE dining_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number         bigint NOT NULL UNIQUE DEFAULT nextval('session_number_seq'),
  primary_table_id       uuid NOT NULL REFERENCES restaurant_tables(id),
  table_group_id         uuid REFERENCES table_groups(id),
  status                 session_status NOT NULL DEFAULT 'OCCUPIED',
  opened_at              timestamptz NOT NULL DEFAULT now(),
  last_activity_at       timestamptz NOT NULL DEFAULT now(),
  checkout_requested_at  timestamptz,
  closed_at              timestamptz,
  closed_by              uuid REFERENCES users(id),
  close_reason           text
);
-- "AVAILABLE" is the absence of an open session, enforced here rather than
-- stored, so the two can never disagree.
CREATE UNIQUE INDEX dining_sessions_one_open_per_table_idx
  ON dining_sessions (primary_table_id) WHERE status <> 'CLOSED';
CREATE INDEX dining_sessions_status_idx        ON dining_sessions (status);
CREATE INDEX dining_sessions_last_activity_idx ON dining_sessions (last_activity_at)
  WHERE status <> 'CLOSED';

-- Anonymous per-device record: lets several phones share one table session and
-- lets a submission be attributed without collecting any personal data.
CREATE TABLE customer_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES dining_sessions(id),
  device_token_hash  text NOT NULL UNIQUE,
  user_agent_hash    text,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_devices_session_idx ON customer_devices (session_id);

-- ---------- orders ----------------------------------------------------------
CREATE TABLE orders (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number              bigint NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),
  session_id                uuid NOT NULL REFERENCES dining_sessions(id),
  table_id                  uuid NOT NULL REFERENCES restaurant_tables(id),
  status                    order_status NOT NULL DEFAULT 'SUBMITTED',
  submitted_at              timestamptz NOT NULL DEFAULT now(),
  submitted_by_device_id    uuid REFERENCES customer_devices(id),
  opened_by_waiter_at       timestamptz,
  opened_by                 uuid REFERENCES users(id),
  confirmed_at              timestamptz,
  confirmed_by              uuid REFERENCES users(id),
  cancelled_at              timestamptz,
  cancelled_by              uuid REFERENCES users(id),
  cancel_reason             text,
  total_cents               integer NOT NULL CHECK (total_cents >= 0),
  current_revision_number   integer NOT NULL DEFAULT 0
);
CREATE INDEX orders_status_submitted_idx ON orders (status, submitted_at);
CREATE INDEX orders_session_idx          ON orders (session_id, submitted_at);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- Nullable so a menu item can be retired without rewriting history.
  menu_item_id      uuid REFERENCES menu_items(id),
  dish_number       text,
  -- Name, price and allergens are SNAPSHOTTED: later menu edits must never
  -- change what a guest actually ordered.
  name_en           text NOT NULL,
  name_de           text NOT NULL,
  name_vi           text NOT NULL,
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity          integer NOT NULL CHECK (quantity >= 1 AND quantity <= 99),
  line_total_cents  integer NOT NULL CHECK (line_total_cents >= 0),
  allergen_codes    text[] NOT NULL DEFAULT '{}',
  sort_index        integer NOT NULL DEFAULT 0
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  note_text   text NOT NULL CHECK (length(note_text) <= 500),
  source      note_source NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_notes_order_idx ON order_notes (order_id, created_at);

-- ---------- history: append-only -------------------------------------------
CREATE TABLE order_revisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id),
  revision_number     integer NOT NULL,
  revision_type       revision_type NOT NULL,
  actor_type          actor_type NOT NULL,
  actor_user_id       uuid REFERENCES users(id),
  actor_device_id     uuid REFERENCES customer_devices(id),
  reason              text,
  before_snapshot     jsonb,
  after_snapshot      jsonb NOT NULL,
  total_cents_before  integer,
  total_cents_after   integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, revision_number),
  -- Revision 0 is the original customer submission and has nothing before it.
  CONSTRAINT order_revisions_origin_chk CHECK (
    (revision_number = 0 AND before_snapshot IS NULL AND revision_type = 'ORIGINAL_SUBMISSION')
    OR (revision_number > 0 AND before_snapshot IS NOT NULL)
  )
);
CREATE INDEX order_revisions_order_idx ON order_revisions (order_id, revision_number);

CREATE TABLE audit_events (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_type      actor_type NOT NULL,
  actor_user_id   uuid REFERENCES users(id),
  actor_device_id uuid REFERENCES customer_devices(id),
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  table_id        uuid REFERENCES restaurant_tables(id),
  session_id      uuid REFERENCES dining_sessions(id),
  order_id        uuid REFERENCES orders(id),
  before_value    jsonb,
  after_value     jsonb,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_entity_idx   ON audit_events (entity_type, entity_id, occurred_at);
CREATE INDEX audit_events_session_idx  ON audit_events (session_id, occurred_at);
CREATE INDEX audit_events_order_idx    ON audit_events (order_id, occurred_at);
CREATE INDEX audit_events_occurred_idx ON audit_events (occurred_at DESC);

-- Layer 1 of append-only enforcement: triggers that refuse rewriting history.
-- Layer 2 (role grants) lives in 0001_grants.sql, which production applies.
-- Corrections are expressed as NEW rows, never as edits.
CREATE OR REPLACE FUNCTION refuse_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION refuse_history_mutation();

CREATE TRIGGER order_revisions_append_only
  BEFORE UPDATE OR DELETE ON order_revisions
  FOR EACH ROW EXECUTE FUNCTION refuse_history_mutation();

-- ---------- notifications ---------------------------------------------------
-- The server-side queue is authoritative; SSE is only a delivery accelerator,
-- so a waiter who was offline still sees everything on reconnect.
CREATE TABLE notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              notification_type NOT NULL,
  status            notification_status NOT NULL DEFAULT 'PENDING',
  session_id        uuid REFERENCES dining_sessions(id),
  order_id          uuid REFERENCES orders(id),
  table_id          uuid REFERENCES restaurant_tables(id),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  delivered_at      timestamptz,
  acknowledged_at   timestamptz,
  acknowledged_by   uuid REFERENCES users(id)
);
CREATE INDEX notifications_pending_idx ON notifications (status, created_at);

-- ---------- idempotency -----------------------------------------------------
CREATE TABLE idempotency_keys (
  key              text PRIMARY KEY,
  scope            text NOT NULL,
  session_id       uuid REFERENCES dining_sessions(id),
  request_hash     text NOT NULL,
  state            idempotency_state NOT NULL DEFAULT 'IN_PROGRESS',
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);
