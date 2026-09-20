# Asiaway Workforce Planning & Time Logging — Analysis and Improvement Plan

**Status:** DRAFT FOR APPROVAL — no application code written yet.
**Source analysed:** `Arbeitsplan-Asiaway-07.09.-23.09.26 - Staff.pdf` (2 pages, week of Mon 07.09.2026 – Sun 13.09.2026)
**Builds on:** the existing Next.js / Drizzle / Postgres app in this repository
**Date:** 2026-09-20
**Answered since first draft:** closing time = **22:00** every day · 100% = **40–42.5 h/week** (see Q1, Q2 in Part 8)

Legend: **FOUND** (observed in the PDF, reproducible) · **PROPOSED** (my recommendation) · **VERIFY** (needs a legal or business answer before build) · **OPEN** (undecided).

---

## Part 1 — What the current plan actually is

Two pages describing **the same week twice**:

| Page | Title | Organised by | Answers |
|---|---|---|---|
| 1 | `SERVICE STATION PLAN` | station → time-band → day | "Who is on the buffet on Thursday lunch?" |
| 2 | `ARBEITSPLAN (nach Uhrzeit)` | person → day → Lunch/Dinner | "When does Tamie work this week?" |

Ten people appear: XUAN (*Restaurant Leitung*), APRIL (100%), TAMIE (80%), YEN (70%), MERSI (100%), PHUOC (80%), EDMOND (100%), and three *Aushilfen* — JENNY, PATRICIA, DENNIS. Four areas: EG/Terrace (Thai, à la carte, bubble tea), 1. OG Pavillon (Vietnamese), Lunch Buffet, plus BAR / FOOD-PASS / OFFICE / cleaning rows.

The plan is **competently built** — station coverage is deliberate, split shifts are placed around the 14:30–17:00 lull, and pensum percentages are roughly respected. The problems below are not planning mistakes. They are all consequences of the medium: a spreadsheet that stores the same facts twice and has no way to compute anything.

---

## Part 2 — Findings

### F1 — `END` is not a time. **FOUND — this is the root defect.**

Every evening shift on both pages ends in the literal string `END`: `17.00 - END`, `18.00 - END`, `14:00 - END`. Of the 41 shift segments in the week, **19 have no end time**.

Consequences, all of them downstream of this one cell value:

- Nobody's weekly hours can be calculated — not by the manager, not by the employee, not by payroll.
- A 70% and a 100% contract cannot be checked against reality.
- Overtime is invisible by construction. So is undertime.
- Rest periods between an evening shift and the next morning's 10:30 start cannot be verified.
- Staff cannot plan their evening, arrange childcare, or catch a last train.

You have since confirmed **22:00**, which retires the ambiguity going forward and made the recomputation in F4 possible. The structural lesson stands: a shift has a start and an end, and `END` was a scheduling `NULL` being used as if it were data. The model in Part 4 makes it unrepresentable so it cannot come back.

### F2 — The two pages contradict each other. **FOUND**

The same week is typed twice, so the copies have drifted. Sunday 13.09 is **exactly inverted** between the pages:

| Sunday 13.09 | Page 1 (Station Plan) says | Page 2 (Arbeitsplan) says |
|---|---|---|
| `11:00 – 16:00` EG Aufmachen, à la carte | EDMOND | APRIL |
| `11:30 – 14:30` à la carte, Mittagsschicht | APRIL | EDMOND |
| `16:00 – END` à la carte, Abendschicht | APRIL | EDMOND |
| `18:00 – END` à la carte, Abendschicht | EDMOND | APRIL |

Two people, four shifts, one day — and which sheet an employee happens to read decides whether they arrive at 11:00 or 11:30, and whether they finish at 14:30 or close the restaurant. For APRIL the two pages differ by **4.5 hours of attributed work on a single day**.

A second, quieter drift: **EDMOND is assigned *Reinigung Buffetbereich* on Friday lunch on page 1, but page 2 does not roster him on Friday until 14:00.** The task has no one who is actually present to do it.

