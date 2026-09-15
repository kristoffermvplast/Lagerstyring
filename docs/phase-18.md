# Phase 18 — shipments

Baseline: main `ce54395`. Phase 17 results are retained; Phase 19 is not started. Hosted photos remain disabled.

## Current status

**Phase 18 is complete.** Operator-reported `PHASE_18_READ_ONLY_VERIFICATION: PASS` completes online sign-off. Expected existing-shipment NOT_RUN and the precise coverage limits are recorded in the final sign-off below. Earlier pending/404 notes are chronological evidence, superseded by the final sign-off.

## Implemented scope

- Company-scoped shipment list/detail, customer/date/status/search filters, draft creation/editing and confirmed transitions: draft → planned → reserved → ready → dispatched. Nonterminal documents may be cancelled; terminal documents are immutable.
- Each line specifies item, owner, location, exact quantity and optionally a whole handling unit or published packing revision. A partially filled pallet is shipped with its entire actual content. Splitting an identified pallet is not implemented; partial reservations from Phase 17 cannot be attached as whole-pallet shipments.
- Reserving creates dedicated Phase 17 reservations atomically for all shipment lines. Existing unrelated reservations remain untouched and protected. Shipment-linked reservations cannot be separately released. Cancellation releases only this shipment's reservations; neither operation changes physical stock.
- Dispatch releases reservations, marks shipped handling units inactive and creates one grouped immutable `shipment` inventory entry in the same transaction. Existing ownership, nonnegative balances and protection of other reservations/handling units remain authoritative. Generic inventory reversal cannot reverse a shipment.
- Shipments snapshot customer/address, item/unit, owner/location, handling-unit code, production-order reference and packing revisions. Event records retain every command and its resulting document. Draft editing uses optimistic versions; command UUIDs provide exact idempotency across lost responses and concurrent requests. SERIALIZABLE retries are bounded.
- Packing uses the existing fixed-point calculator and historical revisions: per-component containers/accessories, full/partial counts and remainder. Whole handling-unit count uses actual units. Missing packing is reported as unknown, never an invented zero. Pallet-space totals sum explicit per-line values; absent values remain unknown because pallet types currently have no authoritative footprint conversion. Packaging is not consumed again.
- React provides a simple list, multiline draft form, packing/detail/history and explicit dispatch/cancellation confirmation. Uncertain retries preserve payload and key. All business data passes through NestJS.

## Database and access

Migration: `20260915094853_phase_18_shipments.sql` (applied once hosted as `20260915113708_phase_18_shipments`; identical SQL, MCP-assigned timestamp).

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

Implementation and automated CI verification are complete. Working-branch publication is verified; hosted migration is verified, main publication is verified, while deployment identity and online sign-off remain pending. No hosted fixtures or business writes were made. Phase 18 is not yet signed off online.

Verification on 2026-09-15:

- TypeScript checks and API/frontend production builds: PASS.
- Full local unit/API/database/helper run: 213 passed, two failures subsequently corrected, 13 real-PostgreSQL tests skipped because no local PostgreSQL server is installed. The failures were a table-count expectation (37 → 40) and an imprecise test query that omitted the location filter; neither required relaxing business rules.
- Final targeted run after fixes and added coverage: **25 PASS** across shipments API, finished-goods API, database and safe online helper. Includes two additional shipment tests added after the full run. Unchanged earlier suites were not repeated.
- Three new browser tests (desktop/tablet/mobile projects) cover read-only access, company switch, draft retries and confirmed dispatch retries. **NOT_RUN locally**: Chromium is absent and its download timed out. Download was stopped; no hosted workaround was used.
- One additional real PostgreSQL concurrency scenario covers duplicate dispatch and dispatch vs cancellation. **NOT_RUN locally**; the existing CI is configured to run all 13 concurrency cases against its disposable local database.
- Security review: explicit RLS/grants, company-qualified FKs, actor/session checks, no browser writes, protected private functions and append-only history were reviewed and exercised by local tests. Hosted advisors and migration boundaries are now verified below.

