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
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Postgres bytea. Drizzle has no built-in for it. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const userRole = pgEnum('user_role', ['WAITER', 'MANAGER', 'STAFF']);
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
  /** The guest may still change this order; the waiter cannot see it yet. */
  'AWAITING_CUSTOMER',
  'SUBMITTED',
  'EMPLOYEE_REVIEW',
  'CONFIRMED',
  'CANCELLED',
]);
export const noteSource = pgEnum('note_source', ['CUSTOMER', 'WAITER']);
export const revisionType = pgEnum('revision_type', [
  'ORIGINAL_SUBMISSION',
  'CUSTOMER_EDIT',
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
export const tableArea = pgEnum('table_area', ['INSIDE', 'OUTSIDE']);

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
    /** Serving size as printed on the drinks menu, e.g. "50 cl". NULL for food. */
    volume: text('volume'),
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
    /**
     * ISO-8601 weekday numbers (Monday 1 … Sunday 7) this dish is sold on.
     * NULL means every day, which is almost everything on the menu.
     */
    availableWeekdays: smallint('available_weekdays').array(),
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

/**
 * One row per Saturday: that week's special, in three languages, with its
 * photograph held in the database.
 *
 * The photo is stored here rather than on disk because the app runs on a
 * read-only serverless filesystem, and a weekly upload by restaurant staff must
 * not need a deployment.
 */
export const weeklySpecials = pgTable('weekly_specials', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The Saturday this dish is served on. One special per day. */
  serviceDate: date('service_date').notNull().unique(),
  menuItemId: uuid('menu_item_id')
    .notNull()
    .references(() => menuItems.id),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  nameVi: text('name_vi').notNull(),
  descriptionEn: text('description_en').notNull().default(''),
  descriptionDe: text('description_de').notNull().default(''),
  descriptionVi: text('description_vi').notNull().default(''),
  imageData: bytea('image_data').notNull(),
  imageMime: text('image_mime').notNull(),
  imageEtag: text('image_etag').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const restaurantTables = pgTable('restaurant_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableNumber: text('table_number').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** Where the table stands. NULL where the venue makes no distinction. */
  area: tableArea('area'),
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
    /** When the guest's own edit window closes. NULL for staff-taken orders. */
    customerWindowExpiresAt: timestamp('customer_window_expires_at', { withTimezone: true }),
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

// ---------------------------------------------------------------------------
// Workforce planning (B1). Mirrors migrations/0007 and /0008.
// ---------------------------------------------------------------------------

export const employmentType = pgEnum('employment_type', ['FULL_TIME', 'PART_TIME', 'ON_CALL']);
export const stationStaffingPolicy = pgEnum('station_staffing_policy', [
  'STAFFED',
  'SELF_SERVE',
  'CLOSED',
]);
export const rosterPeriodState = pgEnum('roster_period_state', [
  'DRAFT',
  'AVAILABILITY_OPEN',
  'PLANNING',
  'PUBLISHED',
  'LOCKED',
]);
export const availabilityKind = pgEnum('availability_kind', [
  'AVAILABLE',
  'PREFERRED',
  'UNAVAILABLE',
]);
export const absenceType = pgEnum('absence_type', [
  'VACATION',
  'SICK',
  'MILITARY',
  'UNPAID',
  'PUBLIC_HOLIDAY',
]);
export const absenceState = pgEnum('absence_state', ['REQUESTED', 'APPROVED', 'REJECTED']);

/**
 * The house basis a pensum percentage is measured against.
 *
 * 100% is a corridor (40–42.5 h/week), not a number, so hours are derived from
 * the percentage rather than stored per person. Versioned by validity: a month
 * is always settled against the policy that was in force during it.
 */
export const workTimePolicy = pgTable('work_time_policy', {
  id: uuid('id').primaryKey().defaultRandom(),
  validFrom: date('valid_from').notNull(),
  /** NULL marks the policy in force now; at most one such row exists. */
  validTo: date('valid_to'),
  weeklyHoursMinAt100: numeric('weekly_hours_min_at_100', { precision: 4, scale: 2 }).notNull(),
  weeklyHoursMaxAt100: numeric('weekly_hours_max_at_100', { precision: 4, scale: 2 }).notNull(),
  /** The default end of an evening shift. Retires the literal "END". */
  defaultShiftEnd: time('default_shift_end').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Contract history. A pensum change closes one row and opens the next. */
export const employments = pgTable(
  'employments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    employmentType: employmentType('employment_type').notNull(),
    /** NULL exactly when ON_CALL: an Aushilfe is owed no hours. */
    pensumPercent: numeric('pensum_percent', { precision: 5, scale: 2 }),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('employments_user_idx').on(t.userId, t.validFrom) }),
);

export const stations = pgTable('stations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  nameDe: text('name_de').notNull(),
  nameEn: text('name_en').notNull(),
  /** SELF_SERVE is an answer ("Kellner selbst"); an empty roster cell is not. */
  staffingPolicy: stationStaffingPolicy('staffing_policy').notNull().default('STAFFED'),
  sortOrder: integer('sort_order').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rosterPeriods = pgTable('roster_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  startsOn: date('starts_on').notNull().unique(),
  endsOn: date('ends_on').notNull(),
  state: rosterPeriodState('state').notNull().default('DRAFT'),
  availabilityDeadline: timestamp('availability_deadline', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by').references(() => users.id),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What a person says about a date. Binding on the planner for ON_CALL staff,
 * advisory for everyone whose contract already obliges the hours.
 */
export const availability = pgTable(
  'availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => rosterPeriods.id, { onDelete: 'cascade' }),
    onDate: date('on_date').notNull(),
    fromTime: time('from_time').notNull(),
    toTime: time('to_time').notNull(),
    kind: availabilityKind('kind').notNull(),
    note: text('note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slot: uniqueIndex('availability_slot_idx').on(t.userId, t.onDate, t.fromTime),
    periodIdx: index('availability_period_idx').on(t.periodId, t.onDate),
    userIdx: index('availability_user_idx').on(t.userId, t.onDate),
  }),
);

/** So that an empty row on the roster can only ever mean "not needed". */
export const absences = pgTable(
  'absences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    absenceType: absenceType('absence_type').notNull(),
    state: absenceState('state').notNull().default('REQUESTED'),
    note: text('note'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({ userIdx: index('absences_user_idx').on(t.userId, t.startsOn) }),
);

export const schema = {
  users,
  allergens,
  menuCategories,
  menuItems,
  weeklySpecials,
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
  workTimePolicy,
  employments,
  stations,
  rosterPeriods,
  availability,
  absences,
};