This is not carelessness. It is what always happens when one fact is stored in two places.

### F3 — Stations that nobody is standing in. **FOUND**

| Station row | Time | Assigned |
|---|---|---|
| 1. OG PAVILLON — *Gäste empfangen / Mis en Place* | 10.30 – 14.30 | **empty, all 7 days** |
| 1. OG PAVILLON — *À la carte* | 11.30 – 16.00 | **empty, all 7 days** |
| LUNCH BUFFET — *Restaurantleiter* | 11.00 – 21.00 | **empty, all 7 days** |
| BAR — *Beverages & Cocktails* | 11.00–14.30 / 17.30–End | `Kellner selbst` — all 14 slots |
| FOOD-PASS | 11.30 – 14.00 | `Kellner selbst` — all 7 slots |

Some of these are genuine policy ("the waiter makes their own drinks"), and that is a legitimate answer. But the plan cannot distinguish **"deliberately unstaffed"** from **"we forgot"** from **"nobody available"**. A 10-hour `Restaurantleiter` row sitting permanently empty is a row that has stopped meaning anything.

### F4 — With 22:00 as the end time, the roster is well calibrated. **FOUND — this reverses my first draft.**

My first draft estimated end times at 22:30–23:00 and concluded that everyone was over their pensum. With your actual closing time of **22:00** and a 100% week of **40–42.5 h**, that conclusion does not hold. Recomputed:

| Person | Pensum | Days | Planned hours | Contract band | Verdict | Longest span | Split shifts | Max consecutive days |
|---|---|---|---|---|---|---|---|---|
| APRIL | 100% | 5 | 42.0 | 40.0 – 42.5 | inside | 11 h 30 | 2 | 5 |
| MERSI | 100% | 5 | 40.5 | 40.0 – 42.5 | inside | 11 h 30 | 2 | 3 |
| EDMOND | 100% | 5 | 41.5 | 40.0 – 42.5 | inside | 11 h 30 | 4 | 4 |
| TAMIE | 80% | 4 | 32.0 | 32.0 – 34.0 | **at the floor** | 11 h 30 | 3 | 3 |
| PHUOC | 80% | 4 | 32.5 | 32.0 – 34.0 | inside | 11 h 30 | 3 | 4 |
| YEN | 70% | 6 | 28.5 | 28.0 – 29.8 | inside | 5 h 00 | 0 | **6** |
| DENNIS | *Aushilfe* | 5 | 36.0 | — | — | 11 h 30 | 1 | 5 |
| JENNY | *Aushilfe* | 1 | 4.5 | — | — | 4 h 30 | 0 | 1 |
| XUAN | *Leitung* | 1 | 4.0 | — | — | 4 h 00 | 0 | 1 |
| PATRICIA | *Aushilfe* | 0 | 0.0 | — | — | — | 0 | 0 |

**Every contracted employee lands inside their band.** Six people, three different pensum levels, planned by hand — that is a good result and it deserves saying. The system's job here is not to fix the planning. It is to make this checkable in seconds instead of requiring a PDF to be reverse-engineered, and to keep it true when someone calls in sick on a Friday.

What still stands after the recomputation:

- **The band is 2.5 h/week wide, and that is a problem of its own.** Across a month, 40 h/week and 42.5 h/week differ by ~11 hours per person. Whether APRIL's 182.5 planned monthly hours are on target or 8.7 hours of overtime depends entirely on which figure her individual contract states. A band cannot settle a payslip. **OPEN (Q2):** each employment needs its own exact `weekly_hours_at_100`; 40–42.5 is the guardrail the validator checks new contracts against, not a value to store.
- **TAMIE sits exactly on her floor** (32.0 against a 32.0 minimum). Any trimmed shift puts her under contract. She has no slack.
- **YEN works six consecutive days** (Mon–Sat) at a 70% contract, with one rest day.
- **DENNIS, contractually an *Aushilfe*, works 5 days and 36 h** — a near-full-time pattern on casual terms. **VERIFY** whether the contract still matches the reality.
- **PATRICIA is scheduled zero hours with no absence marked.** The plan cannot say whether she is on holiday, unavailable, or omitted.

