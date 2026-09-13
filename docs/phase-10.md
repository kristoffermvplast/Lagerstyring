# Phase 10 — Production order planning

Continues from approved main `952dde2`. Phase 11 has not started. Hosted photos remain disabled.

## Scope and behavior

Production orders have stable internal IDs, company-unique case-insensitive order numbers, product, optional customer/machine, planned quantity, start/deadline, priority and notes. Create defaults come from existing product data and explicitly marked default BOM/packing recipes. No business data is seeded. A product cannot be changed on an existing order.

Drafts may lack unit/BOM/packing/machine and display missing-data warnings. Planning requires a stock unit and a published compatible BOM. Marking ready additionally requires machine, packing and no open problem. Ready is an operator's planning/klargøring confirmation; it does not assert stock availability, reserve stock or start a machine. Problems remain a separate text marker, including on an already-ready order.

Phase 10 supports draft → planned → ready, planned → draft and ready → planned. Draft edits require the current version. Return explicitly to draft before changing planned data. Planning snapshots are refreshed deliberately when a draft is edited/planned; previous values remain in the audit. The full approved status vocabulary is reserved in the database, but transitions to production/reconciliation/completion are rejected until later phases implement the required workflows. No production quantities/progress are fabricated.

Selected sealed BOM and packing revisions are copied into the order snapshot with product name/code, stock unit, production defaults, customer address and machine identity. Masterdata changes never rewrite an existing order or its history. Read-only production users can read the snapshot and requirements without masterdata privileges. Creation/planning requires `production.read`, `production.manage` and `masterdata.read`. Tenant RLS and composite foreign keys apply throughout; browser roles have no business-schema access.

The existing fixed-point calculator derives component requirements, packaging counts, full/partial containers and remainder from the snapshot. No floating-point quantity math. Consumption ownership remains BOM versus packing, with duplicate components rejected. Optional order-specific packing quantities/capacities override existing lines only, are validated and snapshotted on this order, and never update a master recipe. Changes to the component structure require selecting a suitable published recipe.

## Database and transaction boundaries

New tables: `app.production_orders`, `app.production_order_audit`. New permissions: `production.read`, `production.manage`. Indexed company/code/status/date/product/customer/machine/revision references. Positive finite numeric(20,8) quantity, whole count units, deadline not before start, company-safe references and bounded text/JSON. Runtime has only explicit insert/update columns on orders and SELECT on immutable audit. No delete grants, no snapshot/identity update grants, no audit mutations.

Internal `app_owner` trigger functions validate tenant/actor/permissions before privileged snapshot reads and audit append. They are in `app_private`, have fixed search paths and no runtime/browser EXECUTE grant. Snapshot JSON quantity fields use strings to preserve exact precision in JavaScript. No exposed security-definer API.

NestJS uses existing SERIALIZABLE transactions with bounded retries for serialization/deadlock and creation-key collisions. Creation key + normalized request detects duplicate submissions and rejects changed replay. Optimistic versions prevent lost edits/status changes. UI freezes uncertain submissions for same-request retry. No journal, balance, reservation or stock ownership changes occur in this phase.

## User interface and API

Production navigation, searchable paginated table and status-grouped Kanban for the current page. Status/date/machine/customer filters, create/edit draft, selectable BOM/packing revisions, packing overrides, requirement detail, problem marker and status confirmation. Audit detail exposes previous/current order snapshots. Existing login and role editor are reused.

API prefix: `/api/companies/:companyId/production-orders`.
- GET collection, `/:id`, `/:id/history`.
- GET `/defaults/:productId` for authorized planners.
- POST collection, `/:id/status`, `/:id/problem`.
- PATCH `/:id` for draft editing with version.

## Verification status

Targeted API tests cover idempotency, decimal needs, snapshots, transitions, draft completeness, packing overrides, audit, permissions, company boundaries and forbidden direct database mutations. Real PostgreSQL concurrency test covers simultaneous creation and stale competing edits. Browser tests cover read-only isolation, defaults, uncertain retry, needs and confirmed planning on desktop/tablet/mobile. Results will be recorded after execution; missing gates are not PASS.

