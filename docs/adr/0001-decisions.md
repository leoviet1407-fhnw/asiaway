# ADR 0001 — Phase 1 decisions of record

Status: accepted · Date: 2026-09-20

## Restaurant decisions (answered by the client, not chosen by the implementer)

| Ref | Question | Decision |
|---|---|---|
| **E1** | Curry rows bundled two proteins in one priced line | Split into one item per protein, numbered `90.1 Chicken`, `90.2 Tofu`, `90.3 Beef`, `90.4 Prawn`. Same format applied to n° 12 Fresh Summer Roll. 50 CSV rows → **56 orderable items**. |
| **E2** | Spec legend listed 13 allergen codes; printed menu lists 14 | The printed menu wins. **G = Milk / Milch** is included. All 14 codes seeded. |
| **E3** | Dish numbers were not unique in the source | Resolved by E1's sub-numbering: every item now has a unique printed number. Numbers are display labels; internal UUIDs are the keys. |
| **E4** | Which QR applies when tables are joined | **The lowest-numbered joined table anchors the session.** Implemented as `ANY_MEMBER`: scanning any joined table's QR reaches that one shared session, so a guest at the far end never hunts for the "right" code. The stricter `PRIMARY_ONLY` rule is a one-value config change, no schema change. |
| — | Drinks | Not supplied. Zero drink rows exist. The `category_kind` discriminator is in place so drinks import later through the same path. |
| — | Stack | Web-based, as instructed. |

## Implementation decisions (technical freedom, reversible)

**Money as integer Rappen.** No float ever touches a price. `19.90 × 3` is exactly `5970`, asserted in `tests/unit/money.test.ts`.

**Full snapshots, not diffs, in `order_revisions`.** "Show me exactly what the guest originally ordered" is a single row read with no replay logic. Replay code is where history quietly rots.

**Append-only enforced twice.** Row-level triggers raise on `UPDATE`/`DELETE` of `audit_events` and `order_revisions` (verified in tests), *and* the production role `asiaway_app` is granted only `SELECT, INSERT` with `UPDATE, DELETE, TRUNCATE` explicitly revoked. Corrections are new rows.

**`AVAILABLE` is not a stored session status.** A table is available exactly when it has no open session, enforced by a partial unique index. Storing it would let the two disagree.

**Order numbers from a Postgres sequence** starting at 1001. `nextval()` is atomic and non-blocking, so 20 simultaneous submissions get 20 distinct numbers — asserted as a test, not assumed. Gaps after a rolled-back transaction are expected and harmless.

**QR token is not a bearer secret.** A printed code is visible to the whole room. Its only power is "start or join the session at this table"; resolving it issues a signed httpOnly cookie, and every later request authorises against that cookie.

**Client carries no price field.** `CartLineRequest` is `{menuItemId, quantity}`. A tampered request cannot express a price, because the type has nowhere to put one.

**Availability is enforced at submit, not only at render.** An item that sells out while it sits in a cart is caught inside the submit transaction.

**A waiter may add a sold-out item; a guest may not.** The waiter is standing at the table and knows what the kitchen has. Price still comes from the database in both paths.

**Status-only changes are audited but create no revision.** Otherwise the revision chain fills with "opened for review" noise and stops being a usable record of what was ordered. Confirmation always writes a revision, even with no content change.

## Deviations from the approved plan, and why

| Planned | Built | Reason |
|---|---|---|
| pnpm | **npm** | pnpm is not installed on this machine. |
| Prisma | **Drizzle ORM** | Drizzle runs against PGlite, so integration tests execute real Postgres locally. |
| Postgres via Docker for tests | **PGlite** (PostgreSQL 16.4 compiled to WASM, in-process) | No Docker on this machine. PGlite is real Postgres, not an emulation, so triggers, sequences, partial indexes and transactions are genuinely exercised. Production uses ordinary Postgres through the same schema and SQL. |
| Generated schema | **Hand-written SQL migration** + mirrored Drizzle schema | The guarantees that matter (sequences, append-only triggers, partial unique indexes, role grants) cannot be expressed by a schema generator. |

**What PGlite cannot verify locally:** role `GRANT`/`REVOKE`, because it runs single-user. That layer is `migrations/0001_grants.sql` and must be verified on staging. The trigger layer catches the same mistake and *is* verified here.

## Still open

Table list · drinks menu · photo→dish mapping sign-off · branding · production domain and hosting · POS (Phase 2) · session idle-timeout value (default proposed: 4 hours) · whether the meat declaration and VAT notice from the printed menu should appear in the app (recommended: yes, with restaurant-approved wording).

Category names in German and Vietnamese (`src/server/menu/import.ts`) are translations of the English source headings, flagged there for restaurant review. They are wording, not business data.
