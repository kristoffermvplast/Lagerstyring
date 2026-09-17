# Phase 22 — Reports and exports

Started from main `273716a6a89797fce1cc39427135fcf0dbdea1f5`, where Phase 21 is closed. Scope follows the existing roadmap: stock, production, consumption, waste, shipments and export. Acceptance: figures can be traced to journals and documents. Phase 23 is not authorized.

## Implemented scope

- Six NestJS report routes: `GET /api/companies/:companyId/reports/:kind`, where kind is stock, inventory, production, consumption, waste or shipments.
- Server-side literal text search, item/owner/location/order UUID filters where meaningful, inclusive Copenhagen calendar-day periods for events, stable ordering and pagination (25 default, 100 maximum).
- One SERIALIZABLE snapshot for filtered row count, all-filtered totals and returned rows. Totals are grouped by unit UUID, never mixed across units. Decimal values remain strings end to end.
- Stock shows current physical/reserved/available quantities; its journal link applies exact item/owner/location filters. Historical stock-at-date is not claimed.
- Inventory shows signed posted lines, including both transfer directions and reversal entries on their own posting dates. Frozen document snapshots are retained; names on later documents may differ after master-data changes.
- Production shows signed good registrations and reversals, not planned quantities or finished-stock deliveries. Consumption reads only the posted net consumption journal from closed orders, not material issues. Waste shows signed measured observations, not unexplained variance or an additional debit. Shipments include actual dispatched journal quantities, not planned/reserved quantities.
- Original row, document, order and reversal IDs are exposed. UI links open the relevant existing journal, production order or shipment. Stock stays untouched by reports.
- `reports.read` is necessary but does not replace each source's existing read permissions. `reports.export` is separate; exports also require the report's source permissions. Sessions, memberships, company selection and existing RLS remain authoritative.
- `POST /reports/:kind/export` generates a fresh filtered snapshot, including all matched rows rather than the current page. UTF-8 BOM/semicolon CSV quotes and escapes text, neutralizes spreadsheet formulas and preserves exact decimal strings. Import IDs/decimals as text in spreadsheet tools.
- Export limit: 2,000 rows and 4 MiB. Above the limit, refine filters; no silent truncation, background job, stored CSV or new service. A generation receipt records company, server actor/time, filters, row count and SHA-256 of the exact UTF-8 CSV. It proves generation, not successful download. Retrying generates a fresh snapshot and receipt, never an inventory command.
- `GET /reports/exports` returns the current actor's own receipts with pagination. Receipts are immutable; direct anon/authenticated access and forged server columns are denied.

## Migration and deployment boundary

Local migration `20260916073453_phase_22_reports.sql` adds exactly two permissions, one initially empty receipt table, an index, immutable trigger and access control. No existing business data is rewritten. Readiness requires the new table, so hosted migration must precede application deployment. No hosted migration has been run for Phase 22; do not repeat earlier phase migrations.

Public repository CI uses the unchanged standard GitHub-hosted runner. Expected new external charge: 0 DKK; realistic worst-case: 0 DKK for that existing public CI. No main push or Railway deployment is included in the working-branch action. Main publication would normally trigger Railway: earlier measured planning estimate is expected 0–0.30 DKK, realistic worst-case 1–3 DKK from build/start/container overlap on existing resources. Because that cannot be safely bounded at 1 DKK, stop for separate approval before main publication. No manual deployment, paid service, resource or usage-limit change is authorized.

## Verification checkpoint

Local: both workspace typechecks pass; 12 targeted report API/database tests pass; 2 read-only verifier tests pass; the schema/access suite passes (5 tests). Added browser cases are collected (4 cases × desktop/tablet/mobile = 12). Local Chromium and real PostgreSQL are unavailable; those executions are reserved for the existing CI rather than repeating environment installation attempts.

API coverage includes real migrations/RLS/sessions, exact totals/pagination, historical snapshots/literal wildcard search, reversals, reservation versus physical stock, per-source/export permissions, tenant isolation, immutable personal audit, CSV hash/formula escaping/decimals, strict filters, Danish DST dates, production/waste reversals, consumption on closure only, dispatched shipment source links, HTTP auth and pre-generation export size rejection. Added real PostgreSQL coverage pauses between report count and totals while another transaction posts a journal, then verifies one consistent snapshot. Browser coverage checks source permissions, applied filters, pagination totals, exact source navigation, company reset, CSV generation receipts and stale-action removal after errors.

CI has not yet been claimed passed. Hosted readiness, routes, deployment and authenticated report verification are NOT_RUN. No hosted fixtures or export receipts have been created. Existing earlier-phase tests are not being rerun manually; the normal full CI is the regression gate for the shared schema, readiness and app navigation changes.

## Targeted hosted verification after approval

