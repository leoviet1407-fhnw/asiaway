/**
 * Drizzle schema — the typed query surface. migrations/*.sql is the source of
 * truth; this mirrors it. Numeric columns come back as strings: convert with
 * Number() at the edge (see services).
 */
import {
  bigserial,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value),
});

export const role = pgEnum('role', ['STAFF', 'ORDERER', 'ADMIN']);
export const storageArea = pgEnum('storage_area', ['COLD', 'FREEZER', 'DRY', 'BAR']);
export const orderChannel = pgEnum('order_channel', ['EMAIL', 'WHATSAPP', 'PORTAL']);
export const orderStatus = pgEnum('order_status', [
  'DRAFT',
  'SUBMITTED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
]);
export const receiptStatus = pgEnum('receipt_status', ['OPEN', 'COMPLETED']);
export const photoKind = pgEnum('photo_kind', ['DELIVERY_NOTE', 'DAMAGE']);

export const locations = pgTable('locations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  address: text('address').notNull(),
  deliveryNote: text('delivery_note'),
  sort: integer('sort').notNull().default(0),
  phone: text('phone'),
  contactEmail: text('contact_email'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  role: role('role').notNull(),
  locationId: text('location_id'),
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  emailLower: text('email_lower').notNull(),
  succeeded: boolean('succeeded').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  orderEmail: text('order_email').notNull(),
  ccEmail: text('cc_email'),
  phone: text('phone'),
  orderChannel: orderChannel('order_channel').notNull().default('EMAIL'),
  deliveryDays: text('delivery_days').notNull().default(''),
  cutoffNote: text('cutoff_note'),
  minOrderCents: integer('min_order_cents').notNull().default(0),
  customerNumber: text('customer_number'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').notNull(),
  nameDe: text('name_de').notNull(),
  nameVi: text('name_vi'),
  storageArea: storageArea('storage_area').notNull().default('DRY'),
  stockUnit: text('stock_unit').notNull().default('Stk'),
  isFresh: boolean('is_fresh').notNull().default(false),
  isKeyItem: boolean('is_key_item').notNull().default(false),
  department: text('department'),
  itemGroup: text('item_group'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const itemBarcodes = pgTable('item_barcodes', {
  code: text('code').primaryKey(),
  itemId: uuid('item_id').notNull(),
  unitsPerScan: numeric('units_per_scan', { precision: 10, scale: 4 }).notNull().default('1'),
  label: text('label'),
});

export const supplierItems = pgTable('supplier_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id').notNull(),
  itemId: uuid('item_id').notNull(),
  supplierSku: text('supplier_sku'),
  orderUnit: text('order_unit').notNull(),
  packSize: numeric('pack_size', { precision: 10, scale: 3 }).notNull().default('1'),
  priceCents: integer('price_cents').notNull().default(0),
  quantityUnit: text('quantity_unit'),
  active: boolean('active').notNull().default(true),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: text('number').notNull(),
  locationId: text('location_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  status: orderStatus('status').notNull().default('DRAFT'),
  deliveryDate: date('delivery_date'),
  note: text('note'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  submittedBy: uuid('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  sentBy: uuid('sent_by'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  sentTo: text('sent_to'),
  sentPdf: bytea('sent_pdf'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  itemId: uuid('item_id').notNull(),
  supplierItemId: uuid('supplier_item_id'),
  qty: numeric('qty', { precision: 10, scale: 3 }).notNull(),
  orderUnit: text('order_unit').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull().default(0),
  quantityUnit: text('quantity_unit'),
  supplierSku: text('supplier_sku'),
  note: text('note'),
});

export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  status: receiptStatus('status').notNull().default('OPEN'),
  startedBy: uuid('started_by').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedBy: uuid('completed_by'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  closedOrder: boolean('closed_order').notNull().default(false),
  note: text('note'),
});

export const receiptLines = pgTable('receipt_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id').notNull(),
  itemId: uuid('item_id'),
  scannedCode: text('scanned_code'),
  qty: numeric('qty', { precision: 10, scale: 3 }).notNull().default('0'),
  damaged: boolean('damaged').notNull().default(false),
  note: text('note'),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const receiptPhotos = pgTable('receipt_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id').notNull(),
  kind: photoKind('kind').notNull(),
  mime: text('mime').notNull(),
  data: bytea('data').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailLog = pgTable('email_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orderId: uuid('order_id'),
  toEmail: text('to_email').notNull(),
  ccEmail: text('cc_email'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  transport: text('transport').notNull(),
  messageId: text('message_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  details: jsonb('details').notNull().default({}),
});


export const closingStatus = pgEnum('closing_status', ['SUBMITTED', 'APPROVED']);

export const dailyClosings = pgTable('daily_closings', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: text('location_id').notNull(),
  businessDate: date('business_date').notNull(),
  station: text('station').notNull(),
  status: closingStatus('status').notNull().default('SUBMITTED'),
  cashCountedCents: integer('cash_counted_cents').notNull(),
  startFloatCents: integer('start_float_cents').notNull(),
  eftCents: integer('eft_cents').notNull(),
  mobileCents: integer('mobile_cents').notNull().default(0),
  posGrossCents: integer('pos_gross_cents').notNull(),
  note: text('note'),
  closedBy: uuid('closed_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
});

export const closingPhotos = pgTable('closing_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  closingId: uuid('closing_id').notNull(),
  mime: text('mime').notNull(),
  data: bytea('data').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


export const employmentType = pgEnum('employment_type', ['FULL_TIME', 'PART_TIME', 'ON_CALL', 'MANAGEMENT']);
export const rosterWeekStatus = pgEnum('roster_week_status', ['DRAFT', 'PUBLISHED']);
export const availabilityKind = pgEnum('availability_kind', ['AVAILABLE', 'UNAVAILABLE']);
export const absenceType = pgEnum('absence_type', ['VACATION', 'SICK', 'OTHER']);
export const absenceStatus = pgEnum('absence_status', ['REQUESTED', 'APPROVED', 'REJECTED']);

export const staffProfiles = pgTable('staff_profiles', {
  userId: uuid('user_id').primaryKey(),
  site: text('site').notNull(),
  employmentType: employmentType('employment_type').notNull(),
  pensumPercent: integer('pensum_percent'),
  /** Other roster sites this person is planned at (e.g. the Leitung works at both). */
  extraSites: text('extra_sites').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

export const rosterWeeks = pgTable('roster_weeks', {
  site: text('site').notNull(),
  weekStart: date('week_start').notNull(),
  status: rosterWeekStatus('status').notNull().default('DRAFT'),
  publishedBy: uuid('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  site: text('site').notNull(),
  workDate: date('work_date').notNull(),
  userId: uuid('user_id'),
  startMin: integer('start_min').notNull(),
  endMin: integer('end_min').notNull(),
  breakMin: integer('break_min').notNull().default(0),
  station: text('station').notNull(),
  roleLabel: text('role_label'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const availability = pgTable('availability', {
  userId: uuid('user_id').notNull(),
  workDate: date('work_date').notNull(),
  kind: availabilityKind('kind').notNull(),
  fromMin: integer('from_min'),
  toMin: integer('to_min'),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const availabilitySubmissions = pgTable('availability_submissions', {
  userId: uuid('user_id').notNull(),
  month: text('month').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const absences = pgTable('absences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  type: absenceType('type').notNull(),
  status: absenceStatus('status').notNull().default('REQUESTED'),
  note: text('note'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});


export const yearlyBalances = pgTable('yearly_balances', {
  userId: uuid('user_id').notNull(),
  year: integer('year').notNull(),
  vacationDays: numeric('vacation_days', { precision: 5, scale: 1 }).notNull().default('25'),
  vacationCarry: numeric('vacation_carry', { precision: 5, scale: 1 }).notNull().default('0'),
  overtimeCarryMin: integer('overtime_carry_min').notNull().default(0),
});

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  workDate: date('work_date').notNull(),
  startMin: integer('start_min').notNull(),
  endMin: integer('end_min').notNull(),
  breakMin: integer('break_min').notNull().default(0),
  shiftId: uuid('shift_id'),
  note: text('note'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timeMonthApprovals = pgTable('time_month_approvals', {
  userId: uuid('user_id').notNull(),
  month: text('month').notNull(),
  approvedBy: uuid('approved_by').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
});


export const staffingNeeds = pgTable('staffing_needs', {
  site: text('site').notNull(),
  weekday: integer('weekday').notNull(),
  lunchPeople: integer('lunch_people').notNull().default(0),
  dinnerPeople: integer('dinner_people').notNull().default(0),
});

export const schema = {
  locations,
  users,
  userRoles,
  sessions,
  loginAttempts,
  suppliers,
  items,
  itemBarcodes,
  supplierItems,
  purchaseOrders,
  purchaseOrderLines,
  receipts,
  receiptLines,
  receiptPhotos,
  emailLog,
  auditEvents,
  dailyClosings,
  closingPhotos,
  staffProfiles,
  rosterWeeks,
  shifts,
  availability,
  availabilitySubmissions,
  absences,
  yearlyBalances,
  timeEntries,
  timeMonthApprovals,
  staffingNeeds,
};
