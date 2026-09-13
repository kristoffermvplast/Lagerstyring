# Phase 14 — Material differences and measured physical waste

Status: Phase 14 is complete. Implementation and automated verification are recorded below; hosted migration was applied once and main/Railway release is `77b2e1c51f71ee0b4f58a82ceb120be6fd897be2`. Operator-reported `PHASE_14_READ_ONLY_VERIFICATION: PASS` completes online sign-off with the expected absent-order NOT_RUN limitation. Hosted photos remain disabled. Phase 15 has not started.

## Behavior

Order analysis reads original issue/return evidence and the frozen order BOM/packing. Completed orders use the immutable Phase 13 closure snapshot. Open-order net quantities are explicitly provisional: unreturned material may still be on the production floor. No provisional difference is labelled physical waste.

- Material difference = issued − returned − theoretical consumption for registered good output.
- Measured physical waste is an independent observation, linked to an original issue and its historical item, owner and unit. It is never inferred from the difference or rejected-unit count.
- Unexplained difference = material difference − measured physical waste. It may be negative; it is not silently clamped.
- Difference percent and measured-waste percent use net issued-minus-returned as denominator. A nonpositive denominator gives null, not zero or infinity.
- Theoretical BOM consumption uses exact BigInt rational intermediates (including BOM base quantity). API returns exact numerator/denominator as well as eight-decimal half-up displays. Packing uses whole-container counts/accessories, including partial containers and frozen order overrides. Zero good output is valid.
- Quantities are grouped by component **and unit ID**. Different units never sum or implicitly convert; symbols remain those of the snapshots (kg is displayed only when the unit actually is kg). Owner totals are separate; theoretical requirements are not duplicated or arbitrarily apportioned between owners.
- Missing theoretical basis and mismatched units return null with a warning. Negative differences, waste above net, and observations against subsequently reversed issues remain visible warnings requiring investigation.

Observations may be recorded during production, reconciliation or after completion. Post-completion observations/corrections append measurement history; they do not edit completed orders or closure snapshots. All amounts are in the original issued stock unit; count/package units require whole quantities. A measured amount above ledger net is accepted as an explicit discrepancy, not disguised as verified inventory consumption. Comments are mandatory. A wrong observation is corrected by full reasoned reversal followed by a new observation; edits/deletes are unavailable.

Waste is a classification of material already included in Phase 13 net consumption. **No waste endpoint posts inventory, consumes BOM/packing again, creates finished stock, or changes closure quantities.** Before closure, observations do not prove that remaining stock has been consumed. Existing stock correction/return/closure workflows remain authoritative.

## API and UI

All business calls go through NestJS. Under `/api/companies/:companyId/production-orders/:orderId/waste`:

- GET `/analysis`: per-material theory, difference, measured waste, unexplained amount, percentages and owner breakdown.
- GET base: paginated immutable observation/reversal history (25 rows).
- GET `/:id`: same-company/same-order observation.
- POST base: issue reference, decimal quantity, comment and idempotency key.
- POST `/:id/reverse`: reason and idempotency key; quantity and all references come from the original.

GET `/api/companies/:companyId/production-analysis` lists completed-order analyses by completion timestamp, with period, product, material, machine and customer filters. Pagination is per order (25); quantities/percentages are displayed per component/order, never added across unlike units. Waste totals reflect current unreversed observations, including later corrections. This is operational trend history, not the later Phase 22 general report/export engine. Per-observation actor/time is available in history; no unsupported attribution of all order waste to one operator.

The order page offers a simple analysis table and measured-waste form. Uncertain responses retain the same command and key with locked inputs; retries cannot create duplicates. Corrections require a reason. The history view and analysis filters work on desktop/tablet/mobile without new design infrastructure. Production changes invalidate the relevant analysis cache; a manual refresh remains available.

## Schema and access

New migration `20260913174524_phase_14_material_analysis.sql` adds only `app.production_waste`, its constraints/indexes/RLS, two permission codes, a protected preparation trigger, immutable-history trigger and a completion-period index on `app.production_closures`. It does not change the stock writer or closure logic. It runs in one transaction as existing NOLOGIN `app_owner`.

Read requires `production.read` and `inventory.read`. Creation additionally requires `production.waste`; reversal requires `production.waste.correct`. Role administration supports both. Browser roles receive no grants. Runtime has SELECT and column-limited INSERT, no UPDATE/DELETE or ability to supply item/owner/unit/snapshot/author/time. The private trigger derives those fields after tenant/session/permission checks, checks the original issue/order and locks the order row. Company-safe foreign keys, immutable rows, unique idempotency/reversal keys and SERIALIZABLE retries protect concurrent commands. The exact request must match before an idempotent response is returned.