The deeper point survives the correction intact: this roster was fine, and **nobody could have known that** until an end time existed. The defect in F1 was never that the hours were wrong. It was that they were unverifiable.

### F5 — Split shifts with 12½-hour spans. **FOUND · VERIFY**

Six of the ten people work at least one day as `10:30–14:30` plus `17:30–22:00`. The **span from first clock-in to last clock-out reaches 11 h 30** for APRIL, TAMIE, MERSI, PHUOC, EDMOND and DENNIS, on multiple days each — for 8 to 9 hours of paid work. TAMIE works split shifts on 3 of her 4 days; EDMOND on 4 of 5.

**VERIFY against Swiss ArG and the L-GAV Gastgewerbe** before the build fixes any numbers: the permitted daily span including breaks, minimum daily rest between shifts, break entitlements by shift length, and the maximum consecutive working days. These are the rules the validator in Part 4 will enforce, so they need an authoritative answer rather than my estimate. Note also that the L-GAV obliges the employer to **record actual daily working time** — which a plan ending in `END` cannot do.

Separately from the law: an 11½-hour span for 8 hours of pay is the thing that makes hospitality staff quit. It is worth tracking as a fairness metric in its own right, and distributing it evenly.

### F6 — New duties added with no time budget. **FOUND**

Two rows are flagged `*** NEW ***`:

- *Reinigung Buffetbereich* — EDMOND (Mon), PHUOC (Tue), EDMOND (Wed), TAMIE (Thu), EDMOND (Fri)
- *Reinigung Reiskocher (Tagesende)* — EDMOND (Sat), EDMOND (Sun)

Both are placed in the **lunch** column, and every named person is already fully occupied on another station in that exact band. The rice-cooker task is explicitly labelled *Tagesende* — end of day — yet sits in the lunch cell. So either the work happens unpaid at the edges of a shift, or it does not happen. Also note EDMOND carries 5 of the 7 cleaning duties.

Adding a task to a plan that has no concept of duration will always produce this. The fix is structural, not a matter of trying harder.

### F7 — Free-text overrides inside cells. **FOUND**

Exceptions are written as prose into the grid: `bis 14:30: APRIL`, `bis 17:30: TAMIE`, `ab 18:30: YEN`, `12:00-20:00: APRIL`, `+ Foodrunner: JENNY`, `+ Lager: PHUOC`, `+Foodrunner MERSI`. Each is a real and sensible operational decision. None of them is machine-readable, searchable, or countable. The row header says one thing and the cell quietly says another, and only a human reading carefully catches it.

### F8 — No process, only an artefact. **FOUND**

The PDF is an output with no visible input. There is no record of:

- who was available when, and who asked for what
- who requested which day off, and whether it was granted
- when the plan was published, or what changed between versions
- what was actually worked, as opposed to planned
- absence, sickness, holiday, or holiday balance
- acknowledgement — whether an employee has seen the plan at all

The filename says `07.09.-23.09.26`, a 17-day range, while the content covers 7 days. Even the artefact's own scope is ambiguous.

---

## Part 3 — The improvement plan

Two tracks. Track A changes how the roster is made and costs nothing to adopt. Track B is the system you asked for. **Do Track A first** — it is worth doing even if Track B is never built, and it forces the decisions Track B has to encode.

### Track A — fix the roster practice (adopt now, no software)

