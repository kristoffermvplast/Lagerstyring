# Phase 13 — Material return and production closure

Status: Phase 13 is complete with operator-reported `PHASE_13_READ_ONLY_VERIFICATION: PASS` on confirmed Railway commit `16c5fc5bb28e38cb83c1933974f01bb954016479`. The expected existing-order NOT_RUN remains a coverage limitation, not a passed check. Phase 14 has not started. Hosted photos remain disabled. Earlier checkpoints below preserve the release history; the final sign-off supersedes their pending statuses.

## Behavior and phase boundary

Return is a balanced inventory transfer, attributed to an original unreversed issue on the same order. Item, owner and source production location come from that issue, not user input or the machine's current location. Partial returns cannot exceed the outstanding issue. Multiple orders at the same machine keep separate attribution. Returns do not consume material. A mistaken return can use the existing reasoned inventory reversal while the order is open; reverse returns before reversing their original issue. Existing reversal permissions are still required.

The order follows in_production → reconciliation → completed. Reconciliation pauses new production registrations and material issues but permits material return; it can return to in_production to correct registrations before finalization. An open problem blocks final closure. Completed orders, their registrations, issues and returns cannot be edited or reversed through these workflows. History is never rewritten.

The guided UI shows registered good quantities and material issued/returned/net by issue, owner and location. The user returns **all unused material and unused packaging** before confirming that the remaining amounts were used, enters rejected-unit quantity and a reason/comment, then explicitly confirms the stock consequence. Closure captures the reviewed quantities and order/BOM/packing snapshots. Good production is not registered again. Under/overproduction and zero good output are allowed and preserved; rejected units require whole quantities for count products. Rejected units are not automatically converted to measured physical waste.

**Necessary closure infrastructure:** net issued minus returned quantities are posted once as `production_consumption` through the existing stock writer. Without this step, already-used material would remain physical stock after completion. It is an explicit confirmed actual net consumption, not theoretical BOM backflush or automatic physical waste. No separate consumption through both BOM and packing occurs: closure consumes the actual issued inventory dimensions once. Phase 14 adds difference/waste analysis based on this preserved evidence and must not post this consumption again.

Unused material retained near a machine must first be returned to a distinct valid storage location. There is no unmeasured residual or automatic cross-order transfer in this phase. If actual stock is insufficient for the reviewed consumption, the entire close operation rolls back; investigate and use the existing reasoned correction workflow. At most 100 distinct item/owner/location consumption dimensions are accepted per close; exceeding this fails explicitly without partial posting.

No finished-goods inventory or pallets are created. Those remain separate delivery events for Phase 15, including delivery during active production. The existing order packing proposal is visible, but actual packing/delivery capture is deferred with that workflow. No Phase 14 waste analysis, new background services or dependencies.

## Database, security and concurrency

Migration `20260913150937_phase_13_production_close.sql` creates `app.production_closures`, company-safe unique keys/FKs, RLS and column-limited runtime INSERT. Inventory entries gain `production_return_of` and `production_closure_id` with company-safe FKs and indexed lookups. Closure snapshots, author/time and consumption linkage cannot be supplied by runtime. No browser grants or private-function EXECUTE rights are added.

`app.production_material_state` and `app.production_close_review` are SECURITY INVOKER helpers with explicit tenant and permission validation. Review includes a deterministic fingerprint of the relevant state; this is stale-review detection, **not** an authentication token. Internal NOLOGIN-owner triggers use a fixed search path, explicit actor/tenant/permission checks and the existing order row lock. New closures, returns, original-issue reversals, production registrations and status changes serialize on that order. PostgreSQL SERIALIZABLE transactions and bounded retries handle concurrent requests. Immutable journal posting enforces nonnegative physical stock and preserves stock ownership. Closure document, net consumption and final order state/audit commit or roll back together. Duplicate semantic commands return the original result; changed payloads conflict.

Close requires production.read, inventory.read, production.close, production.manage and masterdata.read. Return requires production.read, inventory.read, production.return and inventory.transfer (the UI also needs masterdata.read to pick the destination). Existing inventory reversal rights remain necessary for return corrections. Role administration now accepts and displays production.issue/record/correct/return/close, preventing the previous fixed permission list from stripping these rights on role edits. Read-only users never gain commands by seeing the review.

## API and UI

NestJS routes under `/api/companies/:companyId/production-orders/:orderId/close`:

- GET `/review`, `/returns` (paginated), `/result` (404 until completed).
- POST `/returns` with issue reference, quantity, destination and comment.
- POST base path with review fingerprint, rejected quantity, comment, idempotency key and material confirmation.

The existing order status endpoint allows reconciliation/reopening; completed status can only be reached via the closure document. The UI preserves command/key across an uncertain response and asks for a new review when stale. Inventory history labels consumption correctly. Readiness checks only schema presence, without actor-dependent permission reads.

## Verification evidence

