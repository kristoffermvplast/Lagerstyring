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
