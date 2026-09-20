# Asiaway QR Table Ordering — Phase 1

Mobile-first QR table ordering. A guest scans the code on their table, browses a
trilingual menu, and orders without an account, a name or an app. A waiter gets a
live alert, reviews and edits the order, confirms it at the table, and keys it
into the existing POS. Payment stays at the POS.

**Status: Phase 1 complete.** 163 automated tests pass against real PostgreSQL;
the whole guest and waiter journey has been exercised end to end against a
running server.

- [Plan and architecture](docs/ASIAWAY_PHASE1_ARCHITECTURE_PLAN.md)
- [Decisions of record](docs/adr/0001-decisions.md)
- [Operator guide (for the floor)](docs/OPERATOR_GUIDE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [API reference](docs/API.md)

## Quick start

No Docker and no database server needed for development — the dev database is
PGlite, real PostgreSQL 16 compiled to WebAssembly, running in-process.

```bash
npm install && npm run seed && npm run dev
```

The seed prints three table QR links and the demo staff login. Open a table link
on a phone (or in a browser) to order; open `/waiter` to work the floor.

Demo credentials are `waiter@asiaway.test` / `asiaway-demo-2026` and exist **only
in demo data** — the seed refuses to touch a real database unless explicitly
overridden.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | 163 tests: unit + integration against real PostgreSQL |
| `npm run typecheck` | TypeScript, strict |
| `npm run build` / `npm start` | Production build and standalone server |
| `npm run seed` | Demo tables, demo staff account, real menu |
| `npm run menu:preview` / `menu:import` | Validate / import the menu CSV |
| `npm run qr` | Printable table QR codes (SVG, PNG, A4 sheet) |
| `npm run user:create` | Create or update a staff account |
| `npm run db:migrate` | Apply SQL migrations to `DATABASE_URL` |

## What it does

**Guest** — scans a table QR · picks English, German or Vietnamese · browses food
and drinks with prices, allergens and photos where they exist · adds to a cart
that survives a reload · adds a free-text special request · sends the order ·
keeps browsing · orders again in the same session · sees the final order if staff
adjusted it · asks for the bill. No account, no name, no phone, no email.

**Waiter** — signs in · gets a live alert with sound that repeats until it is
opened · reviews the order with the guest's special request shown prominently ·
edits quantities, adds and removes items · confirms · marks dishes sold out and
restores them · handles bill requests · closes the session after POS payment ·
reads the full history of any order or table.

## The guarantees this system makes

**The guest's original order is never overwritten.** Revision 0 is written inside
the submit transaction, before any waiter can reach the order. Every edit adds a
revision carrying complete before and after snapshots, and confirmation writes a
`FINAL_CONFIRMED` revision. Any version is one row read away.

**History cannot be rewritten.** `audit_events` and `order_revisions` are
append-only twice over: triggers refuse `UPDATE` and `DELETE`, and the production
role is granted neither. Corrections are new rows.

**The client is never trusted for money.** The submit request has nowhere to put
a price — every unit price is read from the database inside the transaction that
creates the order.

**Order numbers cannot collide.** They come from a PostgreSQL sequence. Twenty
simultaneous submissions getting twenty distinct numbers is an assertion in the
test suite, not an assumption.

**A double tap cannot order twice.** Idempotency keys, reused across retries, with
the stored response replayed.

**No alert is lost.** The notification table is the source of truth; the live
stream only makes delivery fast. A tablet that was asleep, offline or behind a
hostile proxy recovers everything on reconnect, and falls back to polling.

**Tables cannot see each other.** The printed QR only starts or joins a session;
authority then lives in a signed httpOnly cookie, so swapping an identifier in a
request body reaches nothing.

## Menu data

`data/menu_trilingual_EN_DE_VI.csv` holds 50 source rows that expand to **56
orderable items** across five food categories: dishes printed as one line
covering several proteins are split into one item each, sub-numbered `90.1`,
`90.2`, `90.3`, `90.4`, each with its own price and its own allergen set.

**There are no drinks.** The drinks menu has not been supplied and none have been
invented; the food/drink split is already in the data model, so they import later
through the same path. No dish has a photo yet — an item without one renders no
image element rather than a placeholder.

Re-importing is safe: items match on a stable key, so an import updates in place,
an item missing from a later CSV is deactivated rather than deleted, and an
import never puts a dish the waiter marked sold out back on sale.

## Layout

```
src/domain/      framework-free business rules — no HTTP or ORM in any signature
  order/         state machine, cart validation, snapshots, revision engine
  session/       session state machine, combined tables, QR tokens
  menu/          allergen legend, bundled-row splitting
  audit/         event catalogue
  ports/         Phase 2 seams (POS, kitchen, payment, analytics) — all no-ops
src/server/      db, auth, services (transactions), menu import, notifications
src/app/         Next.js routes: guest pages, /waiter pages, /api
src/i18n/        UI strings in messages/{en,de,vi}.json — never inline
migrations/      SQL schema, append-only triggers, production grants
tests/           163 tests; integration runs on real PostgreSQL
```

## Deliberately not built

POS integration · kitchen or bar routing · online payment · analytics · customer
accounts · structured modifiers · customer-facing live order tracking. All are
Phase 2 or out of scope. `src/domain/ports/` marks where each attaches, and names
no vendor.

## Still needed from the restaurant

The real table list · the drinks menu · sign-off on mapping the photographs
inside the menu PDF to dishes · branding · the production domain and hosting
choice · confirmation of the 4-hour idle-session timeout and the `Europe/Zurich`
timezone · POS details, for Phase 2.