Phase 13's filename is aligned to its already-recorded hosted version `20260913150937` (100% rename, SQL unchanged). This is not an additional migration execution. Phase 14 must only be applied once to hosted history after release approval; never run Phase 13 again or reset a hosted database.

## Verification and release boundaries

Initial targeted verification: 14 material-analysis/API/database tests PASS. Additional count-unit, diagnostics, browser and real PostgreSQL concurrency coverage is prepared. Full verification results follow below; do not infer PASS from test discovery or a skipped runtime.

`node scripts/verify-production-waste.cjs` is a standalone hidden-input operator helper for the eventual hosted release. It performs real Auth login and GET-only order/history/analysis/isolation checks, then session cleanup. It creates no hosted business fixtures and never prints secrets. Expected final `PHASE_14_READ_ONLY_VERIFICATION: PASS`. Preserve `MATERIAL_ANALYSIS_ORDER_FIXTURE: NOT_RUN` if no order exists and `WASTE_EXISTING_RECORD: NOT_RUN` if no observation exists. Hosted writes are not tested by that helper.

No new service, dependency, replica, environment, compute allocation, resource limit or paid feature. Local tests cost no external usage. The existing public-repository standard GitHub runner workflow is unchanged; working-branch CI does not publish main or request a Railway deployment. Main publication must satisfy the user's 1 DKK rule or receive specific approval. A hosted migration and online verification are not claimed as performed by local implementation/testing.

Supabase's [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) was reviewed for grant/policy separation. The current changelog was checked; no relevant API/auth changes were required. Existing server-side Auth and tenant context remain unchanged.

## Local verification checkpoint

`npm run check`: PASS — typecheck, 181 unit/API/database/helper tests, frontend/backend build. Ten real PostgreSQL concurrency tests were skipped locally because the disposable PostgreSQL runtime is unavailable; they remain required in the existing CI step. The targeted final API/helper subset also passed (11 tests), including whole-unit validation and safe diagnostics. Browser discovery includes 12 new checks across desktop/tablet/mobile; discovery is not execution. No hosted migration or main publication has run.


## Hosted migration — applied once

The existing organization is still Free. Before migration, database size was 13,528,211 bytes and Phase 14 was absent. Expected extra cost: 0 DKK on the unchanged existing Free project. Migration `20260913174524_phase_14_material_analysis` was applied successfully once to `puwyontrchonoepisgun`. Its CLI-generated filename `20260913172805` is aligned to hosted history (100% rename, SQL unchanged); do not apply it again.

