# Phase 17 — Reservations

Status: Phase 17 complete. Main/Railway commit `b5dfe81ab4a7b70f0263a18ff1c321e224ac7fe2` is verified; hosted migration applied once and operator-reported online verification PASS. Earlier entries below record progress at their respective dates. Phase 18 is not authorized. Photos remain disabled hosted.

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

Automated verification passed; hosted migration and online sign-off remain pending. Tests cover idempotency, numeric precision, no physical posting, overreservation, reserved debit rejection, snapshot history, permissions, tenant isolation, full release and identified-pallet movement/reversal protection. Concurrent tests use only the existing disposable local PostgreSQL CI database. Browser tests use local fixtures, not hosted business data.

## Release and cost boundary

No hosted resource change, photos, extra service, manual deployment or Phase 18 workflow. Working-branch checks use existing public-repository GitHub Actions. Main publication is separate: expected Railway incremental 0–0.30 DKK, realistic one-off worst case 1–3 DKK, depending on build duration/overlap and included usage; explicit approval is needed if not confidently bounded at 1 DKK.

Supabase changelog and RLS documentation checked: no relevant API changes are needed. Existing NestJS-only access remains, with explicit grants and per-company policies. No external paid integration.

## Local verification and hosted boundary

`npm run check` PASS: 205 tests passed; 12 PostgreSQL tests skipped locally because the local connection is absent. Typecheck and API/frontend builds passed. Two additional diagnostic-script tests passed separately, covering read-only requests and secret-safe output. The schema-count assertion was updated from 35 to 37 for the two new tables; no test gate was removed.

Supabase organization `ltqcdagbwtuwtudnqpdn` was confirmed Free, project `puwyontrchonoepisgun` ACTIVE_HEALTHY, database 14,142,611 bytes, Phase 17 absent from hosted migration history. Expected migration charge: 0 DKK. Automatic approval review rejected the hosted migration because explicit authorization of the production schema changes is required. The migration was not executed and must not be retried without approval. No hosted business fixtures or resource changes were made.

After approved migration and main deployment, run `node scripts/verify-reservations.cjs` interactively on the operator's machine. Enter publishable key, email, password, company name and existing isolation-company ID locally; no secrets are printed. It checks login/session, permission, list/detail scope, foreign-company denial and not-found behavior, using only GET business requests and session cleanup. If no reservation exists, `RESERVATION_EXISTING_RECORD: NOT_RUN` is expected; no fixtures are created. Hosted write behavior is not claimed by that read-only script.


## Final automated verification — 2026-09-14

GitHub Actions [34888463950](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34888463950), job `104124879095`, implementation commit `357654cb3f6d57f314cfb2e3d319e86520b81902`: SUCCESS.

- 205 unit/API/database/helper tests PASS.
- 12 real PostgreSQL concurrency tests PASS, including competing reservations, duplicate reserve/release retries and reservation versus physical debit.
- 165 desktop/tablet/mobile browser tests PASS, including permission-limited reservation UI and identical retries after an uncertain response.
- Typecheck, API/frontend build, backend runtime image and existing strict-TLS/runtime diagnostics PASS.
- Two subsequent local online-helper tests PASS; the helper's version banner is `RESERVATIONS_VERIFICATION_VERSION: 1`. These tests verify GET-only business requests and no secret output. Only the version banner, helper tests and documentation follow the above CI revision; reservation implementation is unchanged.

The existing schema-count assertion was the only initial check failure (35 expected versus 37 actual); it was updated for the two intentional tables and the full gate then passed. No test was removed. No paid resources, hosted fixtures, migration or main deployment were executed. Hosted permission/advisor and authenticated online checks remain pending approved migration and release. Phase 17 is implemented and automatically verified, not yet signed off online. Phase 18 has not started.

## Approved hosted migration and publication — 2026-09-15

The operator explicitly approved the single Phase 17 migration and main publication of `b5dfe81ab4a7b70f0263a18ff1c321e224ac7fe2`, including normal automatic GitHub Actions/Railway usage on unchanged resources. Migration applied exactly once, recorded by hosted Supabase as `20260915084006_phase_17_reservations`. This corresponds to repository file `20260914193226_phase_17_reservations.sql`; do not apply that SQL again merely because the hosted timestamp differs. The earlier automatic-review rejection did not execute a migration.

Main ref was advanced without force and verified at the exact approved SHA. No other main push or manual deployment was performed.

Hosted database checks PASS: both reservation tables have RLS; anon/authenticated have no direct SELECT; runtime has no UPDATE/DELETE on reservation state/history; runtime can insert event request columns but cannot update reserved balance/pallet counters or directly execute the private posting function. Reservation count is zero; no hosted fixtures were created.

Security advisor reports no new findings. Existing [default-deny private location-lock policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remain unchanged. No paid setting was enabled.

Initial public checks after push: live 200, ready 200; reservation list GET, detail GET, create POST and release POST all returned 404. POST probes were anonymous empty objects against the new routes and could not create business data. Railway tools are unavailable, so these health responses do not prove the active deployment SHA. Deployment/route acceptance remains pending; no manual deployment or repeat migration is warranted by these initial 404s.

Next operator check inside Railway: `node -e 'console.log(process.env.RAILWAY_GIT_COMMIT_SHA || "COMMIT_UNAVAILABLE")'`. Expected SHA: `b5dfe81ab4a7b70f0263a18ff1c321e224ac7fe2`. Once active, repeat only the new route probes (expected 401 without login), then run `node scripts/verify-reservations.cjs` locally with hidden inputs. Authenticated online PASS is not yet claimed. Previous automated tests were not manually rerun. Photos remain disabled hosted. Phase 18 has not started.

## Active Railway route verification — 2026-09-15

Operator verified Railway commit `b5dfe81ab4a7b70f0263a18ff1c321e224ac7fe2`. Targeted anonymous probes now PASS: reservation list GET 401, detail GET 401, create POST 401 and release POST 401. Only these four previously-404 routes were rechecked; no existing health/database/automated tests were repeated. Empty unauthenticated POST probes made no business changes.

Authenticated login/isolation verification remains pending the operator's local execution of `scripts/verify-reservations.cjs`; credentials stay on their machine. Expected final result is `PHASE_17_READ_ONLY_VERIFICATION: PASS`, with `RESERVATION_EXISTING_RECORD: NOT_RUN` permitted if no existing reservation is present. No fixtures are to be created for this read-only check. No push, migration, deployment, resource or photo-setting changes. Phase 18 has not started.


## Final online sign-off — 2026-09-15

Phase 17 is complete with operator-reported `PHASE_17_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, reservation reads, not-found behavior and company isolation passed. Expected `RESERVATION_EXISTING_RECORD: NOT_RUN (no existing reservation; no fixture created)` means positive hosted detail/history reads were not exercised; previously recorded automated tests remain their coverage. Hosted reserve/release writes are not claimed by this read-only verification.

No tests were rerun, no fixtures created and no push, migration, deployment or resource changes performed for this documentation-only closure. Photos remain disabled hosted. Phase 18 has not started.
