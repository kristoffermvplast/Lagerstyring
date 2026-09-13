# Phase 12 — Production registration

**Status: complete within the documented verification scope.** Earlier pending notes below are historical checkpoints, superseded by the final sign-off. Phase 13 has not started.

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


## Authorized main publication; hosted route verification pending

The specifically approved local `723923013fcfec702fc9c0bff252837cfdb23d1f` is published on main as `28637bc708d952f39c9f62f6568722493f3e9906`. Both commits have identical tree `9a549eaf7632e97210d43c6908a2fa41ff024e8b` and parent `5e369e6c8863d9d5f6290546e7cf631e103de02e`; only commit metadata differs. Live GitHub main was verified, followed by native fetch and an empty content diff against the approved local commit.

Normal automatic CI [34761925854](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34761925854) was in progress. Public readiness returned HTTP 200. Registration list, summary and detail GET routes returned HTTP 404 on both the initial and one bounded follow-up anonymous check; expected status after deployment is HTTP 401. The active Railway release is not yet confirmed. No authenticated hosted result is claimed.

Next: operator confirms Railway commit `28637bc708d952f39c9f62f6568722493f3e9906`, then repeat only the targeted route check and run the pinned `scripts/verify-production-registrations.cjs` with hidden local credentials. Phase 12 final online sign-off remains pending. Migration was not rerun. No manual deployments, new hosted fixtures, resource changes or photo activation. Phase 13 has not started. This checkpoint is local and has not triggered an additional push.


## Targeted hosted route verification after deployment confirmation

The operator confirmed Railway runs `28637bc708d952f39c9f62f6568722493f3e9906`. The three previously missing anonymous registration GET routes (list, summary and detail) now all return the expected HTTP 401. Targeted route verification: PASS. Previously passed readiness, database/TLS and application tests were not repeated.

Authenticated hosted login/isolation verification still requires the operator to run the pinned `scripts/verify-production-registrations.cjs` locally with hidden credentials and the existing approved isolation company. No authenticated result is claimed yet. No push, migration, deployment, hosted fixture or configuration/resource change was performed in this checkpoint. Photos remain disabled hosted. Phase 13 has not started.


## Final Phase 12 sign-off

Phase 12 is complete with operator-reported `PHASE_12_READ_ONLY_VERIFICATION: PASS` on confirmed Railway commit `28637bc708d952f39c9f62f6568722493f3e9906`. Login, session, permissions, production-order reads, registration access boundaries, not-found behavior and company isolation passed. `PRODUCTION_REGISTRATION_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive registration list/summary/detail reads for an existing order and hosted writes were not exercised; previously documented automated tests remain their coverage.

The operator supplied the final PASS result; no passed tests were rerun. The preceding independent anonymous checks returned HTTP 401 for all three registration routes. Preserve the following expected limitation explicitly:

```text
PRODUCTION_REGISTRATION_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)
```

NOT_RUN is not counted as PASS. No hosted fixture was created, and the read-only helper did not exercise production start, registration or correction writes. Their evidence remains the previously recorded automated tests (155 unit/API/database/helper, 8 PostgreSQL concurrency and 108 browser tests).

This closing task changes only documentation. No push, migration, deployment, hosted configuration change or resource increase was performed. The economic 1 DKK rule remains in effect. Photos remain disabled hosted. Phase 12 is closed; Phase 13 requires separate authorization.