An initial GitHub upload was blocked by automatic approval review. The user subsequently explicitly approved publication of local `f171a5f` to `phase18-shipments` and its existing standard CI only. Published commit: `afbd7c06ad88f0a1b7d44e205146c0de89483ac9`; its full Git tree `ecaf0217d659180335bee541f98e60bc06f6c28f` is identical to local `f171a5f`. Main was checked and remains `ce54395b711af40e4ce8ecb7139350a451c9c58f`. No Railway deployment or hosted migration was triggered. CI run [34961142635](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34961142635) completed successfully on commit `afbd7c06ad88f0a1b7d44e205146c0de89483ac9`.

Targeted coverage includes exact decimal reservations, rollback of all lines on failure, single dispatch/retry, cancellation without debit, whole-pallet plus loose stock aggregation, historical packing, stale edits, forged journal rejection, read-only roles, foreign-company denial and immutable audit.

The online helper `scripts/verify-shipments.cjs` uses hidden local credential input, allowlisted diagnostic output and business GET requests only. It checks login, session, permissions, list/detail scope, foreign-company denial and unknown IDs; logs out its Supabase session afterwards. An absent existing shipment produces expected `SHIPMENT_EXISTING_RECORD: NOT_RUN`; no fixture is created.

## Final automated CI result

Existing GitHub Actions run [34961142635](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34961142635), job `104354758362`: **SUCCESS** on the approved implementation tree.

- TypeScript checks, API/frontend production builds: PASS.
- Unit/API/database/helper tests: **217 PASS**. The ordinary job skips the 13 concurrency cases, then runs them separately against real PostgreSQL.
- Disposable PostgreSQL concurrency tests: **13 PASS**, including duplicate dispatch and dispatch vs cancellation.
- Browser tests: **174 PASS** across desktop/tablet/mobile, including the three new shipment scenarios on each profile. The earlier local Chromium limitation is resolved by this CI evidence; no local tests were repeated.
- Backend runtime Docker image build: PASS.
- Runtime diagnostic script presence and safe missing-secret output: PASS.
- Non-root CA materialization and strict TLS configuration: PASS.

The approved working-branch publication and standard CI completed first. The subsequent user request authorized remaining hosted steps within the economic limit; the existing Free-project migration was applied once at 0 DKK. Main/Railway, resource limits and photo configuration remain unchanged. This follow-up evidence is stored locally and is not an additional authorized push. Phase 18 still awaits Railway activation confirmation and authenticated online verification; Phase 19 is not started.

## Boundaries and remaining work

- No pallet-debt accounting (Phase 19), transport-carrier integration, customer-return automation, partial dispatch of one shipment, or identified-pallet splitting. Separate shipments support separate departures.
- No new packaging consumption; goods are assumed packed through the existing production/packing flow. Packing totals describe transport contents.
- No push to main or automatic Railway deployment until its incremental cost is bounded under the user rule or explicitly approved. Existing public-repository standard CI on the working branch is free; no resources or limits change. Source: https://docs.github.com/en/billing/concepts/product-billing/github-actions . The working-branch publication and CI were subsequently explicitly approved and performed; that approval does not cover main or hosted resources.

Remaining hosted actions (not authorized in the working-branch approval): the single Phase 18 hosted migration on the existing Free project (estimated 0 DKK, subject to verifying the unchanged plan); main publication and normal Railway deployment need explicit cost approval. Based on the existing deployment flow: expected 0–0.30 DKK, realistic worst case 1–3 DKK, one-off build/redeployment overlap on unchanged resources. The exact Railway duration, incremental CPU/RAM time and included usage are not observable here, so a ≤1 DKK upper bound cannot be assured. No resource upgrades, extra services, manual deployments or unrelated migrations are proposed.


## Hosted migration — 2026-09-15

Organization plan was read and confirmed `free`. Migration history showed no Phase 18 entry, then the exact tested SQL was applied once. Hosted version: `20260915113708_phase_18_shipments`; local filename: `20260915094853_phase_18_shipments.sql`. Do not reapply because these timestamps differ.

Read-only post-migration verification: all three new tables have RLS enabled; anon/authenticated SELECT is denied; runtime UPDATE/DELETE is denied; required column-level command INSERT is allowed; direct runtime pallet shipment-field UPDATE and private command-function EXECUTE are denied. Shipment count remains zero; no fixture was created.

