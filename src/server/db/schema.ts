/**
 * Drizzle schema — the typed query surface.
 *
 * The DDL in migrations/0000_init.sql is the source of truth; this mirrors it.
 * tests/integration/schema-drift.test.ts applies the SQL and then reads every
 * table through these definitions, so the two cannot silently diverge.
 */
import {
  bigint,
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRole = pgEnum('user_role', ['WAITER']);
export const categoryKind = pgEnum('category_kind', ['FOOD', 'DRINK']);
export const tableGroupStatus = pgEnum('table_group_status', ['ACTIVE', 'DISSOLVED']);
export const qrPolicy = pgEnum('qr_policy', ['ANY_MEMBER', 'PRIMARY_ONLY']);
export const sessionStatus = pgEnum('session_status', [
  'OCCUPIED',
  'ORDER_PENDING',
  'CHECKOUT_REQUESTED',
  'CLOSED',
]);
export const orderStatus = pgEnum('order_status', [
  'SUBMITTED',
  'EMPLOYEE_REVIEW',
  'CONFIRMED',
  'CANCELLED',
]);
export const noteSource = pgEnum('note_source', ['CUSTOMER', 'WAITER']);
export const revisionType = pgEnum('revision_type', [
  'ORIGINAL_SUBMISSION',
  'WAITER_EDIT',
  'FINAL_CONFIRMED',
  'CANCELLATION',
]);
export const actorType = pgEnum('actor_type', ['CUSTOMER', 'WAITER', 'SYSTEM']);
export const notificationType = pgEnum('notification_type', [
  'NEW_ORDER',
  'CHECKOUT_REQUESTED',
  'ORDER_UPDATED',
]);
export const notificationStatus = pgEnum('notification_status', ['PENDING', 'ACKNOWLEDGED']);
export const idempotencyState = pgEnum('idempotency_state', ['IN_PROGRESS', 'COMPLETED']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  role: userRole('role').notNull().default('WAITER'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const allergens = pgTable('allergens', {
  code: char('code', { length: 1 }).primaryKey(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  nameVi: text('name_vi').notNull(),
});

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    kind: categoryKind('kind').notNull(),
    nameEn: text('name_en').notNull(),
    nameDe: text('name_de').notNull(),
    nameVi: text('name_vi').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ kindSort: index('menu_categories_kind_sort_idx').on(t.kind, t.sortOrder) }),
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => menuCategories.id),
    dishNumber: text('dish_number'),
    externalKey: text('external_key').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameDe: text('name_de').notNull(),
    nameVi: text('name_vi').notNull(),
    descriptionEn: text('description_en').notNull(),
    descriptionDe: text('description_de').notNull(),
    descriptionVi: text('description_vi').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('CHF'),
    allergenCodes: text('allergen_codes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    imagePath: text('image_path'),
    sortOrder: integer('sort_order').notNull(),
    isAvailable: boolean('is_available').notNull().default(true),
    availabilityChangedAt: timestamp('availability_changed_at', { withTimezone: true }),
    availabilityChangedBy: uuid('availability_changed_by').references(() => users.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ categorySort: index('menu_items_category_sort_idx').on(t.categoryId, t.sortOrder) }),
);

