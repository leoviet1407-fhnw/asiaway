-- AsiaWay staff app, Phase 1: suppliers, items, orders, goods-in.
-- Forward-only. The Drizzle schema in src/server/db/schema.ts mirrors this file.

CREATE TYPE role AS ENUM ('STAFF', 'ORDERER', 'ADMIN');
CREATE TYPE storage_area AS ENUM ('COLD', 'FREEZER', 'DRY', 'BAR');
CREATE TYPE order_channel AS ENUM ('EMAIL', 'WHATSAPP', 'PORTAL');
CREATE TYPE order_status AS ENUM ('DRAFT', 'SUBMITTED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
CREATE TYPE receipt_status AS ENUM ('OPEN', 'COMPLETED');
CREATE TYPE photo_kind AS ENUM ('DELIVERY_NOTE', 'DAMAGE');

CREATE TABLE locations (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  short_name  text NOT NULL,
  address     text NOT NULL,
  delivery_note text,
  sort        integer NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

-- location_id NULL = all locations (Orderer, Admin).
CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        role NOT NULL,
  location_id text REFERENCES locations(id)
);
CREATE UNIQUE INDEX user_roles_unique ON user_roles (user_id, role, coalesce(location_id, '*'));

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE login_attempts (
  id           bigserial PRIMARY KEY,
  email_lower  text NOT NULL,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email ON login_attempts (email_lower, attempted_at);

CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  order_email     text NOT NULL,
  cc_email        text,
  phone           text,
  order_channel   order_channel NOT NULL DEFAULT 'EMAIL',
  delivery_days   text NOT NULL DEFAULT '',
  cutoff_note     text,
  min_order_cents integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  customer_number text,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          text NOT NULL UNIQUE,
  name_de      text NOT NULL,
  name_vi      text,
  storage_area storage_area NOT NULL DEFAULT 'DRY',
  stock_unit   text NOT NULL DEFAULT 'Stk',
  is_fresh     boolean NOT NULL DEFAULT false,
  is_key_item  boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One item can carry several codes (single piece, case, other brand).
-- units_per_scan is in ORDER units: case = 1, one bottle of 12 = 0.0833.
CREATE TABLE item_barcodes (
  code           text PRIMARY KEY,
  item_id        uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  units_per_scan numeric(10,4) NOT NULL DEFAULT 1 CHECK (units_per_scan > 0),
  label          text
);
CREATE INDEX item_barcodes_item ON item_barcodes (item_id);

CREATE TABLE supplier_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  supplier_sku text,
  order_unit   text NOT NULL,
  pack_size    numeric(10,3) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  price_cents  integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  active       boolean NOT NULL DEFAULT true,
  UNIQUE (supplier_id, item_id)
);

CREATE SEQUENCE purchase_order_number_seq;

CREATE TABLE purchase_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text NOT NULL UNIQUE,
  location_id   text NOT NULL REFERENCES locations(id),
  supplier_id   uuid NOT NULL REFERENCES suppliers(id),
  status        order_status NOT NULL DEFAULT 'DRAFT',
  delivery_date date,
  note          text,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  submitted_by  uuid REFERENCES users(id),
  submitted_at  timestamptz,
  sent_by       uuid REFERENCES users(id),
  sent_at       timestamptz,
  sent_to       text,
  sent_pdf      bytea,
  closed_at     timestamptz
);
-- At most one open draft per location and supplier.
CREATE UNIQUE INDEX purchase_orders_one_draft
  ON purchase_orders (location_id, supplier_id) WHERE status = 'DRAFT';
CREATE INDEX purchase_orders_status ON purchase_orders (status, location_id);

CREATE TABLE purchase_order_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES items(id),
  supplier_item_id uuid REFERENCES supplier_items(id),
  qty              numeric(10,3) NOT NULL CHECK (qty > 0),
  order_unit       text NOT NULL,
  unit_price_cents integer NOT NULL DEFAULT 0,
  supplier_sku     text,
  note             text,
  UNIQUE (order_id, item_id)
);

CREATE TABLE receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES purchase_orders(id),
  status       receipt_status NOT NULL DEFAULT 'OPEN',
  started_by   uuid NOT NULL REFERENCES users(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  closed_order boolean NOT NULL DEFAULT false,
  note         text
);
CREATE UNIQUE INDEX receipts_one_open ON receipts (order_id) WHERE status = 'OPEN';

-- item_id NULL = an unknown barcode, kept by its code.
CREATE TABLE receipt_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id   uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  item_id      uuid REFERENCES items(id),
  scanned_code text,
  qty          numeric(10,3) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  damaged      boolean NOT NULL DEFAULT false,
  note         text,
  updated_by   uuid REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (item_id IS NOT NULL OR scanned_code IS NOT NULL)
);
CREATE UNIQUE INDEX receipt_lines_item ON receipt_lines (receipt_id, item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX receipt_lines_unknown ON receipt_lines (receipt_id, scanned_code) WHERE item_id IS NULL;

CREATE TABLE receipt_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id  uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  kind        photo_kind NOT NULL,
  mime        text NOT NULL,
  data        bytea NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_log (
  id         bigserial PRIMARY KEY,
  order_id   uuid REFERENCES purchase_orders(id),
  to_email   text NOT NULL,
  cc_email   text,
  subject    text NOT NULL,
  body       text NOT NULL,
  transport  text NOT NULL,
  message_id text,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

-- Append-only: who changed what.
CREATE TABLE audit_events (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_entity ON audit_events (entity, entity_id);
