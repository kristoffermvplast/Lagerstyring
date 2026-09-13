# Phase 11 — Material to production

**Status: complete.** Final operator-reported hosted verification is recorded below; earlier pending notes are historical checkpoints. Phase 12 has not started.

## Scope and behavior

Continues main `0c459567ba371aab64b562eaf0b23a45509fe8a1`. A material issue is an existing balanced inventory transfer linked immutably to a production order. Physical stock moves between locations with the same item, owner and unit; total physical stock is conserved. It is not consumption, waste, a reservation, production registration or finished-goods delivery. No Phase 12 functionality is introduced and issuing material does not change production status.

An issue requires `production.read`, `production.issue`, `inventory.read` and `inventory.transfer`. UI location selection additionally requires existing `masterdata.read`. Planned/ready orders with an active machine and no open problem may receive components from their frozen BOM or packing revision. The guard also accepts the reserved `in_production` status for compatibility with later phases, but this phase provides no transition to it. Current component units must match the order snapshot. Extra quantities and repeated partial issues are allowed: theoretical demand is not a physical transfer limit.

Use the machine's configured storage location when present. If none is configured, choose an active storage location for production explicitly. No business location/type is hardcoded. No substitution component outside the order revisions is accepted; return to draft and revise the order before any issue, or reverse existing issues first. Fractional mass uses numeric(20,8); existing stock rules enforce whole count/package units.

## Data and transaction boundaries

Migration `20260913125931_phase_11_material_issue.sql` adds nullable `production_order_id` and trigger-owned `production_snapshot` to `app.inventory_entries`, a company-safe foreign key, constraints, a partial history index and the technical `production.issue` permission. No new tables, balances or business fixtures. Existing inventory entry/line RLS, immutable history, posting engine and nonnegative balance checks are retained.

The new internal guard is owned by NOLOGIN `app_owner`, has a fixed search path and no runtime/browser EXECUTE grant. It checks actor/session/company and permissions before privileged reads. It locks the order, validates component/machine and captures order code/version, machine identity/name and component snapshot. Runtime can supply only the order reference, not the snapshot. Existing transfer validation ensures exactly two balanced lines with the same owner/item and different locations. Posting remains one SERIALIZABLE transaction with bounded retries and the existing unique idempotency key. Cross-command/key reuse with a different payload is rejected.

A compensating reversal uses the existing reasoned inventory correction workflow and requires its existing adjustment permission plus production issue/read and transfer/read permissions. The guard carries forward the original order link and snapshot. This is correction of a mistaken issue, not the later material-return workflow. Return to draft is blocked while any unreversed issue exists, including concurrent status-edit attempts. Corrective reversal must restore all original stock lines atomically and cannot create negative stock. After reversing all issues the order may return to draft; original history remains intact.

The order link records attribution of the movement, not a separate reserved physical balance. Shared production locations continue to show aggregate physical stock by item/owner/location. Order-specific remaining material and consumption reconciliation belong to later phases and must account for issue/reversal history rather than treating those aggregate balances as exclusively owned by an order.

## API and UI

`/api/companies/:companyId/production-orders/:orderId/material-issues` exposes GET paginated history and POST issue; `/options` supplies snapshot components/machine location; `/:id` reads linked entry lines. NestJS validates payloads, verifies order scope, enforces permissions and handles identical retries. No browser database access.

The production order detail shows material history and a `Send materiale til produktion` action. The reused transfer form chooses an existing owner/location balance, filters to revision components, proposes the machine destination, confirms physical movement and retains the same request/key on an uncertain response. Inventory caches are invalidated after success. No photo/config/dependency/infrastructure changes.

## Verification status

- Local API build and typecheck: PASS.
- New API tests: 8 PASS (auth/isolation, permission gate, draft gate, precision/conservation, idempotency, snapshot history, order edit protection, invalid inputs/stock references, partial BOM/packing issues, corrective reversals and restricted database grants).
- Existing affected transfer, production-order and database regression suites: 17 PASS.
- New online-helper tests: 2 PASS (read-only business requests, isolation expectations, secret-safe output and cleanup).
- Local browser execution was initially blocked by absent Chromium and a download timeout; it exercised no application behavior. Existing standard GitHub CI then completed all 102 browser tests successfully, including the new material-issue tests on desktop, tablet and mobile.
- Real PostgreSQL concurrency: all 7 tests PASS in the existing disposable CI database, including concurrent duplicate issues, competing orders overdrawing a shared source, and concurrent return-to-draft vs issue. No local PostgreSQL binary was available here.
- Hosted migration `20260913125931_phase_11_material_issue` applied once to the existing Free project (database size before migration: 13,282,451 bytes). Post-migration checks PASS: order column and permission present, snapshot INSERT denied to runtime, private guard EXECUTE denied, balance UPDATE denied, inventory RLS enabled, zero hosted issues. The local filename was aligned to the hosted migration version; SQL is unchanged. Deployment and authenticated online verification remain pending.

