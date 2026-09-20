# Asiaway QR Table Ordering — Phase 1 Architecture & Implementation Plan

**Status:** DRAFT FOR APPROVAL — no application code written yet.
**Authoritative source:** `ASIAWAY_QR_ORDERING_SYSTEM_MASTER_SPEC.docx`
**Initial menu source:** `menu_trilingual_EN_DE_VI.csv`, cross-checked against `asiaway_menu_viet_241107.pdf`
**Date:** 2026-09-20

Legend used throughout: **CONFIRMED** (stated by the restaurant/spec) · **PROPOSED** (my technical recommendation, not a fact) · **OPEN** (not decided) · **OUT OF SCOPE** (deferred to Phase 2).

---

## A. Repository assessment

The working directory is a **handoff bundle, not a codebase**. Full inventory:

| File | Type | Role |
|---|---|---|
| `ASIAWAY_QR_ORDERING_SYSTEM_MASTER_SPEC.docx` | 22-section spec | Authoritative specification |
| `ASIAWAY_QR_ORDERING_SYSTEM_CLAUDE_HANDOFF.md` | Markdown | Condensed restatement of the spec |
| `ASIAWAY_QR_ORDERING_SYSTEM_CLAUDE_PROMPT.txt` | Text | Same as the `.md` **plus** a section on immutable submission snapshots + revisions |
| `menu_trilingual_EN_DE_VI.csv` | CSV, 50 rows, 10 cols, UTF-8 BOM | Initial food menu |
| `asiaway_menu_viet_241107.pdf` | 28 pages, ~18 hi-res JPEGs | Original printed menu (source of truth for menu content) |

Findings:

1. **No existing application.** No `package.json`, lockfile, framework, database, migrations, `.env`, CI config, Docker, tests, assets folder or source directory of any kind. Not a git repository.
2. **No reusable components exist.** Everything is greenfield.
3. **No environment or configuration files exist.**
4. **Assets:** no loose image files. However the PDF embeds **~18 high-resolution dish photographs** (up to 1746×2471 px, JPEG) with captions naming the dish number — see section J.
5. **Conflicts with the spec:** none in code (no code exists). Conflicts exist **between the spec text, the CSV and the source PDF** — see section E, items E1–E4. These are content conflicts, not architectural ones.

Conclusion: greenfield build. No migration or refactoring burden; the only pre-existing constraint is the menu data and the workflow defined in the spec.

---

## B. Requirements checklist (Requirements Interpretation Matrix)

### B1. Customer

| # | Requirement | Status |
|---|---|---|
| C1 | Permanent QR code per physical table | CONFIRMED |
| C2 | No app install; mobile web / PWA | CONFIRMED |
| C3 | Language selection EN / DE / VI | CONFIRMED |
| C4 | Language persists for the browser session | CONFIRMED |
| C5 | Menu with categories, names, descriptions, prices, allergens | CONFIRMED |
| C6 | Dish photos where available; no fake/broken placeholders | CONFIRMED |
| C7 | Food and drinks separated in the menu | CONFIRMED (Improvement 6) |
| C8 | Cart with quantity editing | CONFIRMED |
| C9 | Free-text special request only; no structured modifiers | CONFIRMED |
| C10 | Submit order without any identity data | CONFIRMED |
| C11 | Confirmation screen with order number + timestamp | CONFIRMED |
| C12 | Continue browsing after submit; no forced waiting screen | CONFIRMED (Improvement 1) |
| C13 | Additional orders in the same session via the same QR | CONFIRMED |
| C14 | Request Checkout | CONFIRMED |
| C15 | No customer self-cancel | CONFIRMED |
| C16 | No live order-status tracking | CONFIRMED |
| C17 | Customer can see the final order if the waiter changed it | CONFIRMED (Improvement 3) — *interpretation in E5* |
| C18 | Customer never sees internal waiter workflow statuses | CONFIRMED |
| C19 | Sold-out items visible but not addable | CONFIRMED |
| C20 | Mobile-first, one-handed, large tap targets, no horizontal scroll | CONFIRMED |

### B2. Waiter

| # | Requirement | Status |
|---|---|---|
| W1 | Waiter login; single role WAITER in Phase 1 | CONFIRMED |
| W2 | Real-time new-order notification (visual + sound where supported) | CONFIRMED |
| W3 | Real-time checkout-request notification | CONFIRMED |
| W4 | Notification persists until opened/acknowledged | CONFIRMED |
| W5 | Server-side pending queue is authoritative; reconnect recovers missed alerts | CONFIRMED |
| W6 | Dashboard: table state, new-order count, checkout-request count, pending orders | CONFIRMED |
| W7 | Open order → EMPLOYEE_REVIEW | CONFIRMED |
| W8 | Edit quantities, add/remove items, edit special request | CONFIRMED |
| W9 | Confirm order; it leaves the pending queue | CONFIRMED |
| W10 | Mark item sold out / restore availability, no redeploy | CONFIRMED |
| W11 | Handle checkout request; close session after POS payment | CONFIRMED |
| W12 | View session/order history and audit events | CONFIRMED |
| W13 | Responsive: tablet preferred, phone must work | CONFIRMED |

### B3. System / domain

| # | Requirement | Status |
|---|---|---|
| S1 | Unique order number per submitted order, concurrency-safe | CONFIRMED |
| S2 | Server-authoritative UTC timestamps, rendered in restaurant-local time | CONFIRMED |
| S3 | Append-only audit trail with actor, timestamp, entity, before/after | CONFIRMED |
| S4 | Immutable original customer submission snapshot | CONFIRMED |
| S5 | Versioned waiter revisions; final confirmed snapshot | CONFIRMED |
| S6 | Additional orders never mutate earlier orders | CONFIRMED |
| S7 | Table sessions: AVAILABLE → OCCUPIED → ORDER_PENDING → OCCUPIED → CHECKOUT_REQUESTED → PAID/CLOSED → AVAILABLE | CONFIRMED |
| S8 | Checkout request does not close the session | CONFIRMED |
| S9 | Combined tables supported **at data-model level** | CONFIRMED |
| S10 | Non-guessable QR token; table number is not the secret | CONFIRMED |
| S11 | Server-side validation of price, availability, quantity, session | CONFIRMED |
| S12 | Idempotency / duplicate-submission protection | CONFIRMED |
| S13 | Argon2-class password hashing or managed IdP | CONFIRMED |
| S14 | HTTPS outside localhost | CONFIRMED |
| S15 | No customer PII | CONFIRMED |
| S16 | Menu content is structured data, never hard-coded page text | CONFIRMED |
| S17 | i18n system; no translated strings scattered in components | CONFIRMED |
| S18 | Automated tests + documented manual acceptance | CONFIRMED |
| S19 | Clean POS/kitchen/bar/payment/analytics extension points, unbuilt | CONFIRMED |

### B4. Out of scope (Phase 2 — must remain possible, must not be built)

POS integration · kitchen display/printer · bar routing · online/QR payment (TWINT, Apple/Google Pay, card) · sales analytics · employee analytics · customer accounts/loyalty · reservations/delivery/takeaway · structured modifiers · customer-facing live order tracking.

---

## C. Requirements already satisfied by existing code

**None.** There is no code. 0 of 52 checklist items are implemented.

The only pre-existing assets that reduce work:
- Menu content is already normalised trilingually (50 rows) — subject to the defects in E1/E2.
- Allergen coding already exists in the source and is machine-readable.
- Dish photographs exist inside the PDF and are extractable at print resolution.

---

## D. Requirements still needing implementation

All of B1, B2 and B3 — 52 items. Nothing can be skipped as "already done". Sequenced in section T.

---

## E. Open questions / unresolved requirements

### BLOCKING — these change the menu the guest sees, or the money charged. I will not guess.

**E1. Curry dishes bundle two proteins in one row. How should they appear?**
The CSV encodes dishes 90/91/92 as 6 rows, each covering **two** proteins with a `/`-separated allergen string:

| CSV row | Price | Allergens |
|---|---|---|
| `Green Curry - Chicken / Tofu` | 25.50 | `A D / A D F` |
| `Green Curry - Beef / Prawn` | 27.50 | `A D / A B D` |
| …same pattern for Red (91) and Massaman (92) | | |

The PDF confirms the original layout: each curry lists Chicken **A D** / Tofu **A D F** at 25.50 and Beef **A D** / Prawn **A B D** at 27.50.

