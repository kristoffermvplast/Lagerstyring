# Phase 21 — dashboard and alerts

## Scope and baseline

Started from main `6ebe98e6c989e220166f23061e0e40aeb9240845`, with Phase 20 closed. Scope: dashboard and warnings; each significant problem links to an action. No Phase 22 workflow, hosted photo enablement or visual redesign.

## Implemented

- `GET /api/companies/:companyId/dashboard`: critical problems first, active production orders, today's receipts/shipments, low available stock, upcoming material shortages and stale counts. All links open the relevant order/shipment/receipt/count or a stock search for the item code.
- `POST .../dashboard/acknowledge`: strict source key and SHA-256 fingerprint; current source is checked in the same SERIALIZABLE transaction. Stale/not-current input returns 409. Repeated current input is idempotent, including bounded serialization/deadlock retries.
- Explicit `dashboard.read` and `dashboard.acknowledge` permissions. Every source also requires its existing read permission; stock/planning requires inventory.read plus masterdata.read. Count alerts require counts.read plus inventory.read. Permissions can be managed in the existing role editor.
- Personal immutable acknowledgements with server-set actor/time, tenant RLS, column-limited INSERT and no browser grants. Acknowledging means seen by this user, not fixed. A changed fingerprint reopens the warning. Previously acknowledged conditions absent from a complete current scan appear resolved only while their source remains accessible. No snapshots are retained in acknowledgement history.
- Up to 200 records per source; explicit partial-result notice on truncation. No inference of resolution from incomplete data. Exact matching current acknowledgements are independent of the 500-key historical window. Historical source lookup is batched.
- Exact eight-decimal quantity arithmetic. Company-owned active-owner stock less reservations forms an indicative planning pool; external-owned stock is excluded. Planned/ready orders draw from that pool in planned-start/deadline order, with ID tie-break. Frozen BOM/packing snapshots determine demand; component units must match. This is not a reservation, purchasing proposal or guarantee of stock at a particular location. Full order need is compared with the global company-owned pool (which also includes already-issued company-owned material); remaining consumption and allocations by owner/location must be reviewed on the order.
- Day boundaries use Europe/Copenhagen, including DST. Refresh is explicit; there is no polling. Refresh errors hide stale action cards. Company changes reset navigation and data keys.

New local migration: `20260915171849_phase_21_dashboard_alerts.sql`. Only adds permissions and an acknowledgement table/policies/grants/immutable trigger. Readiness checks its presence. No change to old migrations or stock journals. It has NOT been applied hosted. The already-applied Phase 20 migration must not be repeated.

## Local verification — 2026-09-15

- 11 new API/database tests exercise the real DatabaseService transaction/session checks over isolated PGlite fixtures: exact thresholds, foreign-company denial, source permissions, personal acknowledgement lifecycle, malformed/stale input, immutable identities/browser grants, Copenhagen midnight/DST, revoked sessions, sequential snapshot shortages, owner/reservation protection, stale counts/late shipments, bounded scans and authenticated HTTP route registration (401 without credentials).
- 2 new verification-helper tests: hosted response scope, no business writes, secret-safe output and session cleanup on success/failure.
- Existing database security/schema suite: 5 tests PASS; expected public-table count updated from 44 to 45 for the new table.
- TypeScript checks for both applications PASS. API/web production build PASS.
- Added 3 browser scenarios across desktop/tablet/mobile (9 cases): direct navigation and tenant reset, identical retry after uncertain acknowledgement, partial/failed overview handling. Test collection PASS. Execution pending: this workspace has no installed Chromium; previous browser installation attempts were unavailable, so they were not repeated.
- Added one real PostgreSQL concurrent-acknowledgement test in the existing CI suite. Execution pending: no disposable local PostgreSQL server is available in this workspace. PGlite tests do not claim to verify concurrent transactions.

Only relevant new/changed tests ran locally; prior full suites were not repeated. The normal CI remains necessary for browser execution, real PostgreSQL concurrency and regression checks on the shared application integration. Its configured public-repository standard GitHub runner has expected 0 DKK / realistic worst-case 0 DKK external runner cost. This estimate excludes Railway or any hosted changes.

## Remaining gates

CI has not yet run for Phase 21. Implementation is locally committed before work-branch publication; no main update or Railway deployment is implied by this document.

After CI, separately check the authorized hosted scope and economic rule before migration/main/deployment. A normal Railway build/startup/container overlap has the previous engineering estimate of 0–0.30 DKK expected / 1–3 DKK realistic worst case; it cannot confidently be bounded to 1 DKK and requires a concrete approval before triggering it. Do not alter resources or use manual deployment without approval. Use the Railway connector directly for available deployment/status reads.

Targeted online checks once the correct implementation is active: anonymous GET dashboard and POST acknowledge should return 401; readiness should pass; run `node scripts/verify-dashboard.cjs` with hidden operator inputs and no fixture creation. The helper performs login, identity/membership and permissions checks, dashboard response-scope/alert-shape checks, foreign-company denial and session cleanup. Required marker: `PHASE_21_READ_ONLY_VERIFICATION: PASS`. It performs no acknowledgement or business write. Partial source scans are reported distinctly. There is no dashboard detail route, so no fabricated existing-record or detail not-found claim.

Phase 21 is not yet CI/online-verified or closed. Photos remain disabled hosted. No migration, hosted data, photo settings, deployment, resources or limits were changed in this local work. Phase 22 has not started.