| # | Change | Replaces |
|---|---|---|
| A1 | **Every shift gets a real end time.** Define a default closing time per weekday, and write it. `17:30 – 23:00`, never `17:30 – END`. | F1 |
| A2 | **One source, two views.** Maintain *only* the person-by-time grid. Generate the station view from it — never type a name twice. | F2 |
| A3 | **Mark deliberate gaps explicitly.** `Kellner selbst` and `nicht besetzt` are valid answers; an empty cell is not. Delete station rows you never staff. | F3 |
| A4 | **Put a weekly hours column next to the pensum column.** Planned hours and contract target, side by side, per person. | F4 |
| A5 | **Budget the cleaning tasks.** Either extend the shift by 30 minutes and say so, or give them their own short shift. | F6 |
| A6 | **No prose in cells.** An exception is a different start or end time, so change the time. | F7 |
| A7 | **Absence is a state.** Mark holiday, sick and unavailable on the plan. A blank row must mean "not needed", nothing else. | F8, F4 |
| A8 | **Cap the split-shift span**, and rotate who carries them. | F5 |

### Track B — the system

**Scope confirmed from your request:** employees log in; part-timers submit the times they *can* work; full-time employees' actual work is logged; everything is aggregated **per month**.

**Build it inside this repository, not beside it.** The app already has what a workforce module needs, and the second system is the one that drifts:

| Already in the repo | Reused for |
|---|---|
| `users`, `auth_sessions`, `login_attempts` | staff login — unchanged |
| `src/server/auth/password.ts`, `session.ts` | credentials and cookies — unchanged |
| `audit_events` (append-only, trigger-enforced) | every roster and timesheet change |
| `order_revisions` snapshot pattern | timesheet correction history |
| Drizzle + numbered SQL migrations + `schema-drift.test.ts` | new tables, same guarantees |
| PGlite integration-test harness | the rule validator's test suite |
| Waiter tablet UI patterns | the staff-facing screens |

Only one existing object changes: `user_role`, which today has the single value `WAITER`.

---

## Part 4 — Data model (PROPOSED)

Written to make F1–F8 unrepresentable rather than merely discouraged.

```
-- roles -------------------------------------------------------------------
ALTER TYPE user_role ADD VALUE 'MANAGER';   -- plans, approves, closes the month
ALTER TYPE user_role ADD VALUE 'STAFF';     -- kitchen/cleaning; no waiter tablet

-- who someone is contractually ---------------------------------------------
employment_type  : FULL_TIME | PART_TIME | ON_CALL
employments      : user_id, employment_type, pensum_percent,
                   weekly_hours_at_100 (numeric, e.g. 42.0),
                   valid_from, valid_to, note
                   -- history, not a mutable column: a pensum change is a new row

-- the venue ----------------------------------------------------------------
stations         : code (EG_ALACARTE, BUFFET, OG_ALACARTE, BAR, FOODPASS,
                   OFFICE, CLEANING), name_de, name_en, sort_order,
                   is_active, staffing_policy (STAFFED | SELF_SERVE | CLOSED)
                   -- F3: "Kellner selbst" becomes a value, not a blank

shift_templates  : station_id, weekday, starts_at time, ends_at time,
                   headcount, role_label, effective_from, effective_to
                   -- the recurring skeleton, so a month is generated, not retyped

-- the month ----------------------------------------------------------------
roster_periods   : starts_on, ends_on,
                   state: DRAFT | AVAILABILITY_OPEN | PLANNING | PUBLISHED | LOCKED,
                   availability_deadline, published_at, published_by

-- what staff submit ---------------------------------------------------------
availability     : user_id, period_id, on_date, from_time, to_time,
                   kind: AVAILABLE | PREFERRED | UNAVAILABLE,
                   note, submitted_at
                   UNIQUE (user_id, on_date, from_time)

absences         : user_id, starts_on, ends_on,
                   type: VACATION | SICK | MILITARY | UNPAID | PUBLIC_HOLIDAY,
                   state: REQUESTED | APPROVED | REJECTED,
                   approved_by, approved_at
                   -- F4: PATRICIA's empty week finally has a reason attached

-- the plan ------------------------------------------------------------------
shifts           : period_id, on_date, station_id,
                   user_id NULL,              -- NULL = published open shift
                   starts_at timestamptz NOT NULL,
                   ends_at   timestamptz NOT NULL,   -- F1: no "END" is expressible
                   planned_break_minutes NOT NULL DEFAULT 0,
                   role_label,                -- F7: "Foodrunner", "Drinks", "Lager"
                   state: DRAFT | PUBLISHED | CANCELLED,
                   revision int
                   -- F2: ONE table. Station view and person view are two queries.

-- what actually happened ------------------------------------------------------
time_entries     : shift_id NULL, user_id, business_date,
                   clock_in_at, clock_out_at, break_minutes,
                   source: CLOCK | MANUAL | IMPORTED,
                   state:  OPEN | SUBMITTED | APPROVED | DISPUTED,
                   approved_by, approved_at, note
                   -- shift_id NULL covers work that was never planned

time_entry_revisions : append-only, mirrors order_revisions exactly
                       (full before/after snapshot, actor, reason)

-- the month's answer ----------------------------------------------------------
monthly_statements : user_id, period_id, target_minutes, planned_minutes,
                     worked_minutes, absence_minutes,
                     balance_minutes, carried_in_minutes, carried_out_minutes,
                     closed_at, closed_by
```