This is unworkable in Phase 1 as-is: there are **no structured modifiers**, so a guest ordering "Green Curry - Chicken / Tofu" has not told the kitchen which protein they want, and the app cannot display one honest allergen set. Allergen accuracy is a legal matter, so a merged set is not acceptable either.

**Recommendation (needs your yes/no):** split each curry into **4 separate menu items** — Chicken 25.50 `A D`, Tofu 25.50 `A D F`, Beef 27.50 `A D`, Prawn 27.50 `A B D` — giving 12 curry items instead of 6. This is exactly how the CSV already handles dish **n°12 Fresh Summer Roll** (split into Beef / Prawn / Duck / Fried Tofu as 4 rows with individual allergens and prices). It keeps Phase 1 modifier-free, keeps every price identical to the printed menu, and makes each allergen set correct. *Alternative if you prefer fewer rows: keep 6 items and force the guest to name the protein in the free-text field — I do not recommend this, because the allergen display would be ambiguous.*

**E2. The allergen legend in the spec is missing code G = Milk.**
- Spec §8 lists: A, B, C, D, E, F, H, L, M, N, O, P, R (13 codes).
- The printed menu PDF legend lists: A=Gluten, B=Krebstiere, C=Eier, D=Fisch, E=Erdnüsse, F=Sojabohnen, **G=Milch**, H=Schalenfrüchte, L=Sellerie, M=Senf, N=Sesamsamen, O=Sulfite, P=Lupinen, R=Weichtiere (14 codes).

No current CSV row uses G or P, so no dish data is lost today — but the legend shown to guests must match the printed menu, and a future dish may need G. **Recommendation:** store the full 14-code legend from the PDF. Please confirm, since this is allergen labelling.

**E3. Dish numbers are not unique — confirm they are display-only.**
`Dish No.` repeats: 12 appears 4×, and 90/91/92 twice each. The system will therefore use its own internal ID as the primary key and treat `Dish No.` as a **display label ("n° 12")** only. Confirm that guests should still see the printed dish numbers (recommended — waiters and guests both use them verbally).

**E4. Combined tables — the operating rule.**
The data model will support it either way (section O). What I will **not** invent is which QR a guest scans when tables 11 and 12 are joined: (a) only a designated primary table's QR routes to the joint session, or (b) every member table's QR routes to the same joint session. I will build both behind one configuration flag and ship with the joint-table **waiter UI minimal** until you decide. Not blocking for the prototype; **blocking before real guests use combined tables**.

### NON-BLOCKING — I have a safe default, but tell me if you disagree.

**E5. What exactly does "customer can see the final order if the waiter changes it" mean?**
Interpretation I will implement: an in-session, read-only "My orders" view listing each order number, time, line items and total, showing the **current confirmed version**, and flagging "adjusted by staff" when it differs from what was submitted. No internal statuses, no live push, no polling-based tracking UI. Say the word if you meant something narrower (e.g. only the printed receipt at the table).

**E6. Stale sessions — what happens when a party leaves without pressing Checkout?**
The spec marks the reset procedure OPEN. Risk: the next party scans the same QR and inherits the previous party's open session and orders. Default I propose: scanning always attaches to the open session (per spec §4.1), the waiter dashboard shows each session's age and order count, the waiter can close any session in two taps, and sessions idle for **4 hours** are auto-closed by a background job with a `SYSTEM` audit event. Please confirm the 4-hour figure or give your own.

**E7. Order number scheme.** Proposal: a single monotonic sequence starting at **1001**, displayed as `#1047`, never reset. Daily reset (e.g. `20260920-014`) is possible but adds a rollover edge case. Confirm which you want on the printed/POS-entry side.

**E8. Time zone.** The menu prices are CHF and the restaurant footer names Zürich/Winterthur, so I will render times in **Europe/Zurich** and store UTC. This is inferred from the PDF, not stated in the spec — please confirm.

**E9. Legal texts on the menu page.** The PDF carries a meat-origin declaration (`Fleischdeklaration`: beef/pork/poultry Switzerland, prawns/fish Vietnam, squid China, duck Thailand, incl. the antibiotics notice) and "Alle Preise in CHF inkl. MWST". **Recommendation:** reproduce both verbatim on a menu info page in all three languages. Confirm the wording is current — I will not paraphrase legal text on my own authority.

**E10. Special-request scope.** Spec §7.1 puts the free-text field at **order level** ("unless later decided otherwise"). I will implement order-level only. Per-line notes are a schema-compatible addition later.

**E11. Duplicate *intentional* orders.** Idempotency stops accidental resubmits. A guest may legitimately order the same thing twice within a minute. Default: a soft "You ordered the same items 40 seconds ago — send again?" confirmation, never a hard block.

**E12. Web Push.** SSE + in-page sound covers an always-on tablet. True Web Push (VAPID, notifications while the browser is closed) is extra scope. Default: not in Phase 1; architecturally prepared.

### OPEN — supplied later, no decision needed from me now

Real table list/count · drinks menu · photo→dish mapping sign-off · final branding (logo, colours, typography) · production domain and hosting preference · POS details (Phase 2) · kitchen/bar details (Phase 2) · exact waiter tablet model · QR print artwork spec.

Until supplied, the demo uses **Table 01 / 02 / 03**, a `DEMO DATA` banner, test waiter credentials, **zero drinks**, and a neutral unbranded theme.

---

## F. Recommended architecture

A single TypeScript application, deployed as one long-running Node container, with three surfaces over one domain core:

```
┌─────────────────┐   ┌─────────────────┐
│ Customer PWA    │   │ Waiter PWA      │   /t/<qr_token>, /waiter/*
│ (mobile-first)  │   │ (tablet/phone)  │
└────────┬────────┘   └────────┬────────┘
         │ REST + cookie        │ REST + cookie, SSE stream
┌────────▼──────────────────────▼────────┐
│ HTTP layer  (thin: Zod validation,     │
│ authn/authz, idempotency, rate limit)  │
├────────────────────────────────────────┤
│ DOMAIN CORE  (framework-free)          │
│  order state machine · session state   │
│  machine · revision engine · pricing   │
│  · availability · numbering · audit    │
├────────────────────────────────────────┤
│ PORTS (interfaces, Phase-2 seams)      │
│  PosAdapter · KitchenRouter ·          │
│  PaymentProvider · NotificationChannel │
│  · AnalyticsSink                       │
├────────────────────────────────────────┤
│ PostgreSQL  (append-only audit +       │
│ revisions, sequences, LISTEN/NOTIFY)   │
└────────────────────────────────────────┘
```

Non-negotiable architectural rules:

1. **The domain core has no HTTP, React or Prisma types in its signatures.** Every business rule is unit-testable without a server. This is what keeps Phase 2 from becoming a rewrite.
2. **The client is never trusted for money or availability.** The submit endpoint ignores any price the browser sends and recomputes every line from the database inside the transaction.
3. **History is written in the same transaction as the change.** A revision and its audit event either both exist with the state change or none of them do.
4. **Phase 2 seams are interfaces with exactly one Phase 1 implementation**: `PosAdapter` → `ManualPosAdapter` (a no-op that records "entered manually by waiter"). No vendor is named anywhere.

---

## G. Recommended technology stack

All PROPOSED. Each row states *why*, per spec §15.