`scripts/verify-production-orders.cjs` is a read-only hosted operator helper with hidden local credentials, sanitized output and session cleanup. It creates no business fixtures. If no order exists, preserve `PRODUCTION_ORDER_EXISTING_RECORD: NOT_RUN` and do not claim hosted detail/write verification.

## Release and cost boundaries

No new services, dependencies, runners, resource increases, secrets or paid features. Existing public repository standard CI is free; no Railway deployment from the working branch. Main push requires its own economic assessment/approval because normal Railway usage cannot currently be bounded within 1 DKK. Hosted migration is complete as recorded below. Main release and authenticated online verification remain pending.

## Deferred

Material issue (Phase 11), production registration, returns/reconciliation, finished stock release, reservations, pallets/QR, capacity scheduling and forecasting. No Phase 11 work is started. Hosted photos stay disabled.

## Completed pre-release verification

[CI run 34729642508](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34729642508), job `103649939224`, working-branch commit `86082052d58bc9fcdb3e00fe8f5dcef71267fda3`: all steps PASS. Logs confirm 135 unit/API/database/operator-helper tests, six real PostgreSQL concurrency tests and 96 desktop/tablet/mobile browser tests. The six concurrency tests are intentionally skipped in the normal suite and pass in the dedicated PostgreSQL step. Typecheck, frontend/backend build, Docker runtime, diagnostic script loading and strict TLS/CA runtime validation also pass.

Local verification caught and fixed the schema table-count expectation (27 → 29) and an ambiguous PL/pgSQL unit alias in the new transition validation. The targeted database/API/helper tests passed after correction; the final CI run above verifies the combined implementation. No previous online verification was rerun.

Hosted migration `20260913010919_phase_10_production_orders` was applied once to existing Supabase project `puwyontrchonoepisgun`. The CLI-created source filename was aligned with the version assigned by the hosted migration tool; SQL content is identical to the tested version. Do not rerun this migration. The organization remains Free; database size before migration was 13,053,075 bytes. No billable resources, users or fixtures were created.