Post-migration checks PASS: RLS enabled; browser SELECT blocked; snapshot/item/author protected from runtime INSERT; no runtime UPDATE/DELETE; private preparation function not callable by runtime; both permission codes present. Observation count: zero; no hosted fixtures. Security advisor has no new findings. Unchanged existing notices: [intentional default-deny location lock RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No paid feature/configuration was enabled. Main remains the Phase 13 release; app deployment and authenticated online verification remain pending.

## CI checkpoint and browser fixture compatibility

Working-branch CI `34772405645` (`5329e1430dcf6b19e1f6388eb2c897eb71bb403e`) passed code checks and all ten real PostgreSQL concurrency tests. While browser verification runs, inspection found four older production-page fixtures returning a generic order for the new GET waste endpoints. Those fixtures now return the correct empty analysis/history responses. Assertions and application behavior are unchanged. Browser/runtime completion is still pending; a normal working-branch run will verify the corrected fixtures and unchanged migration SQL under its hosted-aligned filename.


## Main publication cost gate

The remaining concrete paid action is one push of the Phase 14 release to main and its ordinary automatic Railway deployment on unchanged resources. Expected one-off incremental usage: 0–0.30 DKK; realistic conservative worst-case: 1–3 DKK. This is an estimate, not a measured bill or guaranteed cap. [Railway pricing](https://railway.com/pricing) lists CPU at $0.00000772/vCPU-second and RAM at $0.00000386/GB-second. Actual CPU time, deployment overlap, build duration and remaining included credits are unavailable; the prior small-deployment estimate therefore cannot be confidently bounded at 1 DKK. No ongoing resource allocation increase is proposed.

The repository was confirmed public and its existing ubuntu-latest workflow is unchanged. [Standard public-repository GitHub Actions runtime is free](https://docs.github.com/en/billing/concepts/product-billing/github-actions); no new artifact upload, runner, cache-limit or paid feature is added. Working-branch verification does not deploy Railway main. Supabase migration on the existing Free plan is already applied at expected 0 DKK.

Main push is not performed without the user's concrete economic approval. After that push and its automatic deployment: check readiness and the new anonymous routes for HTTP 401, then use the hidden-input operator helper for authenticated isolation. No manual deployment, extra migration or hosted fixture is needed or authorized by this checkpoint. Phase 14 is not yet signed off online; Phase 15 remains blocked.


## Automated verification complete — main publication pending

CI [34772726694](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34772726694), job `103765150173`, commit `a87da11b45e28476ddbe1604942dc291355206f3`: SUCCESS. Verified tree `b646ddbd58b23883ca818ffea43e2cec369b065f` matches the local implementation, hosted filename alignment and corrected browser fixtures.

- 181 unit/API/database/helper tests PASS; ten concurrency skips in this general step were exercised separately.
- All ten real PostgreSQL concurrency tests PASS, including duplicate measured-waste commands and competing reversals with unchanged stock/closure.
- All 129 desktop/tablet/mobile browser tests PASS, including twelve new Phase 14 checks.
- Typecheck, frontend/backend build, Docker runtime, diagnostic script availability and strict TLS CA materialization PASS.

First CI `34772405645` had 116 browser PASS and 13 failures in older generic production API mocks; all twelve new Phase 14 browser checks passed. The four old fixture adapters were corrected to return valid empty waste responses. The final CI passes without disabling assertions, relaxing test gates or changing runtime resources/workflows.

Only closing documentation follows the verified implementation. Main remains `11ad3e6`; no main push or manual deployment has been performed. Supabase migration is already applied and must not be repeated. The next step is the specifically approved main push and normal automatic deployment, followed by targeted readiness/route checks and the operator-run authenticated helper. Do not claim online completion yet. Hosted photos remain disabled; Phase 15 has not started.


## Approved main publication and initial hosted checks

The user approved the specific publication of `c7e1b22312aeaa28d31ec1fb4b3510be51654cb0`, including ordinary automatic GitHub Actions/Railway usage on unchanged resources. Main was updated to `77b2e1c51f71ee0b4f58a82ceb120be6fd897be2`. Its tree `8a8812edda70df8bb3323573bd90395272b55914` exactly matches the approved commit. Remote ref read-back and a native fetch/tree comparison verified publication. No additional migration, manual deployment or resource/configuration change was performed.

Public read-only checks against the existing Railway address:

- `/api/health/ready`: HTTP 200.
- Order `/waste`, `/waste/analysis`, `/waste/:id`, and company `/production-analysis`: HTTP 404, expected unauthenticated HTTP 401.
- One bounded follow-up of only those four failed routes still returned HTTP 404.

Railway deployment inspection tools are unavailable in this session. The active deployment commit therefore remains unconfirmed; 404 alone does not prove its cause. Operator confirmation of active commit `77b2e1c51f71ee0b4f58a82ceb120be6fd897be2` is needed before the next targeted route check. Once available, run the hidden-input `verify-production-waste.cjs` helper for authenticated isolation. No authenticated Phase 14 PASS is claimed. Existing-order and existing-waste NOT_RUN outcomes remain permissible only when the respective fixtures are absent.

This checkpoint is documentation only, retained locally without another push. Hosted photos remain disabled. Phase 14 online sign-off is pending; Phase 15 has not started.


## Active deployment — targeted route verification PASS

The operator confirmed Railway commit `77b2e1c51f71ee0b4f58a82ceb120be6fd897be2`. A targeted repeat of only the four previously failing routes returned HTTP 401 for each: order `/waste`, `/waste/analysis`, `/waste/:id`, and company `/production-analysis`. The previous HTTP 404 blocker is resolved. No earlier passing tests were repeated, and no hosted writes, migration, deployment or configuration changes were made.

Authenticated verification still requires the operator to run the existing hidden-input `scripts/verify-production-waste.cjs` using their credentials locally. No authenticated result is claimed yet. Record the final PASS and any expected absent-fixture NOT_RUN results when provided. Photos remain disabled hosted; Phase 15 has not started.


## Final online verification — Phase 14 complete

The operator reported `PHASE_14_READ_ONLY_VERIFICATION: PASS` against the confirmed Railway release `77b2e1c51f71ee0b4f58a82ceb120be6fd897be2`. Login, session, permissions, production-order reads, waste-analysis access boundaries, material trend, not-found behavior and company isolation passed. The four anonymous route checks already passed with HTTP 401.

Expected result: `MATERIAL_ANALYSIS_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)`. Positive analysis/history/detail reads for an existing production order were therefore not exercised online. Hosted writes were not exercised by this read-only helper; the previously recorded automated tests remain their evidence. No additional NOT_RUN result is inferred.

This operator-reported final result supersedes the earlier pending checkpoints. No previously passed tests were repeated. Only README, architecture and this phase document were updated for closure; no code changes, migration, push, deployment or resource change was made. The hosted migration remains applied exactly once. Hosted photos remain disabled. Phase 14 is closed; Phase 15 has not started.