| Layer | Choice | Why this, and what it buys Phase 2 |
|---|---|---|
| Language | **TypeScript** (strict) | One language across both UIs, API and domain; types shared client↔server prevent price/shape drift. |
| Framework | **Next.js 15, App Router**, built as a long-running Node server (`output: standalone`) | One deployable serves customer PWA + waiter PWA + API. Server components make the menu fast on a phone over restaurant Wi-Fi. **Deliberately not serverless**, because SSE and a persistent DB listener need a live process. |
| UI | React 19 + **Tailwind CSS** + Radix primitives | Radix gives keyboard/ARIA behaviour for free (accessibility requirement); Tailwind keeps tap-target and spacing rules consistent; no design-system lock-in before branding is known. |
| PWA | `next-pwa`/Workbox service worker, manifest, offline shell | Required by spec. Cache strategy: menu = stale-while-revalidate, all order/session calls = network-only (never serve stale money or availability). |
| Database | **PostgreSQL 16** | Sequences → safe order numbers under concurrency. Transactions → atomic revision+audit. JSONB → snapshots. `REVOKE UPDATE/DELETE` + triggers → genuinely append-only audit. `LISTEN/NOTIFY` → realtime fan-out with no extra broker. |
| Access | **Prisma** ORM + Prisma Migrate | Typed queries (parameterised → SQL-injection safe), reviewable SQL migrations checked into git. Raw SQL only where Prisma can't express it (sequences, triggers, grants). |
| Auth | **Auth.js v5**, Credentials provider, DB sessions, **Argon2id** hashing | Meets S13. Behind an `AuthProvider` interface so an external IdP can replace it in Phase 2 without touching route handlers. |
| Realtime | **Server-Sent Events** primary; Postgres `LISTEN/NOTIFY` fan-out; **polling fallback**; DB queue authoritative | SSE over WebSocket: one-way server→waiter is all we need, it reconnects automatically, it authenticates with the ordinary session cookie, and it survives corporate/hotel proxies better. See section Q for the full fallback ladder. |
| Validation | **Zod**, schemas shared both sides | Single definition of every request shape; server-side validation is the same object the client used. |
| i18n | **next-intl** for UI chrome; **database columns** for menu content | Spec S16/S17: UI strings in `messages/{en,de,vi}.json`, menu text in the DB so the restaurant can change a dish without a deploy. |
| Money | **Integer minor units** (Rappen) + `Intl.NumberFormat('de-CH')` | No floating point in money. Ever. |
| QR | `qrcode` → SVG/PNG; a CLI that emits a print-ready sheet per table | Reproducible, version-controlled QR assets. |
| Tests | **Vitest** (unit + integration against a real Postgres in Docker), **Playwright** (E2E, iPhone-class and tablet viewports) | Integration tests hit real SQL because the concurrency and append-only guarantees *are* SQL behaviour; mocks would prove nothing. |
| Logging | **Pino**, structured JSON, request IDs, token redaction | Meaningful logs without leaking QR tokens or session IDs into log aggregators. |
| Hosting | **OPEN — not chosen.** Deliverable is a Docker image + compose file that runs anywhere. | Spec forbids picking a provider. Candidates when you decide: Fly.io, Railway, Hetzner + Coolify, or any VPS. Only requirement: a long-running container + managed Postgres + TLS. |

**Alternatives considered and rejected:** Vercel serverless (SSE and DB listeners fight the model); a separate Express API + SPA (two deployables, duplicate auth, no benefit at this size); Supabase Realtime (adds a vendor dependency for something `LISTEN/NOTIFY` already does); MySQL/SQLite (weaker JSONB, weaker append-only controls, SQLite unfit for concurrent writes from tablet + phones).

---

## H. Database / entity model

PostgreSQL. All timestamps `timestamptz`, defaulted by the **database** (`now()`), never by a client. All money `integer` minor units, currency `CHF` (single-currency in Phase 1, column present for Phase 2).

### H1. Identity & menu

```
users                     id uuid pk · email citext unique · password_hash text
                          · display_name text · role user_role default 'WAITER'
                          · is_active bool default true · created_at · last_login_at
                          idx: (email)

menu_categories           id uuid pk · slug text unique · kind category_kind
                          ('FOOD'|'DRINK')  -- Improvement 6: food/drinks separated
                          · name_en/name_de/name_vi text not null
                          · sort_order int not null · is_active bool default true
                          idx: (kind, sort_order)

menu_items                id uuid pk · category_id fk→menu_categories
                          · dish_number text null          -- display only, NOT unique (E3)
                          · external_key text unique       -- stable CSV import key (re-import safe)
                          · name_en/de/vi text not null
                          · description_en/de/vi text not null
                          · price_cents int not null check (price_cents >= 0)
                          · currency char(3) default 'CHF'
                          · allergen_codes text[] not null default '{}'
                          · image_path text null            -- null = render no image, never a placeholder
                          · sort_order int · is_available bool default true
                          · availability_changed_at · availability_changed_by fk→users
                          · is_active bool default true · created_at · updated_at
                          idx: (category_id, sort_order), (is_available), gin(allergen_codes)

allergens                 code char(1) pk · name_en/de/vi text   -- 14 codes incl. G (pending E2)
```

### H2. Tables, groups, sessions

```
restaurant_tables         id uuid pk · table_number text unique · display_name text
                          · qr_token text unique not null      -- 128-bit CSPRNG, base64url (22 ch)
                          · qr_token_version int default 1     -- rotation without losing history
                          · is_active bool default true · created_at
                          idx: unique(qr_token), unique(table_number)

table_groups              id uuid pk · group_name text · status group_status
                          ('ACTIVE'|'DISSOLVED')
                          · qr_policy qr_policy ('ANY_MEMBER'|'PRIMARY_ONLY')   -- E4 flag
                          · primary_table_id fk→restaurant_tables null
                          · created_at · dissolved_at · created_by fk→users

table_group_members       table_group_id fk · table_id fk · joined_at · left_at null
                          pk(table_group_id, table_id)
                          partial unique: a table may belong to at most ONE active group
                          (unique(table_id) where left_at is null)

dining_sessions           id uuid pk · session_number bigint unique (sequence)
                          · primary_table_id fk→restaurant_tables not null
                          · table_group_id fk→table_groups null    -- set ⇒ combined session
                          · status session_status
                            ('OCCUPIED'|'ORDER_PENDING'|'CHECKOUT_REQUESTED'|'CLOSED')
                          · opened_at · last_activity_at
                          · checkout_requested_at null · closed_at null
                          · closed_by fk→users null · close_reason text null
                          PARTIAL UNIQUE INDEX: one open session per table
                            unique(primary_table_id) where status <> 'CLOSED'
                          idx: (status), (last_activity_at) for the stale-session job
```

> `AVAILABLE` is not stored on the session — it is the *absence* of an open session for that table, which is what the partial unique index enforces. A table's displayed state is derived (section L).

```
customer_devices          id uuid pk · session_id fk→dining_sessions
                          · device_token_hash text unique   -- sha256 of the cookie value
                          · first_seen_at · last_seen_at · user_agent_hash text
                          -- lets several phones at one table share a session, and lets us
                          -- attribute a submission to a device without any PII
```

### H3. Orders, items, revisions, notes

```
orders                    id uuid pk · order_number bigint unique not null  -- sequence, E7
                          · session_id fk→dining_sessions not null
                          · table_id fk (denormalised snapshot of the ordering table)
                          · status order_status
                            ('SUBMITTED'|'EMPLOYEE_REVIEW'|'CONFIRMED'|'CANCELLED')
                          · submitted_at not null · opened_by_waiter_at null
                          · opened_by fk→users null · confirmed_at null
                          · confirmed_by fk→users null
                          · cancelled_at · cancelled_by · cancel_reason
                          · total_cents int not null            -- server-computed, always
                          · current_revision_number int not null default 0
                          · submitted_by_device_id fk→customer_devices
                          idx: (status, submitted_at), (session_id, submitted_at), (order_number)

order_items               id uuid pk · order_id fk · menu_item_id fk (nullable on delete)
                          · name_en/de/vi text  -- SNAPSHOT at submit: menu edits never
                          · dish_number text    -- rewrite an existing order
                          · unit_price_cents int · quantity int check (quantity between 1 and 99)
                          · line_total_cents int · allergen_codes text[]
                          · sort_index int
                          idx: (order_id)

order_notes               id uuid pk · order_id fk · note_text text (max 500)
                          · source note_source ('CUSTOMER'|'WAITER')
                          · created_at · created_by fk→users null
                          -- append-only: a waiter edit adds a WAITER note, the CUSTOMER
                          -- note is never overwritten

order_revisions           id uuid pk · order_id fk
                          · revision_number int not null      -- 0 = original submission
                          · unique(order_id, revision_number)
                          · revision_type revision_type
                            ('ORIGINAL_SUBMISSION'|'WAITER_EDIT'|'FINAL_CONFIRMED'
                             |'CANCELLATION')
                          · actor_type · actor_id · reason text null
                          · before_snapshot jsonb null   -- null only for revision 0
                          · after_snapshot  jsonb not null
                          · total_cents_before int null · total_cents_after int not null
                          · created_at
                          idx: (order_id, revision_number)
                          APPEND-ONLY (H5)
```

A snapshot is the **complete** order state (`{items:[{name_en,name_de,name_vi,dish_number,unit_price_cents,quantity,line_total_cents,allergen_codes}], customer_note, waiter_note, total_cents, status}`) — not a diff. Full snapshots make "show me exactly what the guest originally ordered" a single row read with no replay logic, which is precisely the guarantee the spec demands.

### H4. Audit, notifications, idempotency

