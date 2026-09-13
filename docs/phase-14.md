# Phase 14 — Material differences and measured physical waste

Status: implementation from main `11ad3e6379dc0926b9e7ba158324775176110e4c`; verification in progress. Phase 15 has not started. Hosted photos remain disabled.

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

New migration `20260913172805_phase_14_material_analysis.sql` adds only `app.production_waste`, its constraints/indexes/RLS, two permission codes, a protected preparation trigger, immutable-history trigger and a completion-period index on `app.production_closures`. It does not change the stock writer or closure logic. It runs in one transaction as existing NOLOGIN `app_owner`.

Read requires `production.read` and `inventory.read`. Creation additionally requires `production.waste`; reversal requires `production.waste.correct`. Role administration supports both. Browser roles receive no grants. Runtime has SELECT and column-limited INSERT, no UPDATE/DELETE or ability to supply item/owner/unit/snapshot/author/time. The private trigger derives those fields after tenant/session/permission checks, checks the original issue/order and locks the order row. Company-safe foreign keys, immutable rows, unique idempotency/reversal keys and SERIALIZABLE retries protect concurrent commands. The exact request must match before an idempotent response is returned.

Phase 13's filename is aligned to its already-recorded hosted version `20260913150937` (100% rename, SQL unchanged). This is not an additional migration execution. Phase 14 must only be applied once to hosted history after release approval; never run Phase 13 again or reset a hosted database.

## Verification and release boundaries

Initial targeted verification: 14 material-analysis/API/database tests PASS. Additional count-unit, diagnostics, browser and real PostgreSQL concurrency coverage is prepared. Full verification results follow below; do not infer PASS from test discovery or a skipped runtime.

`node scripts/verify-production-waste.cjs` is a standalone hidden-input operator helper for the eventual hosted release. It performs real Auth login and GET-only order/history/analysis/isolation checks, then session cleanup. It creates no hosted business fixtures and never prints secrets. Expected final `PHASE_14_READ_ONLY_VERIFICATION: PASS`. Preserve `MATERIAL_ANALYSIS_ORDER_FIXTURE: NOT_RUN` if no order exists and `WASTE_EXISTING_RECORD: NOT_RUN` if no observation exists. Hosted writes are not tested by that helper.

No new service, dependency, replica, environment, compute allocation, resource limit or paid feature. Local tests cost no external usage. The existing public-repository standard GitHub runner workflow is unchanged; working-branch CI does not publish main or request a Railway deployment. Main publication must satisfy the user's 1 DKK rule or receive specific approval. A hosted migration and online verification are not claimed as performed by local implementation/testing.

Supabase's [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) was reviewed for grant/policy separation. The current changelog was checked; no relevant API/auth changes were required. Existing server-side Auth and tenant context remain unchanged.

## Local verification checkpoint

`npm run check`: PASS — typecheck, 181 unit/API/database/helper tests, frontend/backend build. Ten real PostgreSQL concurrency tests were skipped locally because the disposable PostgreSQL runtime is unavailable; they remain required in the existing CI step. The targeted final API/helper subset also passed (11 tests), including whole-unit validation and safe diagnostics. Browser discovery includes 12 new checks across desktop/tablet/mobile; discovery is not execution. No hosted migration or main publication has run.
