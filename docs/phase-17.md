# Phase 17 — Reservations

Continues verified main `716d2e1`. Implementation on `phase17-reservations`; Phase 18 is not authorized. Photos remain disabled hosted.

## Scope and rules

- Reservations and full releases are separate append-only events. Physical journal lines and quantities do not change. A derived reservation record preserves item/owner/location/unit/pallet snapshots and links both events with actor, time, reason and idempotency key.
- Reserve loose stock or an explicit handling unit, in its existing stock unit. All item kinds and external owners are supported. No conversion, shipment creation, dispatch, expiry jobs or infrastructure expansion.
- `inventory.read` permits listing, details and history; `inventory.reserve` permits reserve/release. Pallet reservation additionally requires `production.read`, matching existing pallet visibility. Browser writes go only through NestJS. Private trigger functions check actor/session/company/permissions and have no runtime/public execute grants. Runtime cannot edit projections, snapshots or journal history.
- Physical, reserved and available quantities are shown separately. Available = physical minus reserved. Loose reservation excludes identified pallet stock to prevent overlapping allocation. Identified and loose reservation amounts cannot oversubscribe the same balance.
- Every physical debit remains guarded, including corrections, moves, returns, production consumption and output reversals. A reserved pallet cannot be moved or reversed until released. Users release and create a new reservation to change allocation; there is no silent relocation or partial release in this phase.
- Exact NUMERIC(20,8), whole count/package units, active references, tenant-qualified foreign keys, SERIALIZABLE whole-transaction retries and locked balance counters protect concurrent commands. Duplicate keys with changed payload are conflicts; duplicate releases with the original key return the original result.
- Snapshots and event history survive masterdata edits. Release remains possible when masterdata becomes inactive. A reference is required; shipment linkage belongs to Phase 18.

## Database and API

Migration `20260914193226_phase_17_reservations.sql` adds `stock_reservations`, `reservation_events`, protected reserved counters on balances/handling units, a permission, indexes, RLS and private posting guards. It extends the existing physical-stock guard to protect reservations. No browser Data API grants. Prepared locally; hosted application is not yet claimed.

Routes: `GET/POST /api/companies/:companyId/reservations`, `GET /:id`, `POST /:id/release`. Existing balance reads include reserved/available amounts. Readiness verifies new table presence without actor-dependent permission-row queries.

## Verification

Results will be recorded after final checks. Tests cover idempotency, numeric precision, no physical posting, overreservation, reserved debit rejection, snapshot history, permissions, tenant isolation, full release and identified-pallet movement/reversal protection. Concurrent tests use only the existing disposable local PostgreSQL CI database. Browser tests use local fixtures, not hosted business data.

## Release and cost boundary

No hosted resource change, photos, extra service, manual deployment or Phase 18 workflow. Working-branch checks use existing public-repository GitHub Actions. Main publication is separate: expected Railway incremental 0–0.30 DKK, realistic one-off worst case 1–3 DKK, depending on build duration/overlap and included usage; explicit approval is needed if not confidently bounded at 1 DKK.

Supabase changelog and RLS documentation checked: no relevant API changes are needed. Existing NestJS-only access remains, with explicit grants and per-company policies. No external paid integration.
