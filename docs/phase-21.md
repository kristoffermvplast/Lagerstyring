# Phase 21 — dashboard and alerts

Current status: Phase 21 is closed within the verification scope recorded in the final section below. CI, hosted migration, main/Railway activation and operator-confirmed read-only online verification pass. Earlier checkpoints are retained as historical records. Phase 22 is not started.

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


## Completed CI and hosted checkpoint — 2026-09-15

Published the implementation as `4fd3db90813aa42807b0bece3f637fa9773e581f` on `phase21-dashboard`. Its Git tree `aee638480501252142de2c5071b639d90fda4a35` is exactly identical to local implementation `2e303e28d217e8ed6785c8bc6d92a697434e0495`; confirmed both from the GitHub tree response and by fetching the remote branch. No code correction was needed after CI.

[CI run 35002265856](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35002265856), job `104493278433`, completed SUCCESS on this exact SHA:

- 249 unit/API/database/helper tests PASS (52 suites). The 18 concurrency cases skipped in this stage were then executed separately.
- 18 real PostgreSQL concurrency tests PASS, including the new simultaneous acknowledgement test.
- 198 browser tests PASS across desktop/tablet/mobile, including all 9 new dashboard cases.
- Typechecks, API/web builds, runtime Docker build, diagnostic loading and strict TLS/CA materialization PASS.

These results supersede the earlier pending CI/browser/concurrency checkpoint. Only the normal existing CI ran; no redundant local full regression run was performed. Expected/worst-case incremental standard public GitHub runner charge: 0 DKK. Main was independently rechecked and remains `6ebe98e6c989e220166f23061e0e40aeb9240845`.

Phase 21 is implemented and CI-verified, but NOT online-verified or closed. The new Phase 21 migration is still unapplied hosted. No hosted migration, main update, Railway deployment, resource/limit change or photo setting change was made. The final CI record is local only, avoiding another automatic CI/deployment for documentation.

Economic checkpoint before main/Railway: expected 0–0.30 DKK, realistic worst-case 1–3 DKK, one-off, for normal Railway build/startup and temporary container overlap on the existing unchanged service. This is the existing engineering estimate, not measured billing; build duration/remaining included usage cannot confidently establish a <=1 DKK maximum. User approval is required before that concrete action. Old Phase 20 approvals do not authorize Phase 21 deployment. Remaining hosted verification must use the correct active commit, without repeating the Phase 20 migration or creating business fixtures. Photos remain disabled hosted. Phase 22 has not started.

## Conditional hosted approval and migration-price stop — 2026-09-16

User approved publishing only CI-verified `4fd3db9` to main, normal automatic Railway deployment on unchanged resources and targeted online checks, accepting the existing 0–0.30 DKK expected / 1–3 DKK worst-case one-off Railway estimate. Manual deployment and resource changes remain excluded.

Migration authorization is stricter: only Phase 21 and expected 0 DKK on the existing Supabase project; any uncertainty about price or scope requires stopping before execution. Reviewed the exact local migration: two permission rows and one empty personal acknowledgement table with RLS, column grants and immutable trigger. No other phase migration is included. Read-only Supabase inspection confirms project `puwyontrchonoepisgun` ACTIVE_HEALTHY and migration history through Phase 20 only; Phase 21 is not registered.

Available project metadata does not expose billing plan, remaining included usage or billable storage headroom. Therefore an expected zero incremental invoice and a defensible numeric worst-case cannot be established from this session's evidence. This is a pricing uncertainty, not a migration-scope uncertainty. No migration was executed. Publication of dependent code was not attempted, since its readiness requires the new table. No main update, deployment, hosted data/configuration/resource change or repeated tests. Existing Railway approval remains valid for the exact authorized action; it does not override the separate zero-cost migration condition. Photos unchanged/disabled hosted; Phase 22 not started.

## Hosted migration, main publication and Railway activation — 2026-09-16

