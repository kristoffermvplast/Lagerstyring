# Phase 18 — shipments

Baseline: main `ce54395`. Phase 17 results are retained; Phase 19 is not started. Hosted photos remain disabled.

## Implemented scope

- Company-scoped shipment list/detail, customer/date/status/search filters, draft creation/editing and confirmed transitions: draft → planned → reserved → ready → dispatched. Nonterminal documents may be cancelled; terminal documents are immutable.
- Each line specifies item, owner, location, exact quantity and optionally a whole handling unit or published packing revision. A partially filled pallet is shipped with its entire actual content. Splitting an identified pallet is not implemented; partial reservations from Phase 17 cannot be attached as whole-pallet shipments.
- Reserving creates dedicated Phase 17 reservations atomically for all shipment lines. Existing unrelated reservations remain untouched and protected. Shipment-linked reservations cannot be separately released. Cancellation releases only this shipment's reservations; neither operation changes physical stock.
- Dispatch releases reservations, marks shipped handling units inactive and creates one grouped immutable `shipment` inventory entry in the same transaction. Existing ownership, nonnegative balances and protection of other reservations/handling units remain authoritative. Generic inventory reversal cannot reverse a shipment.
- Shipments snapshot customer/address, item/unit, owner/location, handling-unit code, production-order reference and packing revisions. Event records retain every command and its resulting document. Draft editing uses optimistic versions; command UUIDs provide exact idempotency across lost responses and concurrent requests. SERIALIZABLE retries are bounded.
- Packing uses the existing fixed-point calculator and historical revisions: per-component containers/accessories, full/partial counts and remainder. Whole handling-unit count uses actual units. Missing packing is reported as unknown, never an invented zero. Pallet-space totals sum explicit per-line values; absent values remain unknown because pallet types currently have no authoritative footprint conversion. Packaging is not consumed again.
- React provides a simple list, multiline draft form, packing/detail/history and explicit dispatch/cancellation confirmation. Uncertain retries preserve payload and key. All business data passes through NestJS.

## Database and access

Migration: `20260915094853_phase_18_shipments.sql` (local only; not applied hosted).

Handling units also retain company-qualified `shipment_id` and `shipped_at` so shipped pallets are distinguishable from reversed deliveries.

Three tables: `app.shipments` (protected projection), `app.shipment_events` (immutable commands/audit), `app.shipment_reservations` (company-qualified immutable links). Composite FKs prevent cross-company references. All have RLS and no browser-role grants. Runtime has SELECT and only column-limited INSERT on shipment events; no direct projection/history updates or private-function execution.

Permissions: `shipments.read`, `shipments.manage`, `shipments.dispatch`. Draft writes also need `masterdata.read` + `inventory.read`; reserve/dispatch and cancellation of reserved stock additionally require `inventory.reserve` + `inventory.read`. Selecting a handling unit also requires `production.read`, preserving the existing pallet access contract. Administrator roles resolve the permission catalog without per-customer hardcoding.

A private company/session/permission-checked trigger performs document commands. The inventory preparation function preserves all earlier branches and adds only the document-backed shipment kind. Existing physical balance writer is reused. There is no schema exposure, privileged frontend credential, new external service or paid dependency.

The Phase 17 local migration filename maps to hosted `20260915084006_phase_17_reservations`; this known mapping must be honored when applying Phase 18. Do not replay Phase 17 because of different timestamps.

## API

Under `/api/companies/:companyId/shipments`:

- `GET /`, `GET /:id`
- `POST /` (create), `POST /:id/edit`
- `POST /:id/plan`, `/reserve`, `/ready`, `/dispatch`, `/cancel`

Writes require `idempotency_key`, `version`, `reason`. Create/edit also require `data` with code, customer, ship_date and lines. Shipments with unavailable stock may be planned but cannot be reserved. Editing is draft-only; cancel/recreate if the reserved plan must change. A shipped document cannot be cancelled to restore stock; a future customer-return workflow is separate.

## Verification status

Implementation is complete locally; hosted migration, publication and online sign-off have NOT run. No hosted fixtures or business writes were made. Phase 18 is not yet signed off online.

Verification on 2026-09-15:

- TypeScript checks and API/frontend production builds: PASS.
- Full local unit/API/database/helper run: 213 passed, two failures subsequently corrected, 13 real-PostgreSQL tests skipped because no local PostgreSQL server is installed. The failures were a table-count expectation (37 → 40) and an imprecise test query that omitted the location filter; neither required relaxing business rules.
- Final targeted run after fixes and added coverage: **25 PASS** across shipments API, finished-goods API, database and safe online helper. Includes two additional shipment tests added after the full run. Unchanged earlier suites were not repeated.
- Three new browser tests (desktop/tablet/mobile projects) cover read-only access, company switch, draft retries and confirmed dispatch retries. **NOT_RUN locally**: Chromium is absent and its download timed out. Download was stopped; no hosted workaround was used.
- One additional real PostgreSQL concurrency scenario covers duplicate dispatch and dispatch vs cancellation. **NOT_RUN locally**; the existing CI is configured to run all 13 concurrency cases against its disposable local database.
- Security review: explicit RLS/grants, company-qualified FKs, actor/session checks, no browser writes, protected private functions and append-only history were reviewed and exercised by local tests. Hosted advisors and migration verification are pending; no hosted security change is claimed.

GitHub automatic approval review rejected creation of the working-branch Git tree because external publication of Phase 18 requires explicit approval. No tree, commit or branch was published. The standard public-repository CI has not run for this phase. Main remains `ce54395`; no Railway deployment was triggered.

Targeted coverage includes exact decimal reservations, rollback of all lines on failure, single dispatch/retry, cancellation without debit, whole-pallet plus loose stock aggregation, historical packing, stale edits, forged journal rejection, read-only roles, foreign-company denial and immutable audit.

The online helper `scripts/verify-shipments.cjs` uses hidden local credential input, allowlisted diagnostic output and business GET requests only. It checks login, session, permissions, list/detail scope, foreign-company denial and unknown IDs; logs out its Supabase session afterwards. An absent existing shipment produces expected `SHIPMENT_EXISTING_RECORD: NOT_RUN`; no fixture is created.

## Boundaries and remaining work

- No pallet-debt accounting (Phase 19), transport-carrier integration, customer-return automation, partial dispatch of one shipment, or identified-pallet splitting. Separate shipments support separate departures.
- No new packaging consumption; goods are assumed packed through the existing production/packing flow. Packing totals describe transport contents.
- No push to main or automatic Railway deployment until its incremental cost is bounded under the user rule or explicitly approved. Existing public-repository standard CI on the working branch is free; no resources or limits change. Source: https://docs.github.com/en/billing/concepts/product-billing/github-actions . Publication nevertheless requires approval following the automatic review rejection.

Requested next actions: publish this exact implementation to `phase18-shipments` and run normal existing CI (expected incremental cost 0 DKK); then the single Phase 18 hosted migration on the existing Free project (estimated 0 DKK, subject to verifying the unchanged plan); main publication and normal Railway deployment need explicit cost approval. Based on the existing deployment flow: expected 0–0.30 DKK, realistic worst case 1–3 DKK, one-off build/redeployment overlap on unchanged resources. The exact Railway duration, incremental CPU/RAM time and included usage are not observable here, so a ≤1 DKK upper bound cannot be assured. No resource upgrades, extra services, manual deployments or unrelated migrations are proposed.
