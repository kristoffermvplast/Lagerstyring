# Phase 24 — Import/export

**Final status: Phase 24 completed on 2026-09-22 within the documented read-only hosted verification scope.** Operator-reported `PHASE_24_READ_ONLY_VERIFICATION: PASS`; see final acceptance below. Earlier pending/stop notes record historical checkpoints.

## Scope and implementation

Continued from remote main `888bc2f99e8a6a36a104bc842e53ba545580917f` and local preparation `c9628d2`, on `phase24-import-export`. Phase 23's unpublished code commits are not included.

The requested five import types are implemented in NestJS and the Import workspace:

| Type | Required CSV columns | Optional CSV columns |
| --- | --- | --- |
| Customers | `code`, `name` | `address`, `contact_name`, `phone`, `email`, `notes` |
| Suppliers | `code`, `name` | contact columns above, `lead_time_days` |
| Products | `code`, `name` | `unit_code`, `customer_code`, `description`, `notes`, `color` |
| Materials | `code`, `name` | `unit_code`, `supplier_code`, `description`, `notes`, `color` |
| Opening stock | `item_code`, `owner_code`, `location_code`, `quantity` | none |

Optional `supplier_code` on a material import identifies the existing supplier; it is not the supplier's article number. Reference codes are resolved within the selected company. Existing units, owners and storage locations are prerequisites for opening stock. Products/materials can be created without a unit, but cannot receive opening stock until they have an active unit.

Order: customers/suppliers → products/materials → opening stock. Use the downloadable minimal template. Optional columns are described under a collapsed section. Upload, inspect the preview and row errors, then explicitly confirm. Invalid files cannot be confirmed. Nothing is silently skipped or overwritten. Replacing the file or company clears the preview. An uncertain confirmation can be retried against the same job ID.

## Deliberate format and size limits

- CSV UTF-8 (optional BOM), comma or semicolon delimiter; quoted separators, quotes and multiline cells supported. Header names are exact and closed; malformed columns/files are rejected.
- Excel is supported by **Save as CSV UTF-8**. Native `.xlsx`/`.xls` parsing is **not implemented**; no spreadsheet parser or paid service was added. Formula cells are never evaluated by the importer.
- At most 100 data records and 32 KiB CSV per file. Decimal quantities remain strings, with a dot and at most eight decimal places; count/package units require integers. Zero and negative opening quantities are rejected.
- This phase does not expand the supported masterdata fields to every advanced edit-screen option. Those can still be changed through existing authorized screens.
- Phase 22's existing bounded, audited report CSV exports remain the export workflow. No new external export/storage service.

## Correctness, security and traceability

- Existing masterdata schemas validate imported contacts/items. Business writes go only through NestJS and `DatabaseService.asActor` with its existing active-session, RLS and SERIALIZABLE transaction boundaries.
- Masterdata imports require `masterdata.read` + `masterdata.manage`. Opening stock additionally uses `inventory.read` + `inventory.adjust` instead of masterdata manage. No new permission codes.
- Valid preview creates an immutable import job, not business data. It stores the bounded source rows and validated/resolved values, filename, actor, time and SHA-256 of canonical kind/rows. The fingerprint describes normalized import content, not original file bytes. No raw binary uploads, Storage bucket or background worker is necessary for these bounded synchronous jobs.
- Confirmation is restricted to the preview's actor/company/type and expires after 24 hours. It revalidates all rows, rejects changed reference targets and saves all rows and the receipt in one transaction. A receipt failure rolls back business writes.
- Codes are checked case-insensitively within the file and company, including inactive records and shared product/material codes. Existing database unique indexes protect racing masterdata writes. An immutable unique receipt by company/type/content protects retries and equivalent files. Reordered CSV columns produce the same fingerprint. Concurrent conflicts require retry or a fresh preview; no automatic partial import.
- Opening stock inserts one ordinary inventory correction request through the **existing journal kernel**, which owns line/balance changes, snapshots and locks. The journal reference points to the import job. No direct writes to `stock_balances` or `inventory_lines` are added. Existing history for the item/owner/location blocks opening stock, even if its current balance is zero. New files are not an escape from that rule.
- Jobs and receipts have RLS, company foreign keys, column-specific inserts and immutable triggers. Browser roles receive no privileges. History exposes the latest 20 receipts for the authorized company/type, including actor/time, source fingerprint and row-to-created-record/journal IDs. Existing masterdata audit remains intact.
- Preview jobs are retained as audit material; expiry prevents late confirmation, not automatic deletion. No cleanup service or permanent resource increase is created.

## Migration and publication boundary

New local migration: `20260921172039_phase_24_imports.sql`, created with the installed Supabase CLI. It adds two empty tables, indexes, RLS, grants and immutable triggers. No existing business data is migrated and no old migration is rerun. Readiness now requires the two import tables.