Initial targeted regression: 15 existing material issue/registration tests PASS. Initial six close API/database tests PASS. Full check found only the expected schema-count assertion needing 30 → 31; other 162 tests passed and nine real PostgreSQL tests were skipped locally. After correcting that assertion and adding shared-location and non-planner return coverage, targeted close API/helper/database checks: 14 PASS. Typecheck and build PASS. Browser suite discovery: 117 tests, including nine new close/return checks across desktop/tablet/mobile. Browser execution and real PostgreSQL concurrency still require the existing CI; no local browser/PostgreSQL runtime is installed.

New coverage includes stale reviews, partial and duplicate returns, owner preservation, another order's issue rejection, shared-location stock retained after closure, underproduction, count-unit validation, full rollback on stock shortage, completed-order immutability, private/runtime/browser privileges, cross-company denial, permission administration, secret-safe read-only helper and competing returns/closure. Existing phase tests are retained.

`node scripts/verify-production-close.cjs` performs hidden-input Supabase login and GET-only company/isolation checks after deployment. It uses the existing approved isolation company and creates no business fixtures. Expected success: `PHASE_13_READ_ONLY_VERIFICATION: PASS`. Preserve `PRODUCTION_CLOSE_ORDER_FIXTURE: NOT_RUN` when no order exists, or `PRODUCTION_CLOSE_EXISTING_RESULT: NOT_RUN` when the sampled order is not completed. Hosted writes are not covered by that helper.

## Economics and release