Verify the deployed implementation commit and SUCCESS status using the Railway connection when available. Check readiness 200 and anonymous report/read/history/export routes 401. Run `node scripts/verify-reports.cjs` with hidden prompts for an authorized operator and an existing foreign-company fixture. It checks real login/session, required permissions, all six report reads, response company/type, decimal/unit shape, company isolation, unknown-report 404, personal export-history scope and session cleanup. Expected final marker: `PHASE_22_READ_ONLY_VERIFICATION: PASS`.

The helper performs no report-export POST: `REPORT_CSV_GENERATION: NOT_RUN (read-only verification; covered by local/CI tests)` is expected. Empty hosted sources cannot establish positive record reconciliation; the real local/CI fixtures provide that coverage. Never send passwords or session tokens in chat. Photos remain disabled hosted. Stop after Phase 22 verification/documentation; do not start Phase 23.

## Publication checkpoint

Implementation is committed locally as `dd1d5950891a9a4eeccbac21ef4a55c39540878f`, tree `28d78a2f07564981d528d96cfc15649476431749`, directly based on main `273716a6a89797fce1cc39427135fcf0dbdea1f5`. The final strict-date validation (including rejection of year zero) was included in the successful 12-report-test run. The 2 verifier tests, 5 schema/access tests and both workspace typechecks also passed. Browser test collection found all 12 new cases; this is not a browser execution result.

GitHub read access confirms main remains `273716a`. Tree-creation calls failed with a serialization error. A subsequent small blob-creation attempt returned an explicit automatic approval review rejection: uploading unpublished local project rules to the public repository was considered external disclosure not covered by the implementation authorization. No workaround was attempted after that rejection. No new working branch or remote implementation commit has been created or verified, and CI has not started.

Remaining permission requested: publish the Phase 22 content from `dd1d595` to a working branch and run the unchanged existing public-repository CI on a standard GitHub runner. Expected new external charge 0 DKK; realistic worst-case 0 DKK for that action. This request does not include main publication, Railway deployment, hosted migration or resource changes. Phase 22 remains implemented locally but is not fully verified or closed. Hosted photos remain disabled; Phase 23 is not started.


## Authorized working-branch CI — 2026-09-16

The user explicitly authorized publication of the Phase 22 content from `dd1d595` to a working branch and the unchanged existing CI on standard GitHub runners, accepting expected and realistic worst-case new external charges of 0 DKK. This resolved the preceding publication approval checkpoint. Main, Railway deployment, hosted migration and resource changes were explicitly excluded.

Published branch: `phase22-reports`. GitHub commit: `b2f947dd759fb6124bc632cd623df2b0ff3bffa5`. The GitHub commit parent is main `273716a6a89797fce1cc39427135fcf0dbdea1f5`; its tree `28d78a2f07564981d528d96cfc15649476431749` exactly matches local implementation `dd1d5950891a9a4eeccbac21ef4a55c39540878f`. No additional local checkpoint documentation was included in that publication.

[CI run 35116957817](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35116957817), job `104864710277`, completed with SUCCESS:

- 263 unit/API/database/helper tests passed across 54 suites.
- 19 real PostgreSQL concurrency tests passed in the separate disposable PostgreSQL job step. The same 19 are deliberately skipped in the earlier general test step without its dedicated database URL; they are not untested.
- 210 browser tests passed across desktop, tablet and mobile, including all 12 new report browser cases.
- Both workspace typechecks and builds, backend runtime image build, diagnostic-script runtime check and strict TLS/CA materialization passed.

The existing CI ran once; no rerun or workflow change was needed. Earlier passed local tests were not repeated. GitHub main was read again after CI and remains `273716a6a89797fce1cc39427135fcf0dbdea1f5`. No hosted migration, Railway deployment, manual deployment, photo setting or resource change was performed. This result and the README/architecture status are documented locally only.

Phase 22 implementation and automated verification are complete. The phase is not yet closed online: its single hosted migration, main publication, normal automatic Railway deployment and targeted online verification remain pending authorization. Main publication still has the previously documented expected Railway increment 0–0.30 DKK / realistic worst-case 1–3 DKK for build, start and temporary container overlap on unchanged resources; stop before it. Supabase remains on the user-confirmed Free plan, but this CI authorization explicitly excludes applying the new migration. Do not repeat any prior migration. Photos remain disabled hosted. Phase 23 is not started.

## Hosted migration and economic checkpoint — 2026-09-16

The user authorized the remaining Phase 22 hosted steps subject to the economic rule. On the existing user-confirmed Supabase Free project `Produktionssystem` (`puwyontrchonoepisgun`), the narrow migration was assessed at expected 0 DKK / realistic worst-case 0 DKK, with no paid feature or resource change. Before applying, targeted reads confirmed no Phase 22 migration entry, no report_exports table and neither report permission.

Applied exactly once through Supabase apply_migration using the exact SQL from CI-verified implementation `dd1d595` / `b2f947d`: local file `20260916073453_phase_22_reports.sql`; hosted history name `phase_22_reports`, version `20260916155717`. Result: success. Do not run it again or replay earlier migrations; the hosted timestamp differs because the migration tool assigns it at application time.

