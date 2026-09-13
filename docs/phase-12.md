# Phase 12 — Production registration

Continues main `1144ff2f5ebf6116ee874099194c6f033bbecebf`. Implementation and automated verification are complete on the working branch; main release awaits economic approval. Phase 13 has not started.

## Scope and boundaries

A planner with existing `production.manage` and `masterdata.read` may start a ready order. Start checks active references, machine, packing, unit and no open problem; the snapshot remains frozen. An order in production cannot return to planning/draft. No completion, reconciliation or return workflow is introduced.

Operators with `production.read` and `production.record` register incremental good quantities, optional whole box counts and comments. No planning or inventory permission is required to record. New records require an in-production order without an open problem. Overproduction is allowed and shown explicitly. Exact numeric quantities and integer arithmetic calculate net production and progress; count units require whole quantities. Boxes are optional informational counts only, with no inferred packaging consumption.

`production.correct` permits a reasoned full reversal of a mistaken record while the order is in production, including when a problem is marked. An original can be reversed once; a reversal cannot itself be reversed. To replace a mistaken quantity, reverse it and record the correct increment. Original history and snapshots remain intact. No physical stock, reservation, material consumption, waste or finished-goods delivery changes occur.

## Database and API

Migration `20260913135323_phase_12_production_registration.sql` creates `app.production_registrations`, company-safe order/self foreign keys, unique company/idempotency and reversal constraints, history index, RLS and column-specific INSERT privileges. It extends the existing order guard only to permit ready → in_production and validate start references. It adds technical permissions, not business masterdata or hosted fixtures.

The private NOLOGIN-owner trigger checks actor/company/permissions, locks the order, validates state and captures an immutable order/product/unit/machine snapshot. It supplies identity/time and reversal quantities itself. Runtime cannot supply the snapshot or actor/time, update/delete history, or execute the private functions. Browser roles have no grants. The trigger's order lock serializes recording, correction and order edits without requiring planner rights for an operator. The backend uses the existing SERIALIZABLE transaction and bounded serialization/deadlock/idempotency-conflict retries. Identical retries return the original event; changed payload or cross-order reuse conflicts.

NestJS routes under `/api/companies/:companyId/production-orders/:orderId/registrations`:

- GET list with pagination; GET `/summary`; GET `/:id`.
- POST incremental registration; POST `/:id/reverse` with reason and idempotency key.

Readiness checks table existence without actor-dependent permission queries. UI uses only NestJS, shows totals/progress/overproduction and history, retains the same request/key after an uncertain response, and provides reasoned correction. Production can still receive materials while running. No dependency, infrastructure or hosted photo changes.

## Verification

Targeted API/database/order regression and secret-safe helper tests: 20 PASS after correcting a discovered SELECT FOR UPDATE/RLS interaction for record-only operators. The database trigger now owns order locking; planning permissions were not broadened. The schema-count assertion and formerly unsupported in-production API status expectation were updated for the new phase.

Full `npm run check`: PASS (typecheck/build and 154 tests; 8 real PostgreSQL tests skipped locally). An additional aggregate-overflow regression is included for CI after correcting the summary to accept totals larger than a single numeric field. Real PostgreSQL concurrency and browser verification: PASS in the existing CI. New tests cover auth, company isolation, operator vs planner/correction permissions, exact increments, idempotency, overproduction, invalid values, whole count units, immutable snapshots/history, problem gates, correction, no inventory effects, restricted grants and revoked sessions. Real PostgreSQL tests add duplicate/concurrent increments, competing reversals and recording vs problem marking. Browser tests cover read-only controls and retry identity on desktop/tablet/mobile.

Local Chromium download timed out; use existing standard public-repository CI for browser and disposable PostgreSQL checks. No new runner, environment or paid service is required. [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) confirms standard runners on public repositories are free; this repository and unchanged ubuntu-latest workflow were checked. No artifacts are uploaded by the workflow.

Hosted migration `20260913135323_phase_12_production_registration` applied once to the existing Free project. The local filename was aligned to hosted migration history; SQL is unchanged. Post-migration checks PASS: table/RLS/permissions present, runtime snapshot/author/history protected, internal guard not callable, browser access blocked, zero hosted registrations. Readiness/routes and authenticated verification remain pending. `node scripts/verify-production-registrations.cjs` uses hidden local credentials, GET-only business requests, the existing approved isolation company and local Supabase-session cleanup. Expected final line: `PHASE_12_READ_ONLY_VERIFICATION: PASS`. Preserve `PRODUCTION_REGISTRATION_ORDER_FIXTURE: NOT_RUN` if no order exists or `PRODUCTION_REGISTRATION_EXISTING_RECORD: NOT_RUN` if no registration exists; no fixtures are created. Online writes are not part of this helper.

The economic 1 DKK rule applies. A main push with automatic Railway deployment requires its concrete cost assessment/approval. Photos remain disabled hosted. Phase 13 requires separate authorization.


## Hosted review

No new security advisor findings. Existing notices are unchanged: intentional default-deny RLS on private `location_tree_locks` ([details](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)) and disabled leaked-password protection ([details](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). No paid feature or configuration change was made.

Existing Free plan verified; database size before migration 13,331,603 bytes. Migration/verification uses existing resources with 0 DKK expected additional cost. No hosted fixtures or new services. Real PostgreSQL concurrency, browser and runtime steps passed in working-branch CI. The added aggregate-overflow test also passed locally (7 registration API tests).


## Automated verification complete; main release pending

Working-branch CI [34761010615](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34761010615), job `103733727199`, commit `5e369e6c8863d9d5f6290546e7cf631e103de02e`: SUCCESS. Remote tree `15c7c120ec63c46c087235ad59782c6e159cb14d` matches local implementation `329e491`. Results: 155 unit/API/database/helper tests PASS; all 8 real PostgreSQL concurrency tests PASS in the separate disposable-database step; all 108 desktop/tablet/mobile browser tests PASS; typecheck/build/Docker runtime/diagnostic availability/strict TLS CA materialization PASS. The 8 skips in the general test step were executed successfully in the PostgreSQL step. No manual rerun was requested.

Only subsequent changes are documentation and a 100% unchanged migration filename alignment to hosted version `20260913135323`. No code changed after successful CI.

Main push and normal Railway deployment are not performed yet. Expected one-off additional Railway consumption is estimated at 0–0.30 DKK; conservative realistic worst-case 1–3 DKK, depending on actual compute duration, deployment overlap and remaining included credit. This is an estimate, not measured usage or a guaranteed cap. Standard GitHub Actions runner time is free for this public repository. [Railway resource pricing](https://railway.com/pricing) is usage-based; no resource changes are proposed. Since the Railway charge cannot confidently be bounded at 1 DKK, explicit approval is required before the main push. Hosted migration has already been applied once and must not be repeated. After release: anonymous registration list/summary/detail should return 401, readiness 200, followed by the hidden-input read-only verification helper. Phase 12 is not yet signed off online. Phase 13 has not started.