```
audit_events              id bigserial pk · occurred_at timestamptz default now()
                          · actor_type actor_type ('CUSTOMER'|'WAITER'|'SYSTEM')
                          · actor_user_id fk→users null
                          · actor_device_id fk→customer_devices null
                          · action text        -- 'ORDER_SUBMITTED', 'ORDER_ITEM_QTY_CHANGED', …
                          · entity_type text · entity_id uuid
                          · table_id · session_id · order_id (nullable denormalised fks)
                          · before_value jsonb null · after_value jsonb null
                          · metadata jsonb  -- ip_hash, request_id, revision_number, reason
                          idx: (entity_type, entity_id, occurred_at),
                               (session_id, occurred_at), (order_id, occurred_at),
                               (occurred_at desc)
                          APPEND-ONLY (H5)

notifications             id uuid pk · type notification_type
                            ('NEW_ORDER'|'CHECKOUT_REQUESTED'|'ORDER_UPDATED')
                          · status notification_status ('PENDING'|'ACKNOWLEDGED')
                          · session_id · order_id · table_id
                          · payload jsonb   -- table label, order number, total, item count
                          · created_at · delivered_at null
                          · acknowledged_at null · acknowledged_by fk→users null
                          idx: (status, created_at) — the pending-queue read path
                          -- server-side queue is authoritative (spec §11)

idempotency_keys          key text pk                    -- client UUIDv4
                          · scope text                   -- 'order.submit' | 'checkout.request'
                          · session_id fk
                          · request_hash text            -- sha256 of canonical request body
                          · state ('IN_PROGRESS'|'COMPLETED')
                          · response_status int null · response_body jsonb null
                          · created_at · expires_at (24h)
                          idx: (expires_at) for cleanup
```

### H5. Append-only enforcement (spec §12, §14.2)

Two independent layers, because an application-level rule alone is not "cannot silently rewrite history":

1. **Grants** — the application connects as `asiaway_app`, which holds `INSERT, SELECT` on `audit_events` and `order_revisions` and **no `UPDATE`/`DELETE`**. Migrations run as a separate `asiaway_migrate` role.
2. **Triggers** — `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` on both tables, so even a superuser mistake in a console fails loudly.

Cancellation and correction are modelled as *new* rows (`CANCELLATION` revision), never as edits.

### H6. Order & session numbering (S1)

```sql
CREATE SEQUENCE order_number_seq  START 1001;
CREATE SEQUENCE session_number_seq START 1;
```
`nextval()` is atomic and non-blocking outside the transaction, so two waiters and three phones submitting simultaneously cannot collide or deadlock. Gaps are possible after a rolled-back transaction; that is acceptable and normal for receipt numbering (and is why a daily-reset scheme, E7, is more fragile).

### H7. Migration strategy

Prisma Migrate, forward-only, one SQL file per change, all checked into git and reviewed. Raw-SQL migrations cover sequences, the append-only triggers, the role grants and the partial unique indexes. Every migration runs in a transaction; deploys run `migrate deploy` before the new container takes traffic. Rollback policy: write a compensating forward migration, never edit an applied one. Seeds are separate from migrations and are never run automatically in production.

---

## I. API structure

REST over HTTPS, JSON, under `/api`. Two authorisation worlds, deliberately separated at the route level.

### I1. Authentication model

| Surface | Mechanism |
|---|---|
| Customer | `aw_dsid` cookie: httpOnly, Secure, SameSite=Lax, signed (HMAC), payload `{session_id, device_id, table_id, v}`. Issued **only** by `POST /api/qr/resolve`. Every customer endpoint authorises against this cookie — never against a table number or QR token in the request body. |
| Waiter | Auth.js session cookie: httpOnly, Secure, SameSite=Strict. All `/api/waiter/*` require an active `WAITER` user; plus an origin check and a CSRF token on every mutation. |

### I2. Customer endpoints (no login)

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/qr/resolve` | body `{qr_token}` → resolves table, finds-or-creates the open session, sets `aw_dsid`, returns `{table_label, session_id, is_new_session}` | Rate-limited per IP and per token. Unknown/inactive token → `404 QR_INVALID` with a friendly message and **no** information about other tables. |
| `GET /api/menu?lang=en\|de\|vi` | Active categories + items, localised, with `is_available`, allergens, `image_path`, grouped `kind=FOOD\|DRINK` | Cacheable 60 s, SWR on the client. Availability is *displayed* from here but *enforced* at submit. |
| `GET /api/menu/items/:id?lang=` | One item's detail | |
| `GET /api/allergens?lang=` | The legend (E2) | |
| `POST /api/orders` | Submit cart. Body `{items:[{menu_item_id, quantity}], note?}` + header `Idempotency-Key` | **No prices accepted from the client.** Full server validation (I4). Returns `{order_number, submitted_at, total_cents, items}`. |
| `GET /api/orders` | This session's orders, read-only, current confirmed version, with `was_adjusted_by_staff` flag (E5) | No internal statuses exposed. |
| `POST /api/checkout-request` | Creates the checkout request + notification; header `Idempotency-Key` | Session stays open (S8). Repeat press → same response, no duplicate notification. |
| `GET /api/session` | Session summary: order count, running total, checkout-requested flag | |

### I3. Waiter endpoints (authenticated)

| Method & path | Purpose |
|---|---|
| `POST /api/auth/signin` · `POST /api/auth/signout` | Auth.js; rate-limited, generic failure message, lockout after repeated failures |
| `GET /api/waiter/dashboard` | Table grid with derived states, pending-order count, checkout-request count |
| `GET /api/waiter/orders?status=pending` | Queue of `SUBMITTED` + `EMPLOYEE_REVIEW` orders |
| `GET /api/waiter/orders/:id` | Full order incl. items, notes, current revision, revision history |
| `POST /api/waiter/orders/:id/open` | `SUBMITTED → EMPLOYEE_REVIEW`; stamps `opened_by_waiter_at`; audits. Idempotent if already open by the same waiter |
| `PATCH /api/waiter/orders/:id` | Edit: `{items:[{menu_item_id, quantity}], waiter_note?, reason?}`. Creates a **new revision** (before+after snapshots), recomputes the total server-side, writes one audit event per field changed. Requires `If-Match: <current_revision_number>` → `409 REVISION_CONFLICT` if two waiters edit at once |
| `POST /api/waiter/orders/:id/confirm` | `→ CONFIRMED`, writes the `FINAL_CONFIRMED` revision, stamps `confirmed_at/by`, acknowledges the notification, removes it from the queue |
| `POST /api/waiter/menu-items/:id/availability` | `{is_available, reason?}` — sold-out toggle, audited, live without redeploy |
| `GET /api/waiter/sessions/:id` | Session detail: every order, numbers, times, totals, checkout state |
| `POST /api/waiter/sessions/:id/close` | Close after POS payment. Guard: refuses while any order is not `CONFIRMED`/`CANCELLED` unless `force=true` **with** a reason (audited) |
| `POST /api/waiter/sessions/:id/checkout-ack` | Acknowledge the checkout notification |
| `GET /api/waiter/notifications?status=pending` | The authoritative pending queue (reconnect recovery, S/§11) |
| `POST /api/waiter/notifications/:id/ack` | Acknowledge |
| `GET /api/waiter/stream` | **SSE**: `new_order`, `checkout_requested`, `order_updated`, `availability_changed`, `heartbeat` |
| `GET /api/waiter/audit?order_id=\|session_id=\|table_id=` | Ordered audit events |
| `POST /api/waiter/tables/:id/session` | Manually open a session (walk-in handled before scanning) |
| *(guarded)* `POST /api/waiter/table-groups` · `DELETE /api/waiter/table-groups/:id` | Combined tables — behind a feature flag until E4 is answered |

### I4. Submit validation pipeline (the money path)

Inside **one** serialisable transaction:

1. Idempotency: `INSERT ... ON CONFLICT` on `idempotency_keys`. Conflict + `COMPLETED` → replay the stored response, create nothing. Conflict + `IN_PROGRESS` → `409 REQUEST_IN_FLIGHT`.
2. Session: exists, status ≠ `CLOSED`, cookie's `table_id` still matches the session.
3. Cart shape (Zod): 1–60 line items, each `quantity` 1–99, note ≤ 500 chars, note stripped of control characters.
4. Items: every `menu_item_id` exists, `is_active`, and **`is_available = true`** → otherwise `409 ITEMS_UNAVAILABLE` with the offending IDs so the UI can grey them out and explain.
5. Prices: read `price_cents` **from the database**, ignore anything the client sent.
6. Compute `line_total = unit_price × quantity`, `total = Σ line_totals`, in integers.
7. `order_number = nextval('order_number_seq')`; `submitted_at = now()` (DB clock).
8. Insert `orders`, `order_items`, the `CUSTOMER` `order_note`, and **revision 0 = `ORIGINAL_SUBMISSION`** with the full snapshot.
9. Session → `ORDER_PENDING`; `last_activity_at = now()`.
10. Insert `audit_events` (`ORDER_SUBMITTED`) and `notifications` (`NEW_ORDER`, `PENDING`).
11. `pg_notify('waiter_events', …)` → SSE fan-out.
12. Store the response in `idempotency_keys`, mark `COMPLETED`, commit.

### I5. Error contract

`{ "error": { "code": "ITEMS_UNAVAILABLE", "message": "...", "details": {...} } }` — stable machine codes (`QR_INVALID`, `SESSION_CLOSED`, `ITEMS_UNAVAILABLE`, `PRICE_CHANGED`, `REVISION_CONFLICT`, `REQUEST_IN_FLIGHT`, `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`), localised messages on the client from the code, and **never** an internal stack trace, SQL fragment or entity ID the caller shouldn't see.

---

## J. Customer UI structure

Mobile-first, one-handed, 44 px minimum tap targets, no horizontal scroll at 320 px, WCAG AA contrast, full keyboard/screen-reader support on interactive controls.

| Screen | Route | Content | Loading | Empty | Error | Sold-out |
|---|---|---|---|---|---|---|
| **QR landing / language** | `/t/[token]` | Asiaway name (neutral until branding), table label, EN/DE/VI selector, no login prompt | Skeleton | — | Invalid/disabled QR → friendly "Please ask our staff", no table data leaked | — |
| **Menu home** | `/menu` | `Food` / `Drinks` tabs (Drinks shows "Coming soon" while empty), category sections, item rows with name, short description, price, allergen chips, photo only if one exists, sticky cart bar | Skeleton rows | Drinks: honest empty state | Retry banner, cached menu still readable | Item greyed, `SOLD OUT` badge, add button disabled + `aria-disabled` |
| **Dish detail** | `/menu/[id]` | Photo if present (no placeholder box if absent), full localised description, price, allergen codes **with legend text**, quantity stepper, Add to cart | Skeleton | — | 404 → back to menu | Badge + disabled add, explanatory line |
| **Cart** | `/cart` | Lines with quantity steppers, remove, per-line and order total, **one** free-text special request field (≤500 chars, counter) with the guidance "Special requests are subject to availability — please also tell your waiter", Continue browsing, Confirm order | — | "Your cart is empty" + Browse menu | Inline validation | If an item sold out while in the cart: highlighted, blocked, one-tap remove |
| **Submitting** | overlay | Button locks, spinner, non-dismissible | — | — | Network failure → "Retry" reuses the **same** `Idempotency-Key` | — |
| **Order submitted** | `/orders/[number]` | `#1047`, restaurant-local time, items, total, "Our waiter will come to your table to confirm", **Continue browsing** as primary action (Improvement 1) | — | — | — | — |
| **My orders** | `/orders` | All orders this session, current version, "adjusted by staff" flag (E5), running session total | Skeleton | "No orders yet" | Retry | — |
| **Checkout request** | `/checkout` | Session summary + total, explicit confirm step ("Ask for the bill?"), after: "Checkout requested at 19:42 — a waiter is on the way", request button disabled | — | — | Retry with same key | — |
| **Session closed** | any | "This table session has ended. Please scan again to start a new one." | — | — | — | — |