User confirmed the existing Supabase organization is on Free and explicitly approved exactly the reviewed Phase 21 migration, once, without paid features or resource changes. This resolves the earlier zero-cost authorization checkpoint; expected new Supabase charge is 0 DKK on that user-confirmed plan with no upgrade. The previous main/automatic Railway approval remains applicable (0–0.30 DKK expected / 1–3 DKK realistic worst-case, one-off).

Preflight confirmed the Phase 21 table and migration were absent. Applied the SQL from exact CI-verified commit `4fd3db90813aa42807b0bece3f637fa9773e581f` once; Supabase registered `20260916071415_phase_21_dashboard_alerts`. Verified RLS enabled; anon/authenticated SELECT false; runtime SELECT true and UPDATE false; runtime cannot INSERT actor_id but can INSERT alert_key. SELECT/INSERT policies require selected company, current actor and dashboard permissions. Phase 20 and all other migrations were not rerun.

Advanced main without force from `6ebe98e6c989e220166f23061e0e40aeb9240845` to `4fd3db90813aa42807b0bece3f637fa9773e581f`; independently verified the resulting remote ref. No extra documentation commits were published.

Railway connector verified automatic deployment `0f57779a-cc53-421a-a538-0beb38056a38`, branch main, exact commit `4fd3db90813aa42807b0bece3f637fa9773e581f`, SUCCESS at 07:16:05 UTC. Existing service remains linked to kristoffermvplast/Lagerstyring/main with one replica. ITEM_PHOTOS_ENABLED is absent from the service variable names; application default remains false. No configuration was changed and no manual deployment was used.

Targeted public curl checks PASS: GET /api/health/ready -> 200; anonymous GET /api/companies/<probe>/dashboard -> 401; anonymous POST /api/companies/<probe>/dashboard/acknowledge -> 401. Probe is non-business UUID 00000000-0000-4000-8000-000000000000, without credentials or business payload. No acknowledgement or fixture was created. A separate direct-network readiness diagnostic could not resolve DNS; the normal routed requests above completed successfully.

Authenticated verification remains NOT_RUN because operator login credentials are unavailable in this session. Run the already-tested `node scripts/verify-dashboard.cjs` using hidden prompts. Required result: PHASE_21_READ_ONLY_VERIFICATION: PASS, covering real login/session, membership/permissions, dashboard scope/shape, foreign-company denial and session cleanup. No business writes are performed. Do not send passwords or session tokens in chat. Phase 21 is deployed but must not be declared fully online-verified or closed until that result is received.

This record is local only. Prior local/CI suites were not repeated. No resource, limit, photo or other migration changes. Phase 22 has not started.


## Final operator verification and closure — 2026-09-16

The user confirmed the final authenticated online verification:

```text
PHASE_21_READ_ONLY_VERIFICATION: PASS
DASHBOARD_COMPLETENESS: PASS
```

Login and session, dashboard permissions, dashboard read, response scope, alert shape, company isolation, dashboard completeness and session cleanup all passed according to the operator result. This completes the outstanding authenticated verification following the previously verified main/Railway commit `4fd3db90813aa42807b0bece3f637fa9773e581f`, SUCCESS deployment `0f57779a-cc53-421a-a538-0beb38056a38`, readiness 200 and both anonymous dashboard routes 401.

Hosted migration `20260916071415_phase_21_dashboard_alerts` was already applied once and verified; it was not repeated. Prior CI remains the automated write/lifecycle coverage: 249 unit/API/database/helper tests, 18 real PostgreSQL concurrency tests and 198 browser tests, plus build/runtime/TLS. The operator result verifies read-only behavior and a complete source scan for that request; it does not claim hosted acknowledgement writes, every possible alert condition, or every source record was exercised. No hosted fixture was created for this closure.

Phase 21 is closed within this documented scope. Only README.md, docs/architecture.md and docs/phase-21.md were updated and committed locally for closure. No tests were repeated, no migration or deployment was run and no main publication was triggered. Local documentation incurs no new external service charge. Photos remain disabled hosted; resources and usage limits are unchanged. Phase 22 has not started.