Run the existing CI workflow on the working branch without Railway deployment. After authorized release, use `node scripts/verify-material-issues.cjs` with hidden local inputs. Expected final line: `PHASE_11_READ_ONLY_VERIFICATION: PASS`. If no production order exists, preserve `MATERIAL_ISSUE_ORDER_FIXTURE: NOT_RUN`; if an order exists without issues, preserve `MATERIAL_ISSUE_EXISTING_RECORD: NOT_RUN`. No hosted fixtures are automatically created; authenticated positive reads require existing data. All business requests are GET; Supabase login and local-session cleanup are the only Auth mutations.

## Economic and phase limits

Existing Supabase organization Free plan verified during this phase. No new services, replicas, resources, credits, limits, dependencies or paid features. Local work and existing public-repository standard GitHub CI add no external charge. Any main push with Railway deployment requires its separate cost assessment/approval. Hosted photos remain disabled. Phase 12 has not started.


## Hosted security review

No new security advisor findings. The two existing findings remain unchanged: intentional default-deny RLS without policies on private `location_tree_locks` ([explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)), and disabled leaked-password protection ([remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). No feature, policy, plan or billing setting was changed to address those pre-existing notices.

Readiness now checks the new order-reference column through information_schema, without reading actor-dependent permission rows. The real readiness query and failure-on-missing-production-table regression passed in the five-test local database suite after this adjustment.


## Automated verification complete; release pending

Working-branch CI [34758458769](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34758458769), job `103726878467`, commit `9062f98ba6bb15424caf35f254947ff9b1ace07f`: SUCCESS. The remote tree matches initial local implementation `d8e77b7`. Results: 146 unit/API/database/helper tests PASS, 7 real PostgreSQL concurrency tests PASS in their separate job step, 102 browser tests PASS, typecheck/build/runtime Docker/diagnostic availability/strict TLS CA checks PASS. The 7 tests skipped in the general unit step were subsequently executed successfully against disposable PostgreSQL. No manual workflow rerun or Railway deployment was initiated.

Subsequent local changes only add the structural readiness column check (API build and five database tests PASS), align the unchanged migration filename with hosted history, and record this evidence. No unrelated passed tests were repeated. The feature is implemented and automatically verified; main publication and authenticated hosted verification remain pending. No material-return, consumption or Phase 12 workflow is implemented.


## Authorized main publication; hosted verification pending

The specifically approved publication of local `a4d0a85` is on `main` as `b992b6f4791a00f99c247ef3d6a12f6fface2845`. GitHub commit metadata differs; both commits have the identical tree `8ece43b7da9cd0d84db54251bce02b0170defba2` and parent `9062f98ba6bb15424caf35f254947ff9b1ace07f`. The live main ref was verified and a native fetch plus empty tree diff independently confirmed the published content.

Normal automatic CI run [34759756814](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34759756814) was in progress at this checkpoint. Public readiness returned HTTP 200. The three anonymous material-issue GET routes (list, options, detail) still returned HTTP 404 on the initial check and a bounded follow-up, rather than the required 401. Deployment of the new commit is therefore not yet confirmed; these responses do not establish a code defect. No Railway management tools are available in this session.

Next: confirm the active Railway commit is `b992b6f4791a00f99c247ef3d6a12f6fface2845`, repeat only these route checks, then run `scripts/verify-material-issues.cjs` with the operator's hidden local credentials. Authenticated hosted verification and final Phase 11 closure remain pending. No additional migrations, manual deployments, hosted fixtures, photo activation or resource changes were performed. Phase 12 has not started. This publication note is local and has not triggered another push.


## Targeted hosted route verification after deployment confirmation

The operator confirmed Railway runs `b992b6f4791a00f99c247ef3d6a12f6fface2845`. The three previously missing anonymous GET routes now all return the expected HTTP 401: material-issue list, options and detail. Targeted route verification: PASS. No previously passed readiness, database/TLS or application suites were repeated.

Authenticated login/isolation verification still requires the operator to run the pinned `scripts/verify-material-issues.cjs` locally with hidden credentials and the existing approved isolation company. No authenticated result is claimed at this checkpoint. No hosted fixtures, migrations, deployments or configuration changes were made. Photos remain disabled hosted. Phase 12 has not started.


## Final Phase 11 sign-off

The operator reports `PHASE_11_READ_ONLY_VERIFICATION: PASS` against the confirmed Railway release `b992b6f4791a00f99c247ef3d6a12f6fface2845`. Login, session, permissions, production-order reads, material-issue access boundaries, not-found behavior and company isolation passed. The three anonymous material-issue routes were independently verified HTTP 401 in the preceding targeted check.

Expected coverage limitation:

```text
MATERIAL_ISSUE_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)
```

No existing production order was available. Positive material-issue list/options/detail reads for an existing order and hosted material-issue writes were therefore not verified by this read-only run. These behaviors retain the previously documented automated test coverage; NOT_RUN is not counted as PASS. No fixture was created.

Phase 11 is complete within this documented verification scope. This closing task changed documentation only and accepted the operator-provided result without rerunning passed tests. No push, migration, deployment, hosted configuration change or resource increase was performed. Photos remain disabled hosted. The economic 1 DKK rule remains in effect. Phase 12 has not started and requires separate approval.