Cross-cutting: language persists in `localStorage` + cookie for the browser session; cart persists in `localStorage` keyed by session so a refresh or an accidental tab close loses nothing; every price rendered with `Intl.NumberFormat('de-CH', {currency:'CHF'})`; **no image element is rendered at all** when `image_path` is null (spec §13 — no broken or misleading placeholders).

---

## K. Waiter UI structure

Optimised for an always-on tablet in landscape, fully usable on a phone.

| Screen | Route | Content & states |
|---|---|---|
| **Login** | `/waiter/login` | Email + password, single role, generic error on failure, rate-limit notice after repeats. First successful login also unlocks the audio context for alert sounds (browser autoplay policy). |
| **Dashboard** | `/waiter` | Header counters: **new orders**, **checkout requests**. Table grid colour-coded by derived state (free / occupied / order pending / checkout requested), each tile showing table label, session age, order count, running total. Persistent alert banner while any notification is `PENDING`. Empty: "No open tables". Offline: amber "Reconnecting — showing last known state", never a blank screen. |
| **Pending queue** | `/waiter/orders` | Newest-first list: order number, table, time, item count, total, an "unseen" marker until opened. Empty: "No orders waiting". |
| **Order review / edit** | `/waiter/orders/[id]` | Full line items, **customer special request shown prominently**, total. Editing: quantity steppers, remove line, add item via searchable picker, waiter note, optional reason. A live "Original submission ↔ current" comparison so the waiter always sees what the guest actually asked for. Actions: **Confirm order** (primary), Save changes, Back. `409 REVISION_CONFLICT` → "Another device changed this order" + reload. |
| **Table / session detail** | `/waiter/sessions/[id]` | Every order in the session with numbers, times, statuses, totals; session total; checkout state; **Close session** (guarded, see I3); link to audit. |
| **Checkout requests** | `/waiter/checkout` | Requests oldest-first with wait time, table, session total, "Go to table" → session detail. Closing requires an explicit "Payment taken at POS" confirmation step. |
| **Availability** | `/waiter/menu` | Searchable, category-filtered list of every item with an availability toggle; optimistic UI with rollback on failure; "Sold out today" count; bulk restore-all action. |
| **Audit / history** | `/waiter/sessions/[id]/audit`, `/waiter/orders/[id]/audit` | Chronological events: time, actor, action, before → after. Read-only by construction. |

Cross-cutting: connection-status pill (live / reconnecting / offline); alert sound repeats every 30 s while anything is unacknowledged; Wake Lock API keeps the tablet awake; every destructive or irreversible action (confirm, close session, force-close) has a confirmation step.

---

## L. Order / session state machine

### L1. Order

```
                    ┌──────────────────────────────────────┐
 (client-only DRAFT)│                                      │
        │            submit                                │
        ▼                                                  │
   ┌───────────┐  waiter opens   ┌──────────────────┐  confirm   ┌───────────┐
   │ SUBMITTED │────────────────▶│ EMPLOYEE_REVIEW  │───────────▶│ CONFIRMED │ (terminal)
   └───────────┘                 └──────────────────┘            └───────────┘
        │                               │
        └──────────────┬────────────────┘
                       ▼  waiter only, reason required
                  ┌───────────┐
                  │ CANCELLED │ (terminal)
                  └───────────┘
```

- `DRAFT` lives **only in the customer's browser** (localStorage cart). It is never persisted server-side — a cart is not an order, and persisting it would create phantom orders in the waiter's queue.
- Edits are permitted in `SUBMITTED` and `EMPLOYEE_REVIEW`, never in `CONFIRMED`. A confirmed order that must change becomes a **new order** (matching the real workflow: the waiter has already keyed it into the POS).
- `CANCELLED` exists per spec §5.1 but is **waiter-only**; the customer interface has no path to it (C15).
- Every transition is a domain function returning `Result<Order, DomainError>`, unit-tested exhaustively including illegal transitions.

### L2. Session

```
  AVAILABLE ──scan / waiter opens──▶ OCCUPIED ◀──────────┐
 (no open row)                          │                │
                                        │ order submitted│ all orders confirmed
                                        ▼                │
                                  ORDER_PENDING ─────────┘
                                        │
                     customer requests checkout (from either state)
                                        ▼
                             CHECKOUT_REQUESTED
                                        │  waiter closes AFTER POS payment
                                        ▼
                                     CLOSED  ──▶ table becomes AVAILABLE
```

Rules: `AVAILABLE` is derived from the absence of an open session (enforced by the partial unique index). A checkout request **never** closes the session (S8). New orders are still accepted while `CHECKOUT_REQUESTED` (a guest may add a coffee after asking for the bill) and the session returns to `ORDER_PENDING` display-wise while keeping `checkout_requested_at`. `CLOSED` is terminal and irreversible; a re-scan creates a **new** session with a new session number. Orders and audit survive closure indefinitely.

---

## M. Order revision / versioning model

The requirement — the guest's original order is never silently overwritten — is met with **four** reinforcing mechanisms:

1. **Revision 0 is written at submit time**, in the submit transaction, typed `ORIGINAL_SUBMISSION`, containing the complete snapshot. It exists before any waiter can touch the order.
2. **Every material waiter edit writes a new revision** with both `before_snapshot` and `after_snapshot` in full.
3. **Confirmation writes a `FINAL_CONFIRMED` revision**, so "what was actually served and keyed into the POS" is a single row, distinct from the working state.
4. **The revision table is physically append-only** (H5): the application role has no `UPDATE`/`DELETE`, and triggers reject both.

Worked example from the brief:

| Rev | Type | Items | Total | Actor |
|---|---|---|---|---|
| 0 | `ORIGINAL_SUBMISSION` | 2× Phở Bò, 1× Coke | 49.00 | customer device, 19:12:04 |
| 1 | `WAITER_EDIT` | 1× Phở Bò, 1× Coke | 24.50 | Anna, 19:15:31, reason "guest changed mind" |
| 2 | `WAITER_EDIT` | 1× Phở Bò, 1× Coke, 1× Vietnamese Coffee | 30.00 | Anna, 19:16:02 |
| 3 | `FINAL_CONFIRMED` | 1× Phở Bò, 1× Coke, 1× Vietnamese Coffee | 30.00 | Anna, 19:16:20 |

Each row carries the previous and the new state, so any version is one read away and the whole chain reconstructs without replay. `orders.current_revision_number` points at the working head and drives optimistic concurrency via `If-Match`.

**What counts as "material"** (creates a revision): adding or removing a line, changing a quantity, changing the customer or waiter note, cancelling. **Not material** (audit event only, no revision): opening the order for review, acknowledging a notification. This keeps the revision chain meaningful rather than noisy — flag if you want review-opens versioned too.

Additional customer submissions always create a **new order with a new order number**; they never touch an existing order's rows (S6).

---

## N. Audit trail model

Every state-changing action writes an `audit_events` row **in the same transaction as the change**, so history cannot drift from state.

Captured: event id · server timestamp · actor type (`CUSTOMER`/`WAITER`/`SYSTEM`) · actor id (user id, or device id for a guest — never PII) · action code · entity type and id · table / session / order context · `before_value` · `after_value` · metadata (request id, revision number, reason, hashed IP).

Minimum event catalogue: `SESSION_OPENED`, `SESSION_CLOSED`, `SESSION_FORCE_CLOSED`, `CHECKOUT_REQUESTED`, `ORDER_SUBMITTED`, `ORDER_OPENED_FOR_REVIEW`, `ORDER_ITEM_ADDED`, `ORDER_ITEM_REMOVED`, `ORDER_ITEM_QTY_CHANGED`, `ORDER_NOTE_CHANGED`, `ORDER_CONFIRMED`, `ORDER_CANCELLED`, `MENU_ITEM_SOLD_OUT`, `MENU_ITEM_RESTORED`, `MENU_IMPORTED`, `TABLE_GROUP_CREATED`, `TABLE_GROUP_DISSOLVED`, `QR_TOKEN_ROTATED`, `USER_LOGIN_SUCCEEDED`, `USER_LOGIN_FAILED`, `NOTIFICATION_ACKNOWLEDGED`.

Retention: audit and revisions outlive sessions and orders permanently; closing a session or deactivating a menu item never deletes history. Menu items are **soft-deleted** (`is_active = false`) precisely so historical orders keep resolving.

---

## O. QR-code architecture

**Token.** 128 bits from a CSPRNG, base64url-encoded → 22 characters, e.g. `t/9fK2pQx7Lm4RzB1cVnHw`. Not derived from the table number, not sequential, not enumerable. `qr_token_version` allows rotating a compromised or reprinted code while all history stays attached to the same table row.

**URL.** `https://<domain>/t/<token>` — nothing else in the URL, no table number, no query parameters, no PII (privacy rule: never put identifiers in query strings that end up in logs and referrers).

**Why the token is not a bearer credential.** A printed QR is visible to anyone in the room; treating it as a long-lived secret would be self-deception. So the token's only power is *"start or join the session at this table"*. The moment it is resolved, the server issues the signed, httpOnly `aw_dsid` cookie, and **every** subsequent API call authorises against that cookie. Consequences: a guest cannot read or modify another table's session by swapping a token in a request body (the cookie, not the body, decides); photographing a QR and using it later still only ever reaches that one table; rate limiting on `/api/qr/resolve` blocks scanning for valid tokens.

**Resolution algorithm.**
```
resolve(token):
  table = active table with this qr_token         → else 404 QR_INVALID
  if table is a member of an ACTIVE group:
      if group.qr_policy == PRIMARY_ONLY and table != group.primary_table:
          → route to the group's open session (or a friendly "please scan table N")  [E4]
      session = open session of the group
  else:
      session = open session for this table
  if no open session: create one (OCCUPIED, session_number = nextval)  → audit SESSION_OPENED
  issue/refresh aw_dsid cookie; register or touch customer_device
  return table label + session context
```

**Additional orders.** A re-scan finds the same open session and the same device row; a new cart becomes a new order in that session. Nothing existing is mutated.

**Combined tables.** `table_groups` + `table_group_members` + `dining_sessions.table_group_id` carry the structure; `qr_policy` carries the operating rule. Both rules are implementable without a schema change — which is exactly the "structurally capable, operationally undecided" state the spec asks for (E4).

**Session closure.** Waiter-only, after POS payment, audited. The table's `AVAILABLE` state returns automatically because the partial unique index no longer sees an open session.

**Print assets.** `pnpm qr:generate` emits per-table SVG + PNG + a print-ready A6 PDF (QR, table label, "Scan to order", trilingual hint). Demo set: Table 01/02/03, watermarked `DEMO`. Production QR codes are generated only after the real table list arrives.

---

## P. Authentication / authorization architecture

| Concern | Phase 1 |
|---|---|
| Waiter identity | Email + password, `users.role = WAITER`, `is_active` gate |
| Hashing | **Argon2id** (memory 19 MiB, t=2, p=1 — OWASP baseline), per-user salt |
| Sessions | Auth.js database sessions; httpOnly + Secure + SameSite=Strict cookie; 12-hour idle expiry (a shift), absolute 24 h |
| Brute force | Per-account and per-IP rate limiting, exponential backoff, temporary lockout, `USER_LOGIN_FAILED` audited; identical error text for wrong email and wrong password |
| Authorization | Route-group middleware: `/waiter/**` and `/api/waiter/**` require an authenticated active WAITER. **Every handler re-checks** — middleware is a convenience, not the boundary |
| Customer | No account, no login, no PII. Authority is the signed `aw_dsid` cookie only; it grants access to exactly one session and is invalidated when that session closes |
| Password management | Phase 1: a CLI (`pnpm user:create`, `pnpm user:reset-password`) run by the operator. No self-service reset flow, because there is no email address on file to send it to and inventing one is out of scope |
| Phase 2 seam | `AuthProvider` interface; swapping in an IdP/SSO or adding MANAGER/KITCHEN roles touches the provider and a permission map, not the routes. `role` is already an enum column |

Not built, and deliberately: customer accounts, OAuth, MFA, password self-reset, multi-tenant. Say the word if any is wanted.

---

## Q. Notification architecture

**Authority.** The `notifications` table is the source of truth. SSE is only a delivery accelerator. If every transport fails, the waiter still sees everything on the next dashboard load — this is the spec's explicit requirement (§11) and it drives the whole design.

**Transport ladder.**
1. **SSE** `GET /api/waiter/stream`, authenticated by the waiter cookie. The server subscribes to Postgres `LISTEN waiter_events`; committed changes fan out to every connected device. 20-second heartbeat comments keep proxies from idling the connection.
2. **Automatic reconnect** — `EventSource` retries natively; on reopen the client calls `GET /api/waiter/notifications?status=pending` and reconciles, so nothing is missed during a gap.
3. **Polling fallback** — if SSE fails to establish or drops 3× in 60 s, the client falls back to polling the pending queue every 10 s and shows a "degraded connection" pill.
4. **Web Push** — not in Phase 1 (E12); the schema and service worker leave room for it.

**Alerting.** Visual: a persistent banner plus a count badge, cleared only by acknowledgement, never by a timer. Audible: a short chime on arrival, repeating every 30 s while anything is `PENDING`; the audio context is unlocked at login because browsers block autoplay before a user gesture; mute is per-device and persisted locally. Vibration via `navigator.vibrate` where supported (phones). The tablet holds a Wake Lock so the screen stays live.

**Payload.** Table label, order number, submitted-at (local time), item count, total, and a direct **Open** action deep-linking to the order.