export const restaurantTables = pgTable('restaurant_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableNumber: text('table_number').notNull().unique(),
  displayName: text('display_name').notNull(),
  qrToken: text('qr_token').notNull().unique(),
  qrTokenVersion: integer('qr_token_version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tableGroups = pgTable('table_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupName: text('group_name'),
  status: tableGroupStatus('status').notNull().default('ACTIVE'),
  qrPolicy: qrPolicy('qr_policy').notNull().default('ANY_MEMBER'),
  anchorTableId: uuid('anchor_table_id').references(() => restaurantTables.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  dissolvedAt: timestamp('dissolved_at', { withTimezone: true }),
});

export const tableGroupMembers = pgTable('table_group_members', {
  tableGroupId: uuid('table_group_id')
    .notNull()
    .references(() => tableGroups.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id')
    .notNull()
    .references(() => restaurantTables.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
});

export const diningSessions = pgTable(
  'dining_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionNumber: bigint('session_number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('session_number_seq')`),
    primaryTableId: uuid('primary_table_id')
      .notNull()
      .references(() => restaurantTables.id),
    tableGroupId: uuid('table_group_id').references(() => tableGroups.id),
    status: sessionStatus('status').notNull().default('OCCUPIED'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    checkoutRequestedAt: timestamp('checkout_requested_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id),
    closeReason: text('close_reason'),
  },
  (t) => ({ statusIdx: index('dining_sessions_status_idx').on(t.status) }),
);

export const customerDevices = pgTable('customer_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => diningSessions.id),
  deviceTokenHash: text('device_token_hash').notNull().unique(),
  userAgentHash: text('user_agent_hash'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: bigint('order_number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('order_number_seq')`),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => diningSessions.id),
    tableId: uuid('table_id')
      .notNull()
      .references(() => restaurantTables.id),
    status: orderStatus('status').notNull().default('SUBMITTED'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    submittedByDeviceId: uuid('submitted_by_device_id').references(() => customerDevices.id),
    openedByWaiterAt: timestamp('opened_by_waiter_at', { withTimezone: true }),
    openedBy: uuid('opened_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    totalCents: integer('total_cents').notNull(),
    currentRevisionNumber: integer('current_revision_number').notNull().default(0),
  },
  (t) => ({ statusIdx: index('orders_status_submitted_idx').on(t.status, t.submittedAt) }),
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: uuid('menu_item_id').references(() => menuItems.id),
    dishNumber: text('dish_number'),
    nameEn: text('name_en').notNull(),
    nameDe: text('name_de').notNull(),
    nameVi: text('name_vi').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
    allergenCodes: text('allergen_codes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    sortIndex: integer('sort_index').notNull().default(0),
  },
  (t) => ({ orderIdx: index('order_items_order_idx').on(t.orderId) }),
);

export const orderNotes = pgTable('order_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  noteText: text('note_text').notNull(),
  source: noteSource('source').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderRevisions = pgTable(
  'order_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    revisionNumber: integer('revision_number').notNull(),
    revisionType: revisionType('revision_type').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorDeviceId: uuid('actor_device_id').references(() => customerDevices.id),
    reason: text('reason'),
    beforeSnapshot: jsonb('before_snapshot'),
    afterSnapshot: jsonb('after_snapshot').notNull(),
    totalCentsBefore: integer('total_cents_before'),
    totalCentsAfter: integer('total_cents_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderRev: uniqueIndex('order_revisions_order_id_revision_number_key').on(
      t.orderId,
      t.revisionNumber,
    ),
  }),
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: actorType('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorDeviceId: uuid('actor_device_id').references(() => customerDevices.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    tableId: uuid('table_id').references(() => restaurantTables.id),
    sessionId: uuid('session_id').references(() => diningSessions.id),
    orderId: uuid('order_id').references(() => orders.id),
    beforeValue: jsonb('before_value'),
    afterValue: jsonb('after_value'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => ({ entityIdx: index('audit_events_entity_idx').on(t.entityType, t.entityId, t.occurredAt) }),
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: notificationType('type').notNull(),
    status: notificationStatus('status').notNull().default('PENDING'),
    sessionId: uuid('session_id').references(() => diningSessions.id),
    orderId: uuid('order_id').references(() => orders.id),
    tableId: uuid('table_id').references(() => restaurantTables.id),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
  },
  (t) => ({ pendingIdx: index('notifications_pending_idx').on(t.status, t.createdAt) }),
);

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  scope: text('scope').notNull(),
  sessionId: uuid('session_id').references(() => diningSessions.id),
  requestHash: text('request_hash').notNull(),
  state: idempotencyState('state').notNull().default('IN_PROGRESS'),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgentHash: text('user_agent_hash'),
});

export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  emailLower: text('email_lower').notNull(),
  ipHash: text('ip_hash'),
  succeeded: boolean('succeeded').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  users,
  allergens,
  menuCategories,
  menuItems,
  restaurantTables,
  tableGroups,
  tableGroupMembers,
  diningSessions,
  customerDevices,
  orders,
  orderItems,
  orderNotes,
  orderRevisions,
  auditEvents,
  notifications,
  idempotencyKeys,
  authSessions,
  loginAttempts,
};