Security advisors report no new finding. The prior intentional default-deny `app_private.location_tree_locks` INFO and disabled leaked-password-protection WARN remain unchanged:
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Main publication of tested commit `afbd7c06ad88f0a1b7d44e205146c0de89483ac9` is stopped before the action under the economic rule. Expected incremental Railway consumption: 0–0.30 DKK; realistic worst case: 1–3 DKK, one-off. Basis: the previously assessed normal deployment on unchanged resources, including startup/old-new container overlap; actual duration and remaining included usage are not visible. GitHub standard public-repository CI remains 0 DKK. No new monthly resource commitment is proposed. Explicit approval is required because the ≤1 DKK limit cannot be assured.


## Approved main publication — 2026-09-15

The user explicitly approved the exact `afbd7c0` main push with the normal automatic Railway flow on unchanged resources, accepting the recorded one-off cost range. Main was fast-forwarded without force and its remote reference verified as `afbd7c06ad88f0a1b7d44e205146c0de89483ac9`. No further migration, manual deployment or resource change was performed. Later local documentation commits were not included in this exact-SHA approval or pushed.

Initial targeted public verification after publication:

- `GET /api/health/live`: **200**.
- `GET /api/health/ready`: **200**.
- All nine shipment route checks: **404**, not yet the expected **401**: list/detail GET and create/edit/plan/reserve/ready/dispatch/cancel POST with no credentials and empty command bodies. No business mutation occurred.

The public service therefore had not yet demonstrated the new shipment routes. Railway tools are unavailable in this conversation; actual active Railway commit cannot be independently confirmed. Do not infer a migration problem from these route 404s, rerun migrations or manually redeploy. Operator confirmation of the active deployment SHA is required; then repeat only the failed route checks.

Authenticated read-only verification remains NOT_RUN because operator credentials are not shared. After activation, the operator can run the existing `scripts/verify-shipments.cjs` locally with hidden inputs. It performs no business mutations and creates no fixtures. Record its exact PASS/NOT_RUN result before closing Phase 18. Hosted photos remain disabled; Phase 19 is not started.


## Railway activation and anonymous routes — 2026-09-15

Operator confirmed active Railway commit `afbd7c06ad88f0a1b7d44e205146c0de89483ac9`. Repeated only the nine previously failing shipment-route checks: list/detail GET and create/edit/plan/reserve/ready/dispatch/cancel POST all return **401 PASS** without authentication. Empty unauthenticated requests caused no business mutations. Earlier health, local and CI checks were not repeated.

Remaining step: operator executes `scripts/verify-shipments.cjs` on their Mac with hidden publishable-key/email/password input, company `MV Plast` and the existing approved isolation company. Credentials must not be shared. Expected success marker is `PHASE_18_READ_ONLY_VERIFICATION: PASS`; absent shipment detail is explicitly `SHIPMENT_EXISTING_RECORD: NOT_RUN (no existing shipment; no fixture created)`. Authenticated result is pending, so Phase 18 is not yet closed. No push, migration, deployment or resource changes occurred during these route checks; hosted photos remain disabled; Phase 19 is not started.


## Final online sign-off — 2026-09-15

Operator reported:

`PHASE_18_READ_ONLY_VERIFICATION: PASS`

Login, session, permissions, shipment reads, response scope, not-found behavior and company isolation passed. The earlier nine anonymous route checks passed with HTTP 401 on operator-confirmed Railway commit `afbd7c06ad88f0a1b7d44e205146c0de89483ac9`.

Expected:

`SHIPMENT_EXISTING_RECORD: NOT_RUN (no existing shipment; no fixture created)`

No existing hosted shipment was available; no fixture was created. Positive hosted detail/history/packing reads and hosted business writes were therefore not exercised by this read-only verification. Their coverage remains the previously recorded automated tests (217 unit/API/database/helper, 13 real PostgreSQL concurrency and 174 browser tests).

Phase 18 is closed within this explicitly documented verification scope. This closing task changed only README.md, docs/architecture.md and docs/phase-18.md. No tests were rerun, no code changed, and no push, migration, deployment or resource change was performed. Hosted photos remain disabled. Phase 19 is not started.