**Lifecycle.** `PENDING` on creation → `delivered_at` stamped when pushed → `ACKNOWLEDGED` when the waiter opens the order or explicitly acknowledges; confirming an order auto-acknowledges its notification. Multiple devices stay consistent because acknowledgement is a server-side state change that fans out to all of them.

---

## R. Security architecture

| Threat | Control |
|---|---|
| Table-number guessing / cross-table access | 128-bit non-guessable QR tokens; authority lives in the signed session cookie, not in request parameters; every customer query is scoped by `session_id` from that cookie |
| Session hijack | httpOnly + Secure + SameSite cookies, HMAC-signed, invalidated on session close; no session identifier in any URL |
| Price tampering | Client prices are **ignored**; totals recomputed from the DB inside the submit transaction |
| Ordering sold-out items | Availability re-checked in the same transaction, not just at render time |
| Duplicate orders | `Idempotency-Key` + unique constraint + stored response replay; client submit lock; soft duplicate-content warning (E11) |
| Concurrent waiter edits | `If-Match` on `current_revision_number` → `409 REVISION_CONFLICT` |
| SQL injection | Prisma parameterised queries; the few raw statements use bound parameters only |
| XSS | React escaping by default; no `dangerouslySetInnerHTML`; strict CSP (`default-src 'self'`, no inline scripts, nonce-based where unavoidable); menu text is data, rendered as text |
| CSRF | SameSite=Strict on waiter cookies + origin/referer check + CSRF token on every waiter mutation; customer mutations additionally require the `aw_dsid` cookie the attacker's site cannot read |
| Brute force / abuse | Rate limits: `/api/qr/resolve` 10/min/IP, `POST /api/orders` 5/min/session, `/api/auth/signin` 5/min/IP + per-account backoff, global per-IP ceiling |
| History tampering | Append-only via role grants **and** triggers; corrections are new rows |
| Secret leakage | All secrets from environment variables, never committed; `.env.example` documents names only; Pino redacts tokens, cookies and authorisation headers |
| Information disclosure in errors | Stable error codes, localised generic messages, stack traces server-side only |
| Transport | HTTPS enforced outside localhost, HSTS, secure cookies |
| Privacy | No name, phone, email, or payment data is ever collected; IPs are stored only as salted hashes in audit metadata; GDPR/revDSG exposure stays minimal by design |
| Dependency risk | Lockfile committed, `pnpm audit` in CI, Dependabot |

---

## S. Testing strategy

**Unit (Vitest, no I/O)** — order and session state machines including every illegal transition; money arithmetic in integers; the revision engine (snapshot construction, diff classification, material vs non-material); availability and price validation; order-number formatting; i18n fallbacks; QR token generation entropy and shape.

**Integration (Vitest + a real Postgres in Docker)** — because the guarantees that matter *are* database behaviour:
- submit → order number, timestamps, revision 0, audit event, notification all created atomically;
- the same `Idempotency-Key` twice → exactly one order, identical response;
- **concurrency:** 20 parallel submits → 20 distinct order numbers, zero deadlocks;
- **concurrency:** two waiters editing one order → one wins, the other gets `409`;
- sold-out item at submit → `409 ITEMS_UNAVAILABLE`, nothing written;
- tampered client price → server price wins;
- `UPDATE`/`DELETE` on `audit_events` and `order_revisions` → rejected;
- session isolation: session A's cookie cannot read session B's orders (asserted for every customer endpoint);
- unauthenticated and wrong-role access to every `/api/waiter/*` route → 401/403;
- partial unique index → a second open session per table is impossible;
- close session → subsequent customer calls with the old cookie fail cleanly.

**E2E (Playwright)** — customer at 375×812 and waiter at 1024×768, running against a seeded database:
1. scan → language → browse → add → special request → submit → order number shown → continue browsing;
2. invalid QR → friendly error, no data leak;
3. double-tap submit → exactly one order in the DB;
4. waiter login → notification appears → open → edit quantity → confirm → leaves the queue → audit shows before/after;
5. second order in the same session → new number, first order unchanged;
6. sold-out toggle → customer cannot add, badge visible; restore → addable again;
7. checkout request → waiter notified → session stays open → close after payment → table free → re-scan creates a *new* session;
8. reconnect: kill the SSE stream, submit an order, restore → the pending notification is recovered.

**Non-functional** — Lighthouse (performance + a11y + PWA) on the customer menu; axe-core accessibility assertions in E2E; no horizontal scroll at 320 px asserted programmatically.

**Manual restaurant acceptance** — a printed checklist mapped 1:1 to spec §14.1 and §21, run on a real phone and the real tablet over the restaurant's actual Wi-Fi, including a deliberate offline/airplane-mode test.

**Honesty rule I will hold to:** I will report actual test output after every stage, including failures, and never describe something as working that I have not run.

---

## T. Development phases

Each milestone is independently testable and ends with real executed tests. No giant monolithic drop.

| M | Deliverable | Definition of done |
|---|---|---|
| **M0** | Repo, TypeScript strict, lint/format, Docker Compose (app + Postgres), CI, `.env.example`, README skeleton | `pnpm dev` and `pnpm test` run clean on a fresh clone |
| **M1** | Schema + migrations + sequences + append-only triggers + grants; menu importer; seed (demo tables 01–03, one test waiter) | Migrations apply from empty; all 50 CSV rows import (subject to E1); re-import is idempotent; append-only rejection test passes |
| **M2** | Domain core: state machines, numbering, revision engine, pricing, audit writer, `PosAdapter` and other Phase-2 ports | Full unit suite green; illegal transitions rejected; zero framework imports in `src/domain` |
| **M3** | Customer API + menu API + i18n scaffolding + idempotency + rate limiting | Integration suite green incl. concurrency, idempotency and session-isolation tests |
| **M4** | Customer PWA: landing, menu, detail, cart, submit, my-orders, checkout | E2E flows 1–3 green; Lighthouse a11y ≥ 95; no horizontal scroll at 320 px |
| **M5** | Waiter auth + dashboard + queue + review/edit/confirm | E2E flow 4 green; revision chain and audit verified in the DB; `409` conflict test green |
| **M6** | Notifications: queue, SSE, `LISTEN/NOTIFY`, sound, reconnect recovery, polling fallback | E2E flow 8 green; killing the stream loses nothing |
| **M7** | Availability management, checkout handling, session close, session/audit views | E2E flows 5–7 green |
| **M8** | QR generation CLI + printable demo assets | Scanning a generated demo QR on a real phone opens the right table |
| **M9** | Hardening: CSP, security headers, error contract, a11y pass, stale-session job, full E2E suite, load sanity check | All suites green; `pnpm audit` clean; manual acceptance checklist drafted |
| **M10** | Demo deployment + README, API docs, ADRs, operator guide, Phase 2 extension notes | A third party can reproduce the deployment from the docs alone |

Dependencies: M1→M2→M3→{M4, M5}→M6→M7→M8→M9→M10. M4 and M5 can proceed in parallel once M3 is stable.

---

## U. Deployment strategy

Three environments: **local** (Docker Compose, seeded demo data), **staging/demo** (restaurant-testable, `DEMO DATA` banner, test credentials, no real guest data), **production** (only after your acceptance and after the real table list, drinks menu and branding arrive).

Artifact: a multi-stage Docker image (`node:22-alpine`, non-root user, `output: standalone`), run as one container plus managed Postgres. Deploy sequence: build → run `prisma migrate deploy` → health check `/api/health` → switch traffic. Hosting provider stays **OPEN** per the spec; the image runs on Fly.io, Railway, Hetzner/Coolify or any VPS with TLS. Requirements for whatever you pick: a long-running process (not serverless, because of SSE), managed Postgres with automated backups, and HTTPS.

Environment variables (names only; values never committed):
`DATABASE_URL`, `AUTH_SECRET`, `CUSTOMER_COOKIE_SECRET`, `APP_BASE_URL`, `RESTAURANT_TIMEZONE` (E8), `RESTAURANT_CURRENCY=CHF`, `NODE_ENV`, `LOG_LEVEL`, `RATE_LIMIT_*`, `SESSION_IDLE_TIMEOUT_HOURS` (E6), `FEATURE_COMBINED_TABLES` (E4), `DEMO_MODE`.

Operations: daily automated `pg_dump` plus point-in-time recovery, retention ≥ 30 days, and a **restore rehearsal before go-live** — an untested backup is not a backup. Structured logs shipped to the provider's log sink; `/api/health` checks DB connectivity and migration state. Weekly patch review; menu changes are data, never deploys.

---