Hosted read-only checks: both new tables have RLS, both production permissions exist, no runtime DELETE or snapshot UPDATE, no audit INSERT/UPDATE/DELETE, no browser schema usage, no runtime EXECUTE on internal triggers, and trigger ownership is `app_owner`. Orders and order audit both contain zero rows. Security advisors show no new findings: the existing intentional [default-deny private location lock policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and disabled [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) are unchanged. No paid Auth feature was enabled.

## Pre-publication release gate (historical)

Implementation and automated verification are complete. Main remains `952dde2`; Phase 10 has not been deployed to Railway. The hosted API/login/isolation helper remains NOT_RUN until the approved release is active. No hosted production write behavior is claimed as verified. Use `node scripts/verify-production-orders.cjs` locally with hidden credentials after release; no credentials in chat. Preserve the expected missing-existing-order NOT_RUN if applicable.

The concrete main push triggers normal GitHub Actions and Railway deployment. Expected incremental cost: 0–0.30 DKK; realistic worst-case scenario: 1–3 DKK, one-off. Basis: 5–10 minutes around 1–2 vCPU/1–2 GB normal resource overlap, versus 30–60 minutes at 4 vCPU/8 GB in the stress scenario, at [Railway resource rates](https://docs.railway.com/pricing/plans) $0.000463/vCPU-minute and $0.000231/GB-minute, using 10 DKK/USD as a conservative conversion/buffer assumption. These are scenarios, not measured deployment billing; current Railway usage/credits are inaccessible, so a reliable ≤1 DKK bound is unavailable. [Public-repository standard GitHub Actions runners are free](https://docs.github.com/en/billing/concepts/product-billing/github-actions); existing runner/cache settings and dependencies are unchanged. Main push requires explicit economic approval. No manual deployment, resource increase or further migration is proposed.

Hosted photos remain disabled. Phase 11 has not started.

## Approved main publication

The user approved the one push of `a788164`, including its normal automatic GitHub Actions and Railway runs on unchanged resources. Main was fast-forwarded to `2abd67b35d07bf1bb27424f21789bef745154fdb`. The GitHub-created commit has the same parent `86082052d58bc9fcdb3e00fe8f5dcef71267fda3`, tree `e5651662c5f98f9354c8b179959c06b0c802c1c1` and message as approved local `a788164`; only commit metadata/identity differs. Automatic approval review initially rejected the differing SHA, then permitted the push after read-only evidence established this equivalence. Fetched main content was verified identical to the approved commit.

Normal automatic main CI: [run 34754395182](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34754395182), job `103716206437`. No manual CI rerun, deployment, migration, resource/configuration change or extra branch push was performed. Hosted photos remain disabled.

Initial release-window endpoint results: liveness HTTP 200; readiness HTTP 503; anonymous production-order collection and probe detail HTTP 404 (expected 401 when the new controller is active). These responses do not establish the Railway revision. Railway tools are unavailable in this conversation. Authenticated online verification is NOT_RUN until route/readiness availability is established and the operator runs the hidden-input helper. No credentials or hosted business fixtures were created.

Main CI completed successfully: all code/database, real PostgreSQL concurrency, browser, Docker runtime, diagnostic and strict TLS/CA steps PASS. The targeted online recheck still returned readiness 503 and anonymous order collection/detail 404, rather than expected readiness 200 and route 401. Liveness had already returned 200 and was not repeated. No full online Phase 10 completion is claimed.

Next operator action: confirm the active automatic Railway deployment for `2abd67b35d07bf1bb27424f21789bef745154fdb` and its status. Do not manually redeploy or change resources. Share only commit/status, no secrets. Once the expected revision is active, recheck readiness and the blocked routes. If readiness remains 503, run the existing `node /app/scripts/verify-database.cjs` diagnostic inside the existing container and share sanitized PASS/FAIL codes only. Authenticated verification then uses `scripts/verify-production-orders.cjs` with locally entered hidden credentials, company `MV Plast` and the already-approved isolation company; no new fixtures.

This release result is recorded locally only; no additional documentation push/deployment is included in the one-push approval. Photos remain disabled hosted. Phase 11 has not started.

## Targeted check after operator-confirmed Railway revision

The operator confirmed active Railway commit `2abd67b35d07bf1bb27424f21789bef745154fdb`. Anonymous production-order collection and probe detail now return HTTP 401 — PASS. The earlier 404 route blocker is resolved. Readiness still returns HTTP 503; authenticated verification remains pending. No previously passed CI/tests were repeated.

A read-only database diagnostic attempting `SET LOCAL ROLE app_backend` through the Supabase management connection was rejected with 42501 (permission denied to set role). No grants were changed or alternative privileged impersonation attempted. This management-connection restriction is not evidence of a failure in the Railway login itself. The actual connection must be diagnosed inside the existing Railway container using sanitized diagnostics. No code, migrations, deployment or hosted settings were changed.

## Readiness permission-catalog regression fix

Operator diagnostics passed connection/TLS/role checks, auth configuration, all readiness tables, session function and receipt column. Only `TRANSFER_PERMISSION_VISIBLE` failed. Targeted hosted read-only inspection confirmed `inventory.transfer` exists and the `permission_catalog` SELECT policy requires `app.actor_id() IS NOT NULL`. Readiness has no actor, so its permission-row existence check incorrectly failed under the intended RLS policy.

The local fix replaces that row lookup with `to_regclass('app.permissions') IS NOT NULL`. Readiness checks structural availability; authenticated verification checks permissions. No actor is fabricated, no RLS policy/grant is relaxed, and no migration, seed or hosted data correction is needed.

Validation: API TypeScript build PASS; targeted `tests/database.test.ts` PASS (5 tests). The new regression exercises the real readiness query through Kysely against isolated PostgreSQL as `app_backend` with no actor: the seeded transfer permission is hidden, readiness succeeds, permission rows remain hidden afterwards, and readiness still fails when the production-order table is absent. Local test changes roll back. Unrelated suites and hosted TLS checks were not repeated.

The fix is local pending a separately approved main push and automatic Railway deployment. Hosted readiness 200 and authenticated Phase 10 verification remain pending. Photos remain disabled hosted; Phase 11 has not started.
