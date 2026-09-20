# ASIAWAY QR ORDERING SYSTEM — CLAUDE HANDOFF PROMPT

## Role
You are a senior product architect and full-stack engineer. You are receiving this document as the authoritative specification for an Asiaway restaurant QR ordering system.

## Critical instruction: do not assume
Do not invent restaurant-specific facts. Separate every item into:
- CONFIRMED: explicitly decided by the restaurant.
- PROPOSED: your technical/UX recommendation, clearly labeled.
- OPEN: not yet supplied/decided.
- OUT OF SCOPE: explicitly deferred.

If a missing item blocks a safe implementation, ask a targeted blocking question before proceeding. Do not silently choose a POS, table count, drinks menu, brand colors, payment provider, or production domain.

## Restaurant
- Restaurant: Asiaway.
- Existing website exists, but a different site/domain may be used for the demo.
- One permanent QR code per physical table, printed on a small wooden block or paper.
- Number/list of tables will be supplied later.
- Tables can be combined; exact operating rule for combined QR codes is still OPEN.

## Phase 1 goal
Build a mobile-first web/PWA QR table ordering system.
Customer flow:
1. Customer sits at assigned table.
2. Scans table QR.
3. Selects English/German/Vietnamese.
4. Browses menu.
5. Adds dishes/drinks to cart.
6. May enter a free-text special request.
7. Confirms cart.
8. System creates order number + timestamps and notifies waiter.
9. Waiter reviews order on phone/tablet, may edit it, then confirms it at the table.
10. Waiter manually enters confirmed order into existing POS (Phase 1; POS is unknown and intentionally not integrated yet).
11. Customer can scan same QR later to submit additional orders.
12. Customer can press Request Checkout.
13. Waiter receives checkout notification, goes to table, confirms table number, and accepts cash/card payment at existing POS.
14. Waiter closes session in QR system after payment.

## Confirmed UX decisions
- No customer account.
- No customer name, phone, or email required.
- No customer login.
- No customer self-cancel after submission.
- No customer-facing live order tracking in Phase 1.
- Free-text special requests only. No restaurant-defined modifiers/options.
- Dish photos are optional; use current photos where available and no fake/broken image when unavailable.
- Sold-out management is required.
- Every order has a unique order number.
- Major actions have authoritative timestamps.
- Audit trail is required.
- Improvement 1: customer can continue browsing after submission; do not force a waiting screen.
- Improvement 2: use internal order/session statuses.
- Improvement 3: customer can see the final order if the waiter changes it; the customer does not need live status tracking.
- Improvement 4: free-text special request only.
- Improvement 5: waiter can mark menu items sold out/available.
- Improvement 6: food and drinks are separated in the menu.

## Phase 1 out of scope
- POS integration.
- Direct QR online payment/TWINT/Apple Pay/etc.
- Kitchen display/printer integration.
- Bar display/printer integration.
- Sales analytics.
- Employee analytics.
- Customer accounts/loyalty.
- Reservations/delivery/takeaway.
- Structured restaurant modifiers.

## Menu
Use the supplied Asiaway menu PDF as the source for the initial food menu. A trilingual CSV is also provided separately with English/German/Vietnamese names and descriptions, prices and allergen data.
Initial food categories include the sections from the supplied menu; drinks will be supplied later.
Allergen codes from the source must be preserved and displayed clearly.

## Core state models
Order lifecycle:
DRAFT -> SUBMITTED -> EMPLOYEE_REVIEW -> CONFIRMED

Table/session lifecycle:
AVAILABLE -> OCCUPIED -> ORDER_PENDING -> OCCUPIED -> CHECKOUT_REQUESTED -> PAID/CLOSED -> AVAILABLE

A customer may create multiple separate orders in one open dining session. Do not overwrite previous orders. Each order gets its own order number and audit history.

## Required entities
At minimum:
- User (role=WAITER in Phase 1)
- Table
- TableGroup / combined-table structure
- DiningSession
- Order
- OrderItem
- OrderNote
- MenuCategory
- MenuItem
- AuditEvent
- Notification

Preserve server-side authoritative price/availability validation.