## V. Risks and mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Stale session** — party leaves without checkout, next party inherits their orders | Wrong bill, direct financial harm | Session age on every tile, two-tap close, 4-hour idle auto-close with audit, per-session running total visible before payment (E6) |
| 2 | **Curry rows carry two proteins** (E1) | Kitchen gets an ambiguous order; allergen display is wrong | BLOCKING question answered before the importer is finalised |
| 3 | **Allergen legend incomplete** (E2) | Legal/health exposure | Use the printed menu's full 14-code legend; confirm with the restaurant |
| 4 | **Combined-table rule undecided** (E4) | Orders routed to the wrong session | Data model supports both; feature-flagged off; decision required before real use |
| 5 | **Waiter misses a notification** (tablet asleep, muted, offline) | Order never served | Server-side authoritative queue, persistent banner, repeating sound, Wake Lock, reconnect reconciliation, polling fallback |
| 6 | **Restaurant Wi-Fi drops mid-submit** | Duplicate or lost order | Idempotency key reused across retries; explicit retry UI; network-only fetch for order paths (never a stale cached success) |
| 7 | **Double POS entry / transcription error** (manual step is outside the system) | Wrong bill | Confirmed order screen laid out for fast, unambiguous keying; order number printed prominently for cross-reference; Phase 2 `PosAdapter` removes the step entirely |
| 8 | **SSE blocked by a proxy** | No live alerts | Automatic polling fallback + visible degraded-connection indicator |
| 9 | **QR replaced or defaced by a third party** | Guests routed elsewhere | Tokens are per-table and rotatable; staff visual check; a rotated token invalidates the old one immediately |
| 10 | **Guest abuse** (spam orders from the street via a photographed QR) | Nuisance orders | Rate limits per session/IP, waiter confirmation before anything reaches the kitchen, waiter can close and reopen a session |
| 11 | **Menu changes silently alter historical orders** | Audit inconsistency | Name, price and allergens are snapshotted on every order line; menu items are soft-deleted, never hard-deleted |
| 12 | **Drinks data arrives with a different shape** | Rework | `kind` discriminator and an importer written against the same column contract from day one |
| 13 | **Scope creep toward Phase 2** | Delay | Phase 2 exists only as unimplemented interfaces; anything beyond them needs an explicit new go-ahead |
| 14 | **Branding arrives late** | Rework of visuals | Design tokens (colour, type, radius) centralised in one theme file; a rebrand is a token change, not a component rewrite |

---

## W. Repository structure (spec deliverable M)

```
asiaway-qr/
├─ docker-compose.yml · Dockerfile · .env.example · README.md
├─ prisma/
│   ├─ schema.prisma
│   ├─ migrations/            # incl. raw SQL: sequences, triggers, grants, partial indexes
│   └─ seed.ts                # demo tables 01–03, test waiter — DEMO only
├─ data/
│   └─ menu_trilingual_EN_DE_VI.csv      # canonical import input (versioned)
├─ scripts/
│   ├─ import-menu.ts         # CSV → DB, idempotent, validating (section J/menu import)
│   ├─ generate-qr.ts         # per-table SVG/PNG/printable PDF
│   ├─ extract-menu-photos.ts # pull dish JPEGs out of the source PDF (review before use)
│   └─ create-user.ts
├─ src/
│   ├─ domain/                # FRAMEWORK-FREE CORE — the heart of the system
│   │   ├─ order/             # state machine, revisions, pricing, numbering
│   │   ├─ session/           # session state machine, table groups
│   │   ├─ menu/              # availability rules
│   │   ├─ audit/             # event catalogue + writer contract
│   │   └─ ports/             # PosAdapter, KitchenRouter, PaymentProvider,
│   │                         # NotificationChannel, AnalyticsSink  (Phase 2 seams)
│   ├─ server/
│   │   ├─ db/ · repositories/ · services/   # transaction orchestration
│   │   ├─ auth/ · notifications/            # Auth.js config; SSE hub + LISTEN/NOTIFY
│   │   └─ http/                             # zod schemas, idempotency, rate limit, errors
│   ├─ app/
│   │   ├─ t/[token]/ · menu/ · cart/ · orders/ · checkout/     # customer
│   │   ├─ waiter/ (login, dashboard, orders, sessions, menu, audit)
│   │   └─ api/                                                  # route handlers (thin)
│   ├─ components/ (ui/, customer/, waiter/)
│   ├─ i18n/ + messages/{en,de,vi}.json
│   └─ lib/ (money, datetime, format)
├─ tests/ (unit/, integration/, e2e/, fixtures/)
├─ public/images/menu/         # only real photos; absent file ⇒ no <img> rendered
└─ docs/ (ARCHITECTURE.md, API.md, OPERATOR_GUIDE.md, DEPLOYMENT.md, adr/, PHASE2.md)
```

---

## X. Menu import plan (spec deliverable J)

**Input:** `menu_trilingual_EN_DE_VI.csv`, UTF-8 with BOM, 10 columns, 50 rows across 5 food categories (Appetizer 18, Noodle Soup 8, Noodles 8, Wok & Rice 8, Fish & Curry 8). Zero drinks — and none will be invented.

**Stable keys.** `Dish No.` is not unique (E3), so the importer derives `external_key = slug(category) + ':' + dish_no + ':' + slug(name_en)` (e.g. `appetizer:12:fresh-summer-roll-beef`). Re-running the import **updates** matching rows and never duplicates them. Items absent from a later CSV are deactivated (`is_active=false`), never deleted, so historical orders still resolve.

**Validation, fail-fast with a line-numbered report:** all three names and all three descriptions non-empty; price parseable, > 0, converted to integer Rappen (`12.5 → 1250`); allergen codes all in the legend (this is what surfaced the `/` problem in E1); category recognised; no duplicate `external_key`.

**Prices** are stored as integer minor units. The printed menu states prices are CHF **incl. MWST** (E9).

**Photos.** The source PDF contains ~18 print-resolution JPEGs, and its captions identify the dish (`n° 12`, `n° 14`, `n° 15`, `n° 17`, `n° 18`, `n° 23`, `n° 43`, `n° 44`, `n° 45`, `n° 52`, `n° 56`, `n° 57`, `n° 61`, `n° 64`, `n° 65`, `n° 91`, `n° 94`). `scripts/extract-menu-photos.ts` extracts them and proposes a mapping from those captions — **for your review**. Nothing is attached to a dish until you confirm the mapping, and items without a confirmed photo render with **no image element at all**. Note that caption n° 91 reads "Red Curry with Beef", which under E1 would map to a specific split item.

**Ongoing maintenance.** Prices, names, descriptions and allergens change by re-running the import from an updated CSV (`MENU_IMPORTED` audit event). Availability changes happen live in the waiter UI and never require an import or a deploy. The drinks menu, when it arrives, imports through the same path with `kind=DRINK`.

---

## Y. Phase 2 readiness (spec deliverable R)

Interfaces defined in `src/domain/ports/`, each with exactly one Phase 1 implementation and **no vendor named anywhere**:

- `PosAdapter` → `ManualPosAdapter` records "confirmed, keyed manually by <waiter>". A real POS becomes a second implementation; the ordering domain does not change.
- `KitchenRouter` / `BarRouter` → no-ops. `menu_categories.kind` and per-item routing metadata are already the discriminator a future KDS/printer would use.
- `PaymentProvider` → `ExternalPosPayment` (records that payment happened outside the system). Online payment becomes another implementation plus a session state, not a redesign.
- `AnalyticsSink` → no-op. The audit event stream is already a complete, append-only event log, which is exactly what reporting needs later.
- Roles: `user_role` is an enum; MANAGER/KITCHEN/ADMIN are additive.
- Offline resilience: the idempotency infrastructure built in Phase 1 is the prerequisite for a future offline queue on restaurant devices.

None of this is built now. Each is a named seam so Phase 2 is an addition rather than a rewrite.

---

## Decisions I made on my own authority (technical freedom only)

For the record, so nothing is hidden: stack choice (F/G), integer money storage, full-snapshot revisions rather than diffs, SSE over WebSocket, the two-layer append-only enforcement, the cookie-over-token authorisation model, `external_key` derivation for the importer, and the repository layout. Every one of these is a technical implementation choice inside the freedom the spec grants, and each is reversible. **No restaurant workflow, price, menu item, table, drink, POS, brand or hosting provider has been invented.**

---

**STOP — awaiting approval.** Blocking questions E1–E4 need answers before the menu importer and combined-table behaviour can be finalised. E5–E12 have safe defaults and only need a "yes, fine" or a correction.
