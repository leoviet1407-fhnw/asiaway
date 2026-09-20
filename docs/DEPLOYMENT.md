# Deployment

## What this needs

- A **long-running Node process** — not a serverless function. Server-Sent
  Events and the notification hub both need a live process.
- **PostgreSQL 16** with automated backups.
- **HTTPS**, always, outside localhost.

The deliverable is a Docker image, so it runs on any host that satisfies those
three. **No hosting provider has been chosen** — that is still an open decision
for the restaurant. Fly.io, Railway, Hetzner with Coolify, or any VPS all work.

## Environments

| | Database | Data | Purpose |
|---|---|---|---|
| Local | PGlite under `.pglite/`, automatic | Demo seed | Development; no Docker needed |
| Staging / demo | Managed PostgreSQL | Demo seed, clearly labelled | Restaurant testing |
| Production | Managed PostgreSQL, backups on | Real menu, real tables | Only after acceptance |

## Environment variables

Copy `.env.example`. Generate each secret with `openssl rand -base64 48`.

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | production | Without it the app refuses to start in production |
| `CUSTOMER_COOKIE_SECRET` | production | Signs the guest session cookie; min 32 chars. Changing it logs out every guest |
| `AUTH_SECRET` | production | Reserved for the auth layer |
| `APP_BASE_URL` | yes | Public HTTPS address; **the QR codes encode it** |
| `NEXT_PUBLIC_RESTAURANT_TIMEZONE` | no | Default `Europe/Zurich` (confirm — open question E8) |
| `SESSION_IDLE_TIMEOUT_HOURS` | no | Default `4` (proposal E6) |
| `SEED_ALLOW_PROD` | no | Guard; the demo seed refuses a real database without it |

Secrets come from the host's secret store. Never commit a filled-in `.env`.

## First deployment

```bash
docker compose build
```
```bash
DATABASE_URL=postgres://... npm run db:migrate
```
```bash
DATABASE_URL=postgres://... npm run menu:import
```

Then create the real staff accounts — **not** the demo ones:

```bash
DATABASE_URL=postgres://... npm run user:create -- --email anna@asiaway.ch --name "Anna" --password '<generated>'
```

### Tighten the database privileges

`migrations/0001_grants.sql` is the second layer that makes history append-only:
the application role gets `INSERT` and `SELECT` on `audit_events` and
`order_revisions` and nothing else. Create the role, then apply it:

```bash
psql "$ADMIN_DATABASE_URL" -c "CREATE ROLE asiaway_app LOGIN PASSWORD 'from-your-secret-store';"
```
```bash
psql "$ADMIN_DATABASE_URL" -f migrations/0001_grants.sql
```

Point `DATABASE_URL` at `asiaway_app`, and keep the owner role for migrations
only. **This layer cannot be verified locally** (the local PGlite database runs
single-user) — verify it on staging by confirming that an `UPDATE` on
`audit_events` as `asiaway_app` is refused.

## Tables and QR codes

Real QR codes are generated only once the restaurant supplies its actual table
list — nothing about the tables is invented.

```bash
DATABASE_URL=postgres://... APP_BASE_URL=https://your-domain npm run qr
```

This writes `qr-codes/table-XX.svg`, `.png` and a printable `print-sheet.html`.
**`APP_BASE_URL` is baked into every code**, so set it correctly before printing:
reprinting means revisiting every table.

## Routine deployment

1. Build the image.
2. `npm run db:migrate` (forward-only; never edit an applied migration).
3. Start the new container.
4. Check `/api/health` — it returns 503 if the database is unreachable, so a
   broken instance is never given traffic.

## Reverse proxy

SSE needs buffering turned off, or alerts arrive in batches:

```nginx
location /api/waiter/stream {
    proxy_pass http://app:3000;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
}
```

Without this the app still works — the client falls back to polling and shows
"Delayed" — but live alerts are the point.

## Backups

Daily `pg_dump` plus point-in-time recovery, retained at least 30 days.

**Rehearse a restore before go-live.** An untested backup is not a backup, and
this database holds the order history the restaurant would need in a dispute.

## Scaling note

Phase 1 is one container, which is ample for one restaurant. Two things are
in-process and would need moving before running several instances: the SSE
notification hub (bridge it to Postgres `LISTEN/NOTIFY` — `publishWaiterEvent`
is the single seam) and the rate limiter (move to shared storage). Correctness
does not depend on either: the notification queue and every guarantee live in
the database.
