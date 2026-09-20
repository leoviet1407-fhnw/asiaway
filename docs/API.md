# API reference

REST over HTTPS, JSON. Two authorisation worlds, deliberately separated.

## Authentication

| Surface | Mechanism |
|---|---|
| Guest | `aw_dsid` cookie — httpOnly, Secure, SameSite=Lax, HMAC-signed, carrying `{sessionId, tableId, deviceId}`. Issued **only** by scanning a QR. No login, no personal data. |
| Waiter | `aw_wsid` cookie — httpOnly, Secure, SameSite=Strict, an opaque token stored only as a SHA-256 hash. 12-hour expiry. |

**The QR token buys exactly one thing**: the right to start or join the session
at that table. Every later call authorises against the cookie, never against an
identifier in the request body. That is what prevents one table reading or
changing another's orders.

## Errors

```json
{ "error": { "code": "ITEMS_UNAVAILABLE", "message": "...", "details": { } } }
```

| Code | Status | Meaning |
|---|---|---|
| `QR_INVALID` | 404 | Unknown, retired or malformed code. Says nothing about real tables |
| `SESSION_NOT_FOUND` | 404 | No guest session — scan again |
| `SESSION_CLOSED` | 409 | Staff closed the session |
| `ITEMS_UNAVAILABLE` | 409 | Sold out; `details.items` names them |
| `REVISION_CONFLICT` | 409 | Another device edited the order first |
| `REQUEST_IN_FLIGHT` | 409 | An identical submission is already being processed |
| `SESSION_HAS_UNRESOLVED_ORDERS` | 409 | Close needs `force` plus a reason |
| `ORDER_NOT_EDITABLE` | 409 | Order already confirmed or cancelled |
| `EMPTY_CART`, `INVALID_QUANTITY`, `NOTE_TOO_LONG`, `VALIDATION_FAILED` | 400 | Input rejected |
| `UNAUTHENTICATED` / `FORBIDDEN` | 401 / 403 | Sign in / not allowed |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Generic. Never carries a stack trace or SQL |

---

## Guest endpoints

### `GET /t/{qrToken}`
Resolves the code, opens or joins the table session, sets `aw_dsid`, redirects to
`/menu`. An unknown code redirects to `/qr-invalid`. Rate limited per IP.

### `GET /api/menu?lang=en|de|vi`
Categories and items, localised, grouped by `kind` (`FOOD` / `DRINK`).
Sold-out items **are included**, flagged `isAvailable: false` — the guest must
still see the dish. `imagePath` is `null` when no photograph exists; the UI then
renders no image element at all.

### `GET /api/menu/items/{id}?lang=` · `GET /api/allergens?lang=`
One item's detail; the 14-code allergen legend.

### `POST /api/orders`
Header **`Idempotency-Key`** required (8–128 chars, reused across retries).

```json
{ "items": [{ "menuItemId": "uuid", "quantity": 2 }], "note": "No coriander, please." }
```

No price, total, table or order number is accepted — all four are server-owned.
Inside one transaction the server validates the session, re-checks availability,
reads every price from the database, allocates the order number from a Postgres
sequence, writes revision 0, the audit event and the waiter notification.

Returns `201` (or `200` with `replayed: true` for a repeat of the same key):

```json
{ "orderNumber": 1047, "totalCents": 7450, "submittedAt": "...", "replayed": false }
```

### `GET /api/orders`
This session's orders, current version, with `wasAdjustedByStaff`. Internal
workflow statuses are mapped to `RECEIVED` / `CONFIRMED` / `CANCELLED` before
leaving the server.

### `POST /api/checkout-request`
Asks for the bill. Idempotent: a second press returns the original
`requestedAt` and creates no second alert. **The session stays open** — only
staff close it, after payment at the POS.

### `GET /api/session`
`{ active, tableNumber, checkoutRequestedAt, orderCount, sessionTotalCents }`,
or `{ active: false, reason }` once closed.

---

## Waiter endpoints

All require authentication, re-checked in every handler, plus a same-origin
check on mutations.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/waiter/auth/signin` | Argon2id; identical error for wrong email and wrong password; lockout after 5 failures in 15 min |
| `POST` | `/api/waiter/auth/signout` | Revokes the session |
| `GET` | `/api/waiter/dashboard` | Table grid with derived states, plus alert counts |
| `GET` | `/api/waiter/orders` | Pending queue, oldest first |
| `GET` | `/api/waiter/orders/{id}` | Full order **including `originalSubmission` and the revision history** |
| `POST` | `/api/waiter/orders/{id}/open` | → `EMPLOYEE_REVIEW`; audited, creates no revision |
| `PATCH` | `/api/waiter/orders/{id}` | Edit. Needs `expectedRevisionNumber`; creates a revision with full before/after snapshots and one audit event per change |
| `POST` | `/api/waiter/orders/{id}/confirm` | → `CONFIRMED`, writes `FINAL_CONFIRMED`, acknowledges the alert, releases the session if nothing else waits |
| `GET` | `/api/waiter/menu-items` | Availability list |
| `POST` | `/api/waiter/menu-items/{id}/availability` | Sold-out toggle; instant, audited, no deploy |
| `GET` | `/api/waiter/sessions/{id}` | Every order in the session and its total |
| `POST` | `/api/waiter/sessions/{id}/close` | After POS payment. Refuses on unresolved orders unless `{force, reason}` |
| `GET` | `/api/waiter/notifications` | **The authoritative pending queue** |
| `POST` | `/api/waiter/notifications/{id}/ack` | Acknowledge |
| `GET` | `/api/waiter/stream` | SSE: `new_order`, `checkout_requested`, `order_updated`, `availability_changed`, heartbeat |
| `GET` | `/api/waiter/audit?sessionId=\|orderId=\|tableId=` | Ordered audit events |
| `GET` | `/api/health` | DB-backed health check (no auth) |

### On the SSE stream
It is an accelerator, not the source of truth. Clients reconcile against
`/api/waiter/notifications` on every connect and reconnect, and fall back to
polling every 10 seconds after three failures. A dropped stream costs latency,
never an order.

---

## Phase 2 seams

`src/domain/ports/` defines `PosAdapter`, `KitchenRouter`, `PaymentProvider` and
`AnalyticsSink`. Each has one no-op Phase 1 implementation and **names no
vendor**. A real integration is a new implementation, not a change to the
ordering domain.