Three notes on the shape:

**`shifts` is the single source of truth.** The station plan and the person plan are two `SELECT`s over one table. F2 becomes impossible to reproduce — there is no second copy to drift from.

**`ends_at` is `NOT NULL timestamptz`, not a `time`.** Both because `END` must be unrepresentable, and because a shift crossing midnight is a normal Saturday.

**`audit_events` needs no schema change.** It already carries a generic `entity_type` / `entity_id` pair plus a `metadata` jsonb. Roster and timesheet events use `entity_type IN ('shift','time_entry','availability','absence')`. The append-only triggers and the `SELECT, INSERT`-only grant on `asiaway_app` then apply to workforce data for free.

---

## Part 5 — The rule validator

A pure function over a proposed roster, returning violations. This is the part that earns the project — it is the manager's second pair of eyes, and it is where every finding in Part 2 gets caught automatically. Pure domain logic in `src/domain/roster/`, no database, exhaustively unit-testable — the same shape as the existing `src/domain/order/status.ts`.

| Rule | Check | Blocks publish? | Catches |
|---|---|---|---|
| R1 | Every shift has `ends_at > starts_at` | schema-enforced | F1 |
| R2 | Minimum rest between consecutive shifts | **yes** | F5 |
| R3 | Maximum daily span, first start to last end | **yes** | F5 |
| R4 | Maximum consecutive working days | **yes** | F4 (YEN) |
| R5 | Break minutes required by shift length | **yes** | F5 |
| R6 | No person in two stations at once | **yes** | — |
| R7 | Every `STAFFED` station meets its headcount | warn | F3 |
| R8 | Assignee is available and not absent | **yes** | F2 (EDMOND's Friday cleaning) |
| R9 | Monthly hours vs. the contract's own `weekly_hours_at_100` | warn | F4 |
| R10 | Split-shift count and span fairness across the team | warn | F5, F6 |
| R11 | Every published shift acknowledged by its assignee | info | F8 |

**VERIFY before implementation:** the concrete thresholds for R2–R5 against the ArG and the L-GAV Gastgewerbe. The rules are written as data (`roster_rules`, one row per rule with its limit) so that a legal correction is a configuration change, not a code change — and so a shift's legality can be re-checked against the limits that were in force on the day.

---

## Part 6 — Screens

**Staff** (mobile-first, same look as the waiter tablet):

| Route | Purpose |
|---|---|
| `/staff/availability` | Month grid. Tap a day → *available / preferred / unavailable* + optional time window. Presets for recurring patterns ("never Sunday", "evenings only"). Shows the deadline and the person's contract target. **This is the screen your part-timers fill out.** |
| `/staff/schedule` | My published shifts: next 7 days, plus the month. Station, start, end, break, role. One-tap **acknowledge**. |
| `/staff/timesheet` | This month's worked hours vs. target, running balance, and a **dispute** button per entry that opens a correction request rather than editing the row. |
| `/staff/absences` | Request holiday; see remaining entitlement and request state. |

**Manager:**

| Route | Purpose |
|---|---|
| `/manager/roster/[period]` | The grid — deliberately the same layout as today's page 1, but live: drag to assign, availability shaded underneath, violations in a side panel updating as you edit. Generate the month from `shift_templates`, then adjust. |
| `/manager/roster/[period]/publish` | Preflight: every blocking violation, every unstaffed `STAFFED` station, every person outside pensum tolerance. Publish notifies staff and snapshots the revision. |
| `/manager/approvals` | Absence requests, timesheet disputes, unplanned time entries. |
| `/manager/month-close` | Per-person statement, carry-over, CSV/PDF export for payroll, then `LOCKED`. |

The exported PDF should keep today's two-page station/person layout. It is a good layout and the team can read it at a glance — the difference is that both pages are now rendered from one table.

---

## Part 7 — Delivery

| Phase | Scope | Outcome |
|---|---|---|
| **B1** | `MANAGER`/`STAFF` roles, `employments`, `stations`, `roster_periods`, availability capture, staff login | Availability stops arriving by WhatsApp. Contracts are in the system. |
| **B2** | `shift_templates`, `shifts`, roster grid, the rule validator, publish + acknowledge, PDF export | One source of truth. F1, F2, F3, F6, F7 fixed structurally. |
| **B3** | `time_entries`, corrections with revision history, approvals, `monthly_statements`, payroll export | Actual vs. planned. Overtime becomes a number. |
| **B4** *(optional)* | Clock-in from the waiter tablet; demand forecasting from `orders` volume per hour | Staffing driven by the order data the app already collects. |

Sequenced so that each phase is independently useful — B1 alone replaces the availability-gathering that currently happens in chat.

**Migrations** continue the existing numbering from `0006_`, one concern per file, with the commented header style used in `0002_auth_sessions.sql` and `0004_table_area.sql`. `tests/integration/schema-drift.test.ts` keeps the Drizzle definitions honest.

---

## Part 8 — Open questions

These need your answer before B1 starts; the first three change the data model.

1. ~~**Closing times.**~~ **ANSWERED: 22:00, every day.** Seeded as the default `ends_at` in `shift_templates`. Remaining sub-question: is 22:00 the *last guest out* or the *staff clock-out*? Close-down after the last table is where unrecorded time hides. *(OPEN — minor)*
2. **Hours at 100% — now the blocking question.** You gave **40–42.5 h/week**, which is a range across contracts, not a single figure. Payroll needs one number per person. Please supply each employee's contractual weekly hours at 100%; 40–42.5 becomes the validator's guardrail for new contracts. Also: is the monthly target calendar-derived (weeks × weekly hours) or a fixed monthly figure? *(OPEN — blocks B3)*
3. **`Aushilfe` contracts.** Do JENNY, PATRICIA and DENNIS have a pensum, a monthly hour cap, or purely on-call terms? DENNIS's ~39.5 h week needs an answer before the validator can judge it. *(OPEN — see F4)*
4. **Legal thresholds** for R2–R5, from the ArG and the L-GAV Gastgewerbe. *(VERIFY)*
5. **Overtime policy.** Compensated in time or paid out? What monthly carry-over is allowed, and what triggers an escalation? *(OPEN)*
6. **Who plans?** Is XUAN the only `MANAGER`, or does APRIL (who holds the OFFICE shifts) plan too? *(OPEN)*
7. **Languages.** Staff UI in DE only, or DE/EN/VI like the guest menu? The i18n scaffolding already exists in `src/i18n/`. *(OPEN)*
8. **Who may see money?** Hourly rates are in scope for payroll export but should be `MANAGER`-only. Confirm. *(OPEN)*
9. **Holiday entitlement** per person, and whether the system tracks the balance or only records absences. *(OPEN)*
10. **Data retention** for timesheets. Swiss record-keeping obligations are typically multi-year — confirm the period. *(VERIFY)*