At the CI checkpoint, hosted migration, main publication and Railway deployment were **NOT_RUN**; see the hosted update below for the subsequently completed migration. Hosted photos remain disabled. No hosted fixture or resource change was performed. A hosted rollout must apply this phase's migration once before the new readiness check can pass.

## Verification

- TypeScript checks and API/frontend builds: PASS locally.
- Targeted import/API/database tests: **18 PASS** locally (13 import/parser/API cases and 5 migration/database cases). Browser test discovery: 9 cases found; execution still requires CI.
- Browser cases added for preview-before-write, row-error blocking, replacing files, company reset, permissions and retrying the same confirmation after a lost response. Nine cases across the existing desktop/tablet/mobile projects.
- Two real PostgreSQL concurrency cases added to the existing CI suite: same-job confirmations and distinct opening jobs racing for the same stock key.
- Local browser execution is blocked: Chromium download timed out/returned HTTP 502. No local standard PostgreSQL server is installed, so the real concurrency cases require CI. These are not represented as local passes.
- Existing CI is unchanged, on standard `ubuntu-latest`. Repository visibility was read back as public. Expected and realistic worst-case incremental external charge for this work-branch CI: **0 DKK**, based on [GitHub's standard-runner public-repository rule](https://docs.github.com/en/billing/concepts/product-billing/github-actions). No new artifact upload or cache configuration was introduced.
- Work branch `phase24-import-export` published via the GitHub connection as `1924faa556e937c3e34b42fe3f0b20d37a58b10d`. All 17 changed blobs and the entire tree (`8d94a13af073f60784242f4f359f52d0b3e43e4f`) were verified identical to authorized local commit `72bba3a1ec9bd52be39c59c069ac62b35220bfec`. Direct Git push lacked authentication; no credentials or configuration were changed.
- Existing CI run [35641554060](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35641554060) started on that exact remote commit. Result: 286 unit/API/database tests PASS, 21 real PostgreSQL concurrency tests PASS, 230/231 browser tests PASS. One new mobile test failed because its generic status locator matched both the processing and successful-import messages during history refresh. Container/runtime/TLS steps were skipped after that failure.
- Targeted test-only correction published as `9437c792b9edf1fe4c985b636c3012c84df833bb`: the assertion selects the successful-import status explicitly; application code is unchanged. Existing CI rerun follows this commit, with the same approved 0 DKK expected/worst-case cost. Final run [35642269968](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35642269968), job `106474185138`: **SUCCESS** on `9437c792b9edf1fe4c985b636c3012c84df833bb`. **286 unit/API/database tests, 21 real PostgreSQL concurrency tests and 231 browser tests PASS**, plus TypeScript/build, backend runtime image, diagnostic-script and strict TLS/CA runtime checks. The 21 tests skipped in the ordinary Vitest step are the same 21 executed successfully in the separate PostgreSQL step; no concurrency coverage is being claimed from skipped tests.
- Final remote branch and tree read back: `phase24-import-export` → `9437c792b9edf1fe4c985b636c3012c84df833bb`, tree `dfa532154435099b4e001cbdb75623ce3ead7028`, identical to local test-fix commit `bebd1d1`. The initial application content remains that of `72bba3a`; only the browser assertion changed.
- Phase 24 implementation and CI verification are complete within the work-branch scope. Hosted migration, main publication, Railway deployment and online verification remain NOT_RUN and outside this approval. CI documentation is committed locally; no documentation-only push is needed to prove the tested code.
- `main` independently read back at `888bc2f99e8a6a36a104bc842e53ba545580917f`; no main, Railway or hosted migration action was performed. No Phase 24 completion/hosted sign-off is claimed yet.

## Preserved boundaries

Phase 23 access-500 remains `NOT_REPRODUCED`; do not investigate without a concrete `ACCESS_FAILURE:`. Physical tablet remains `NOT_RUN`, and the previous physical QR verification remains reused.

Deferred final UI/UX requirements remain: fewer mandatory fields, essential fields visible by default, secondary/advanced fields hidden or optional where safe, simpler creation flows and navigation, lower information density. No broad redesign in this phase.

Phase 25 is not authorized and has not started.


## Hosted migration and economic stop — 2026-09-21

User authorized the remaining Phase 24 hosted steps subject to the 1 DKK rule. The existing Supabase project `Produktionssystem` (`puwyontrchonoepisgun`) is on the user-confirmed Free plan. The migration creates only two empty tables, associated indexes/policies/grants/triggers on that existing database; expected and realistic worst-case new external charge **0 DKK**. No plan, compute, storage add-on, project, branch or worker was created.

Preflight confirmed no Phase 24 migration registration and neither import table present. Applied the CI-verified `20260921172039_phase_24_imports.sql` exactly once through Supabase. Hosted registration: **`20260921191204_phase_24_imports`** (the connector assigns the hosted version). **Do not rerun it under the local timestamp.**

Post-migration read-only verification PASS: both tables exist and are empty, owned by `app_owner`, RLS enabled, all four company/permission policies present, actor binding on insertion, immutable update/delete triggers present. Browser roles have no SELECT privilege, and runtime has no UPDATE/DELETE privilege. No production business records or test fixtures were written.

Railway connector confirms the existing GitHub repository, source branch `main`, existing Dockerfile and one replica. Variable names contain no `ITEM_PHOTOS_ENABLED` override, so the unchanged default remains disabled. Source config's stored commit field was not treated as an active deployment verification.

**STOP before main publication:** normal automatic Railway build/start/old-new container overlap is estimated at **0–0.30 DKK expected**, **1–3 DKK realistic worst case**, one-time, on unchanged existing resources. This carries forward the previously documented deployment estimate. Actual build duration, overlap/resource use and remaining included Railway usage are not known well enough to guarantee at most 1 DKK. Service causing the possible charge: Railway. Separate acceptance is required under the user's rule. No main update, deployment, manual trigger or resource/limit change performed. Online verification awaits deployment of `9437c79`.

Sources: [Supabase Free plan](https://supabase.com/pricing), [Railway pricing](https://docs.railway.com/pricing/plans). The estimates are not a provider quote or a guarantee. Existing local/CI tests were not rerun. Phase 25 has not started.


## Authorized main publication and online checks — 2026-09-21

User explicitly approved publication of `9437c79` to main, its normal automatic Railway deployment on unchanged resources and targeted online verification, accepting expected 0–0.30 DKK / realistic worst-case 1–3 DKK one-time. No additional migrations or manual deployments were authorized.

GitHub main was fast-forwarded without force and read back as **`9437c792b9edf1fe4c985b636c3012c84df833bb`**. Local documentation commits were not included. Railway connection independently confirms automatic deployment **`ccff3508-6c39-451c-b5eb-7c0df56be0bf`**, branch main, exact same commit, **SUCCESS** (`2026-09-21T19:16:38.223Z`). No service configuration, resource, variable or limit change was made. Migration was not rerun. Photos remain disabled with the previously verified absent override/default false.

Targeted public online checks against the existing Railway origin:
- `/api/health/live`: 200.
- `/api/health/ready`: 200 on targeted repeat after the first request timed out; do not interpret the initial timeout as a database/migration failure.
- GET template and history for all five import types: 401 without authentication (10 requests).
- POST customer preview and confirmation with empty bodies and no authentication: 401 (2 requests); no job or business write occurred.

**At this checkpoint authenticated verification was PENDING; it subsequently passed by operator confirmation below.** This session has no operator login credentials. `scripts/verify-imports.cjs` is prepared for local interactive execution on the user's Mac: hidden publishable key/email/password/company/isolation-ID input, actual login/session, four required permissions, all five minimal template shapes and history scopes, foreign-company denial, unknown-route 404, and provider session cleanup. No API POSTs or import fixture writes; login/logout are the only non-GET requests. The expected exclusion is `IMPORT_PREVIEW_AND_CONFIRM: NOT_RUN (read-only verification; job creation and business writes covered by CI)`.

Two new targeted local verifier tests PASS: success path with only API GETs/no secret output, and wrong-company failure with session cleanup. Syntax check PASS. Existing application/CI suites were not rerun. The script/tests/documentation are local follow-up files only and are not deployed. The operator subsequently supplied `PHASE_24_READ_ONLY_VERIFICATION: PASS`, recorded below. Phase 25 remains unstarted.


## Final operator acceptance and closure — 2026-09-22

The user reports successful execution of the authenticated verifier:

`PHASE_24_READ_ONLY_VERIFICATION: PASS`

Passed: real login and session, import permissions, templates for customers/suppliers/products/materials/opening stock, import history, response scope and shape, company isolation, not-found behavior and session cleanup. This is operator-reported evidence; it was not rerun by the assistant.

Expected exclusion, preserved verbatim:

`IMPORT_PREVIEW_AND_CONFIRM: NOT_RUN (read-only verification; job creation and business writes covered by CI)`

No hosted import job or business-write test is claimed. Existing CI provides write-path, validation, duplicate/idempotency, atomicity and concurrency coverage. Native XLSX parsing remains outside the delivered scope; Excel data is saved as CSV UTF-8. The existing 100-row/32-KiB limits remain in force.

Together with the recorded one-time hosted migration, verified main/automatic Railway deployment of `9437c79`, public endpoint checks and passing CI, this closes Phase 24 within the stated scope. No migration, test, deployment or resource change was performed for this final documentation step. Only README.md, docs/architecture.md and this phase report were updated and committed locally; no push was performed. Expected new external cost: 0 DKK. Photos remain disabled hosted. Deferred final UI/UX simplification requirements remain intact. Phase 25 has not started; work stops here.