Targeted catalog verification PASS: both permissions exist; receipt count 0; RLS enabled; SELECT and INSERT policies constrain company, actor, reports.read and reports.export; immutable trigger enabled. anon SELECT and authenticated INSERT are denied. Runtime SELECT and allowed-column INSERT are granted; runtime actor/time INSERT and UPDATE/DELETE are denied. No business fixture or export receipt was created. No old local/CI tests were repeated.

Main was verified at `273716a6a89797fce1cc39427135fcf0dbdea1f5`. Publication of implementation `b2f947d` is pending because it normally triggers Railway. Economic stop before that action: expected incremental cost 0–0.30 DKK; realistic worst-case 1–3 DKK, one-time, from normal build/start and temporary old/new container overlap on existing unchanged Railway resources. Actual duration and remaining included usage are not verified here, so the action cannot safely be bounded at 1 DKK. Separate acceptance is required for this main publication and its automatic deployment, followed by targeted online verification. No manual deployment or resource change is proposed.

No main update or Railway deployment was performed. Photos remain disabled hosted and configuration unchanged. Phase 22 is not yet online-verified; Phase 23 is not started. This checkpoint is local documentation only.

## Main publication and automatic Railway deployment — 2026-09-16

The user explicitly accepted the one-time Railway estimate (expected 0–0.30 DKK; realistic worst-case 1–3 DKK) for publishing only CI-verified `b2f947d` to main, its normal automatic deployment and targeted online checks. Main was fast-forwarded without force from `273716a6a89797fce1cc39427135fcf0dbdea1f5` to `b2f947dd759fb6124bc632cd623df2b0ff3bffa5` and read back to verify the exact SHA. Local checkpoint documentation was not published.

Railway connection verified automatic deployment `5b7964eb-d7c7-459a-a8c3-d01422336f87` for main commit `b2f947dd759fb6124bc632cd623df2b0ff3bffa5`, created 2026-09-16 15:59:52 UTC, with SUCCESS at 16:01:56 UTC. Existing project/service/environment only; no manual deployment or configuration change. Railway variable-name inspection confirmed ITEM_PHOTOS_ENABLED remains absent, preserving the application's disabled default. No variable values or secrets were printed.

Targeted online HTTP checks PASS: readiness GET `/api/health/ready` -> 200; all 13 anonymous report routes -> 401 (six GET report types, six POST export routes and GET export history). The probe used non-business UUID `00000000-0000-4000-8000-000000000000`, no credentials and no business payload. No receipt or fixture was created. An additional short readiness diagnostic timed out at the network connection stage; it did not return an application failure and does not replace the successful routed readiness result above.

Authenticated verification remains NOT_RUN: operator login credentials are unavailable in this session. The previously CI-tested `node scripts/verify-reports.cjs` is ready for hidden-input operator execution. Required final marker: `PHASE_22_READ_ONLY_VERIFICATION: PASS`; expected exclusion: `REPORT_CSV_GENERATION: NOT_RUN (read-only verification; covered by local/CI tests)`. It checks login/session, all six report reads, response scope, decimal/unit shape, foreign-company denial, unknown-report behavior, personal export history and session cleanup. Do not send credentials or tokens in chat. Phase 22 is deployed but not yet fully online-verified or closed.

The already-applied Phase 22 migration was not run again. No previous tests, other migrations, resource changes or manual deployments were performed. This checkpoint is local documentation only. Photos remain disabled hosted; Phase 23 is not started.


## Final operator verification and closure — 2026-09-17

The user confirmed the final authenticated online result:

```text
PHASE_22_READ_ONLY_VERIFICATION: PASS
REPORT_CSV_GENERATION: NOT_RUN (read-only verification; covered by local/CI tests)
```

According to the operator result, login and session, report permissions, stock report, inventory report, production report, consumption report, waste report, shipments report, response scope, decimal/unit shape, company isolation, report not-found behavior, export history and session cleanup all passed. This completes the outstanding authenticated verification following the previously verified main/Railway implementation `b2f947dd759fb6124bc632cd623df2b0ff3bffa5`, SUCCESS deployment `5b7964eb-d7c7-459a-a8c3-d01422336f87`, readiness 200 and all 13 anonymous report routes returning 401.

The expected CSV NOT_RUN result is not a failure: the hosted helper deliberately performs no export generation or receipt writes. Those behaviors retain the already-passed local/CI coverage. The online result does not establish positive-record reconciliation for empty sources or claim that every source record was checked. Prior CI remains valid: 263 unit/API/database/helper tests, 19 real PostgreSQL concurrency tests and 210 browser tests, plus typechecks, builds, runtime and TLS checks.

Phase 22 is closed within this documented scope. Hosted migration `20260916155717_phase_22_reports` was already applied once and verified; it was not repeated. Only README.md, docs/architecture.md and docs/phase-22.md were updated locally for closure. No tests, hosted requests, migrations, deployments, main publication or resource changes were performed for this documentation task. Local documentation incurs no new external service charge. Photos remain disabled hosted. Phase 23 is not started.
