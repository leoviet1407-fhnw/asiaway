# AsiaWay Staff – Bestellungen & Wareneingang (Phase 1)

Internal staff app for AsiaWay: staff prepare supplier orders per restaurant, one orderer reviews and emails them with a PDF, and deliveries are checked in by scanning barcodes with a phone camera.

- Spec: [`../STAFF_APP_PHASE1_SPEC.md`](../STAFF_APP_PHASE1_SPEC.md) · Plan: [`../STAFF_SUPPLY_STOCK_PLAN.md`](../STAFF_SUPPLY_STOCK_PLAN.md)
- Later address: `staff.asiaway.ch`, linked from the WordPress hub `asiaway.ch/staff/`
- **This repository must stay PRIVATE.** It holds supplier prices and stock logic. The QR-menu repos are public; this one is not.

> All suppliers, items, prices and EANs in it are **sample data** (sample EANs use the in-store 20–29 prefix, so they never match a real product). The real lists replace them through the CSV import.

## Run it locally

You need Node 22 or later. There is no database server, no Docker and no email account to set up.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. On first start the app creates a local PostgreSQL (PGlite, under `.pglite/`), runs the migrations and loads the sample data.

### Sample logins (local only)

The password for all of them is `asiaway-dev`. You can change it with `SEED_PASSWORD` before the first start.

| Email | Role | Sees |
|---|---|---|
| `admin@asiaway.test` | Admin | everything; edits items and suppliers |
| `besteller@asiaway.test` | Orderer (Besteller) | all locations; reviews and sends orders |
| `oerlikon@asiaway.test` | Staff | Oerlikon |
| `winti-vn@asiaway.test` | Staff | Winterthur Vietnamesisch |
| `winti-th@asiaway.test` | Staff | Winterthur Thai |

The sample data comes with four orders: an Oerlikon draft, a submitted Winterthur VN order (waiting for the orderer), and two sent orders ready for goods-in (Winterthur Thai, Oerlikon).

To start over, stop the dev server, delete `.pglite/` and start it again.

### Try the flows

1. **Draft → review → send**: as `oerlikon@…` open *Neue Bestellung*, pick a supplier, set quantities, then *Zur Prüfung einreichen*. As `besteller@…` open it from *Zur Prüfung*, check the email preview and the PDF, then *An Lieferant senden*. In development the email is **not sent**. It is printed in the terminal and written with its PDF to `.outbox/`.
2. **Goods-in**: as `winti-th@…` go to *Wareneingang*, tap the delivery, and scan or type the EANs into the manual field (a Bluetooth hand scanner works there too). Fresh goods: tap the line, then *Wie bestellt* or enter the weight. Then *Prüfen & abschliessen* shows missing / short / extra / wrong. Choose *Rest kommt noch* (the order stays open for the next delivery) or *Abschliessen*.

   Sample codes for the Winterthur Thai order: coconut milk case `2001009000006` (one can: `2101009000003`), fish sauce case `2001005000000`, red curry `2001010000002`, green curry `2001011000001`, prawns `2002001000001`. Not ordered: Saigon beer `2004001000005`. Unknown: `4006381333931`.

### Test on a phone

The camera only works over HTTPS (or on `localhost`). To try it on a phone in the same Wi-Fi, run:

```bash
npx next dev --experimental-https -H 0.0.0.0
```

Then open `https://<laptop-ip>:3000` and accept the certificate warning. The service worker (installable PWA) is active only in production builds, or in development with `?sw=1`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local app with PGlite and sample data |
| `npm test` | Unit and integration tests (vitest; each file gets a fresh in-memory Postgres) |
| `npm run typecheck` | TypeScript strict |
| `npm run build` / `npm start` | Production build / server (needs `DATABASE_URL`) |
| `npm run seed` | Load sample data into an empty database (refuses `DATABASE_URL` unless `SEED_ALLOW_PROD=1`) |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (the app also does this on boot) |
| `npm run user:add -- --email … --name … --role STAFF --location oerlikon` | Create a personal login (prints a one-time password unless `ADD_USER_PASSWORD` is set) |
| `npm run items:import -- file.csv [--apply]` | Import the item/price list. Dry run unless `--apply`. Format: `data/items-template.csv` |
| `npm run icons` | Redraw the PWA icons |

Stop `npm run dev` before running a CLI command against the local PGlite database. PGlite allows one process at a time.

## Configuration

Copy `.env.example` to `.env.local`. **Never commit a filled-in env file.**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL. Required in production; without it, dev uses PGlite |
| `MAIL_TRANSPORT` | `console` (default: log + `.outbox/`) or `smtp` |
| `SMTP_URL` | e.g. `smtps://user:pass@mail.example.ch:465` when `MAIL_TRANSPORT=smtp` |
| `ORDER_FROM_EMAIL` | Sender of order emails |
| `ORDER_CC_EMAIL` | Optional archive copy of every order email |
| `SEED_PASSWORD` | Password for the sample users |

## How it is built

Same stack and patterns as the QR-menu apps (`asiaway-winterthur`, `asiaway-oerlikon`): Next.js 15 (App Router, server actions), React 19, TypeScript strict, Tailwind, drizzle-orm on PostgreSQL, PGlite for local dev and tests, plain SQL migrations with a ledger and advisory lock, vitest.

```
migrations/0000_init.sql       schema (source of truth; src/server/db/schema.ts mirrors it)
src/domain/                    pure rules: order states and permissions, EAN check digits,
                               scan interpretation, discrepancy classification
src/server/services/           order-service (draft → submit → send), receiving-service
                               (receipts, absolute-quantity sync, photos, completion), catalog
src/server/mail/, pdf/         pluggable mailer (console / smtp / memory), order email text, A4 PDF (pdf-lib)
src/server/auth/               personal logins: scrypt hashes, hashed session tokens, login throttling
src/server/import/             CSV import of the real item lists
src/app/(app)/                 screens (German, mobile-first)
src/components/Scanner.tsx     camera scanning: BarcodeDetector, falls back to ZXing (lazy-loaded)
public/sw.js, manifest         installable PWA; caches static assets only, never order data
```

Some design points:

- **Sending happens once.** The order row is locked, the PDF is rendered and emailed, and only then is the order marked SENT with the PDF archived. If the email fails, nothing changes.
- **Goods-in is offline-safe.** The phone keeps the receipt in localStorage and syncs **absolute** quantities, so a retry after a dropped connection can never count twice.
- **Partial deliveries.** Each delivery is its own receipt. The next one expects only what is still open.
- **Fresh goods** sold by weight count as complete within ±5 %.
- **Audit**: every create, submit, send, receive and admin edit is written to `audit_events`.

## Not done yet (Phase 1 → next)

- Real supplier and item lists. The `.xlsx` import is a TODO; for now save Excel files as CSV.
- A user admin screen (use `npm run user:add` for now), and password reset.
- Real SMTP account and sender address; hosting (EU Postgres with backups); `staff.asiaway.ch` DNS.
- Phase 2 (stock ledger, counting, par levels) and Phase 3 (SumUp), as described in the plan.