## Security requirements
- QR must use a non-guessable token; do not treat a visible table number as the secret.
- Waiter interface requires authentication.
- No customer PII collection in Phase 1.
- Use HTTPS outside localhost.
- Passwords must be securely hashed or delegated to a suitable identity provider.
- Audit events should be append-only from the normal UI.
- Server-side validation of price, availability, quantity, and session.
- Prevent duplicate order submission with idempotency/deduplication.
- Use authoritative server timestamps; render restaurant-local time.

## Waiter system
Responsive web app/PWA. Works on phone and tablet. A permanent tablet is preferred but exact device is OPEN.
Waiter dashboard must show:
- table state
- new order count
- checkout request count
- pending orders
- session/order history at the defined level

Waiter can:
- open order
- edit quantities/items/special request
- confirm order
- mark menu item sold out/available
- open table/session
- handle checkout request
- close session after POS payment
- view audit history

## Notification requirements
- Real-time new-order alert.
- Real-time checkout request alert.
- Visual notification plus sound where supported.
- Pending notification remains until opened/acknowledged.
- Backend remains source of truth so reconnecting devices recover missed notifications.

## UI expectations
Customer UI: mobile-first, one-handed use, large tap targets, persistent cart, no horizontal scrolling, clear prices, clean multilingual display.
Waiter UI: fast, low-friction, clear table/order state, optimized for a permanently open tablet but usable on a phone.
Brand colors/typography are OPEN; do not invent them as confirmed facts.

## Combined tables
Support combined tables at data-model level. Exact operating rule is OPEN. Do not silently choose which QR customers must scan when tables are combined. Ask if this becomes blocking for the chosen implementation.

## Phase 2 readiness
Architect clean extension points for:
- POS integration
- kitchen integration
- bar integration
- direct payments
- sales analytics
- employee analytics
Do not build these integrations in Phase 1.

# Required output from you
Return the following, in this order:

1. Requirements Interpretation Matrix — CONFIRMED / PROPOSED / OPEN / OUT OF SCOPE.
2. Blocking Questions — only if needed for safe implementation.
3. Architecture Decision Record — frontend/backend/database/auth/realtime/hosting, with reasons and Phase 2 compatibility.
4. Data Model — fields, relationships, indexes, constraints, migrations.
5. State Machines — order, table/session, notifications.
6. API Specification — endpoints/functions, request/response, validation, authorization, errors, idempotency.
7. QR/Table/Session Design — secure token, session creation, additional orders, combined tables, session closure.
8. UI/UX Specification — every customer and waiter screen, including loading/error/sold-out/empty states.
9. Menu Import Plan — how to import and maintain the provided trilingual CSV and optional photos.
10. Security/Privacy Design.
11. Real-Time Notification Design.
12. Test Plan — unit/integration/E2E/manual restaurant acceptance tests tied to requirements.
13. Implementation Roadmap — small milestones with dependencies and definition of done for each milestone.
14. Repository/File Structure.
15. Only after the plan is accepted/ready: complete working code/files, not pseudo-code, with setup and deployment instructions.
16. Demo/Staging Setup — clearly labeled test data only.
17. Operator Guide — waiter workflow.
18. Phase 2 extension plan.

## Implementation quality bar
- Do not provide a superficial prototype that only visually resembles the system.
- The backend must be the source of truth for prices, availability, session state and order totals.
- Every state-changing action that matters to the restaurant must be auditable.
- The system must be resilient to double taps, reloads, connection loss and repeated QR scans.
- Keep Phase 1 independent of the unknown POS.
- Make the system easy to extend without rewriting the core order/session model.

## Inputs that will be provided later
- Real table list/count.
- Combined-table operating rule.
- Drinks menu.
- Mapping of current food photos to menu items.
- Final branding.
- Production domain/hosting preference.
- Exact POS information for Phase 2.
- Kitchen/bar details for Phase 2.

## Definition of Done
The Phase 1 build is complete only when a customer can scan a QR, browse the trilingual menu, add items, submit an order, receive a reliable waiter-side workflow, have the waiter edit/confirm it, create additional orders later, request checkout, and have the waiter close the table session after POS payment — with unique order numbers, timestamps, audit history, sold-out management, and no customer account required.