No resource, photo, dependency, migration-history reset or hosted fixture changes. The existing public repository and standard ubuntu-latest CI were checked; [standard public-repository runner usage is free](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Existing workflow and resource limits stay unchanged. Main push with Railway deployment requires a separate assessment before action; prior phase-specific approvals do not cover it. Hosted migration will be assessed against the existing Supabase plan before applying once.

## First CI checkpoint

CI run 34764084254 on `74cbe0c` passed typecheck/build, all 164 unit/API/database/helper tests and all nine real PostgreSQL concurrency tests. Browser checks: 114 PASS, three return-selector checks failed because the select lacked an unambiguous accessible name. The field now has an explicit aria-label; no database/API change. Normal working-branch CI will verify the correction and previously skipped runtime steps. No hosted migration or main deployment has run.

## Hosted migration blocked by automatic approval review

The existing Supabase organization was confirmed Free; database size is 13,405,331 bytes and Phase 13 is absent. Expected additional migration cost on that existing plan is 0 DKK, with no new resources or fixtures. However, automatic approval review rejected `apply_migration` for `phase_13_production_close` on project `puwyontrchonoepisgun`: the persistent production schema/privilege/trigger/constraint changes require explicit hosted-migration authorization, and rollback/cost impact was not established to the reviewer's satisfaction. The migration did not execute. No workaround or retry was attempted.

The migration is wrapped in one transaction: an application failure rolls back its DDL. It creates the closure table and helpers, adds attributed return/closure columns and constraints, and replaces the production-order/inventory guards described above. Existing open-order behavior is covered by the passing regression suite. Reverting after successful application, especially once closure records exist, needs a separately reviewed corrective migration; do not delete history or reset the hosted database. Do not deploy the new readiness check before applying the authorized migration.

Main publication remains blocked separately by the economic rule. Estimated one-off extra Railway usage for one normal existing deployment: 0–0.30 DKK expected, realistic conservative worst-case 1–3 DKK. The estimate uses the unchanged service/deployment pattern, with uncertainty in actual compute time, overlap and remaining included credit; it is not a measured bill or guaranteed cap. [Railway usage pricing](https://railway.com/pricing) lists CPU at $0.00000772/vCPU-second and RAM at $0.00000386/GB-second. No resource change is proposed. Standard public GitHub Actions runtime is free. Explicit approval is needed before the main push because its charge cannot be bounded confidently at 1 DKK.

## Automated verification complete — hosted release pending

CI [34764394909](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34764394909), job `103742671265`, commit `ee5a179c13a419e89d8a3407e3be9a55124520c1`: SUCCESS. Tree `5ef94db9784a95997ae5ee15aa72f53dca1301c3` matches local implementation/accessible-name correction. All 164 unit/API/database/helper tests PASS; all nine real PostgreSQL concurrency tests PASS in the separate disposable-database step; all 117 desktop/tablet/mobile tests PASS; typecheck/build/Docker runtime/diagnostic availability/strict TLS CA materialization PASS. The nine skips in the general test step were executed in the PostgreSQL step. No test gate was relaxed and no workflow/resources were changed.

Only closing documentation changes follow that tested commit. Hosted migration was rejected before execution and has not been retried. Main remains the Phase 12 release. Phase 13 is **not yet signed off online**. Required next actions, in order: explicit approval and one application of the reviewed hosted migration; verify new database boundaries/advisors and align the migration filename to the recorded hosted version if necessary without changing SQL; explicitly approved main push with its normal automatic deployment; public readiness and close routes; operator-run hidden-input read-only login/isolation helper. Do not claim NOT_RUN existing-order/result checks as PASS. No hosted fixtures or business writes are authorized as part of that helper. Photos remain disabled hosted. Phase 14 has not started.

## Authorized hosted migration and main publication

The user explicitly approved the concrete Phase 13 migration and publication of local `21a70e26a6b47fd133bf1fd567f43b3471d652c9`, including normal automatic GitHub Actions/Railway usage on unchanged resources. The previous automatic-review blocker is resolved by that approval. Migration `20260913150937_phase_13_production_close` was applied exactly once to existing project `puwyontrchonoepisgun`. Its local filename is aligned to hosted history with SQL unchanged (100% rename); this alignment is local and is not another migration execution.

Post-migration checks PASS: closure RLS enabled, permissions present, snapshot/author/history protected, consumption linkage protected, private writer not callable by app_backend, browser SELECT blocked. Hosted closure count is zero; no business fixtures were created. Security advisor has no new findings. Existing notices remain unchanged: [intentional default-deny private location-tree lock RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No configuration/paid feature was changed.

The approved content is published on main as `16c5fc5bb28e38cb83c1933974f01bb954016479`. Its tree `27c6988eee19ba2ed2658b80a9db5b938eea338c` is identical to approved local `21a70e2`. Main ref and a native fetch/content diff were verified. The normal automatic workflow is [34764838075](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34764838075); no manual rerun or deployment. Earlier successful implementation CI remains the test evidence; no passed tests were rerun manually.

The initial anonymous hosted check returned readiness HTTP 200 but close review/returns/result routes HTTP 404 rather than expected HTTP 401. Deployment has not yet been confirmed on the new commit. Authenticated login/isolation is not claimed. After the active Railway release is confirmed, verify the three routes and run `scripts/verify-production-close.cjs` with hidden local credentials and the existing approved isolation company. Expected `PHASE_13_READ_ONLY_VERIFICATION: PASS`; retain the documented expected NOT_RUN results when no existing order/result exists.

This checkpoint and migration-filename alignment are local only and do not trigger another deployment. Photos remain disabled hosted; no additional migration, fixture, resource change or manual deployment. Phase 14 has not started.

One bounded follow-up returned HTTP 404 for all three close routes again. No further repeated polling or manual deployment was attempted. Next external dependency is operator confirmation that Railway is running `16c5fc5bb28e38cb83c1933974f01bb954016479`; then repeat only these previously missing routes before the authenticated hidden-input verification. Readiness was already 200 and was not repeated. Phase 13 remains pending online sign-off.

## Targeted hosted route verification after deployment confirmation

The operator confirmed Railway runs `16c5fc5bb28e38cb83c1933974f01bb954016479`. Independent anonymous GET checks now return the expected HTTP 401 for all three previously missing close routes: `/review`, `/returns` and `/result`. Targeted route verification: PASS. Already-passed readiness, migration, database/TLS and automated tests were not repeated.

Authenticated hosted verification remains pending the operator's local execution of the self-contained `scripts/verify-production-close.cjs`, pinned to that deployed commit. All credentials are entered invisibly on the operator's machine; none are requested in chat. Use company MV Plast and the existing approved isolation fixture `b64edd83-ef7d-4fa9-93a0-424863a77cec`. The helper performs GET-only business checks and cleans up its local Supabase session. Preserve expected NOT_RUN outcomes if there is no existing order or closure; do not create fixtures. No authenticated PASS is claimed before receiving the result.

This checkpoint changes documentation only, locally. No push, migration, deployment, hosted fixture/configuration change or resource increase. Photos remain disabled hosted. Phase 13 online sign-off remains pending; Phase 14 has not started.


## Final Phase 13 sign-off — 2026-09-13

The operator reports `PHASE_13_READ_ONLY_VERIFICATION: PASS` against the confirmed Railway release `16c5fc5bb28e38cb83c1933974f01bb954016479`. Login, session, permissions, production-order reads, close review/returns/result access boundaries, not-found behavior and company isolation passed. This completes the remaining authenticated online verification following the recorded HTTP 401 route checks.

Expected coverage limitation: `PRODUCTION_CLOSE_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)`. No existing order was available to exercise positive close review/returns/result reads; no fixture was created. This is not recorded as PASS. Hosted return/closure writes and completed-result behavior were not exercised by the read-only helper; their coverage remains the previously recorded automated API/database, concurrency and browser tests.

Phase 13 is complete. Existing migration, deployment and automated verification evidence is retained without rerunning passed checks. This finalization changes only README, architecture documentation and this sign-off in a local documentation commit. No push, additional migration, manual deployment, hosted configuration change or resource increase is performed. Hosted photos remain disabled. Phase 14 has not started and requires separate authorization.
