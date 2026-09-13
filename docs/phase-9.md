# Phase 9 — Stock transfers

Phase 9 is complete. Continues from approved main `aa015ff`; verified Railway release: `b93ee5d7bec573e244bbe33ce4a3a48fdd7dd12c`. Phase 10 is not started; hosted photos remain disabled.

The release records below are chronological. Earlier pending gates are superseded by the final verification at the end of this document.

## Implementation

A transfer moves one item belonging to one owner between two distinct storage locations within the same company, in its stock unit. `POST /api/companies/:companyId/transfers` accepts a positive decimal string, from/to location IDs, item/owner IDs, reference, optional comment and idempotency key. `GET` collection/detail provide tenant-scoped history. The browser selects an existing owner/location balance, shows its quantity and unit, selects a destination and confirms the move. Submitted data and key are frozen for safe retry after an uncertain response.

One immutable journal header of kind `transfer` contains two lines: source negative and destination positive. The database enforces the same item and owner, distinct locations, equal opposing quantities and valid dimensions. Existing stock posting triggers lock/update balances in deterministic order and prevent negative balances; the whole transaction rolls back on failure. Snapshots preserve historical names and location paths. No direct balance edits and no new balance tables.

`inventory.read` is required for reads and writes; `inventory.transfer` additionally authorizes transfer posting. Corrections and reversals still require `inventory.adjust`. UI destination selection also requires `masterdata.read`. A transfer-only user cannot adjust stock or manage owners. Admins retain the existing all-permission behavior; non-admin roles need an explicit transfer grant. Runtime journal RLS enforces the same boundaries. Browser roles retain no business-schema access.

SERIALIZABLE retries preserve the existing company-wide idempotency namespace. Equal replay returns the original transfer; changed commands conflict. A compensating reversal can undo the whole transfer once and only when sufficient stock remains at the destination. It never edits the original movement. A reversal preserves the original line references.

## Scope limits

No owner change, company-to-company transfer, in-transit state, unit conversion, individual pallet/QR workflow, reservations or production. Those belong to later approved phases. One selected balance per operation; list/search/pagination keep stock selection bounded. The displayed balance is a snapshot at lookup; the database checks current stock atomically when posting. Comments may be blank or at least three characters to reuse the existing journal reason constraint. Negative or zero transfer quantity and identical source/destination are rejected.

## Verification and release status

- Five targeted API tests pass: precision/ownership/idempotency, snapshots/reversal, rollback/invalid data, access/isolation and direct database journal constraints.
- Full local check, real PostgreSQL concurrency, browser/runtime CI, hosted migration and online release status are recorded below as completed. No pending check is claimed as passed.
- `scripts/verify-transfers.cjs` is the read-only online operator helper. It hides local credentials, sanitizes errors, checks permissions/list/detail isolation and cleans up its login session. It creates no business fixture; missing existing transfer detail is NOT_RUN.
- No new dependencies, services, runners or resource configuration. Local fixtures only. Main push requires economic assessment/approval; working branch CI uses the existing free standard runner on the public repository.

## Verification evidence

Local `npm run check` passed: typecheck, 126 unit/API/database/operator-helper tests and build. Five dedicated PostgreSQL concurrency tests were skipped in the normal local suite because no local server is available, then executed successfully in GitHub CI on the existing runner. Browser/runtime CI status follows below. No previously passed online tests were repeated.

Hosted migration `20260912161747_phase_9_transfers` applied once to the existing Supabase Free project, database size 13,036,691 bytes before migration. Source filename is aligned with the actual hosted version; SQL unchanged. Verified: transfer permission, kind constraint, receiving/correction/transfer RLS policy, enabled journal RLS, guard owned by `app_owner`, no runtime journal UPDATE or direct balance UPDATE, and no browser schema access. Zero journal entries before/after; no fixture created. No new services, credentials, limits or paid features.

Security advisors have no new findings. Existing notices remain: intentional default-deny RLS on private location locks ([explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)) and disabled [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No Auth feature or plan was changed.

Initial branch CI `34704739579` passed check and concurrency, with 87 browser checks passing. Three transfer browser cases timed out resolving the source selector: its implicit label included option text. The selector now has an explicit stable accessible name, matching the existing pickers. The test assertion is unchanged. Runtime steps were skipped after the browser failure; final CI evidence follows.

## Main publication boundary

Main is unchanged; no Railway deployment has been triggered for Phase 9. Publishing to main requires a separate economic approval: estimated incremental Railway usage 0–0.30 DKK, realistic stress case 1–3 DKK, one-off. Basis: 5–10 minutes of overlapping execution around 1–2 vCPU / 1–2 GB versus a 30–60 minute stress case at 4 vCPU / 8 GB, published rates $0.000463/vCPU-minute and $0.000231/GB-minute and a conservative 10 DKK/USD conversion/buffer. These are resource-time scenarios, not measured build billing. Current Railway usage/credits are inaccessible, so the charge cannot reasonably be bounded within 1 DKK. Existing public GitHub standard CI is free. No permanent resource increase is proposed.

After approval: publish the reviewed commit to main with its normal automatic runs; do not rerun migration `20260912161747`. Confirm the active Railway revision, then verify anonymous transfer list/detail routes return 401 and run `node scripts/verify-transfers.cjs` locally using hidden credentials, company `MV Plast` and the already-approved isolation company. No credentials in chat and no hosted fixtures. If no transfer exists, preserve `TRANSFER_EXISTING_RECORD: NOT_RUN`. Phase 9 cannot be signed off online before actual results arrive. Phase 10 requires separate approval.

## Final pre-release result

[CI run 34705048817](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34705048817), job `103583483727`, commit `f50d81f27dd5cbbf8652221f53805bb5ada53379`: all steps PASS, including the corrected source-selection browser flow, build, real PostgreSQL concurrency, Docker runtime, diagnostic loading and strict CA/TLS checks. The source-selector failure is resolved. The hosted migration SQL is unchanged from the tested version; it must not be applied again.

Implementation and pre-release verification are complete. Only this documentation changed after the passing CI run. Remaining work is the economically approved main push/automatic release and authenticated online verification. No Phase 10 work was started; hosted photos remain disabled.

## Approved main release

The operator approved the one push of local `effa0eb`, including normal automatic GitHub Actions/Railway consumption on unchanged resources. Main was fast-forwarded to `b93ee5d7bec573e244bbe33ce4a3a48fdd7dd12c`. The GitHub-created commit has exactly the approved tree `5e37c4e71f102aed9f4cc6e4134d5086c7aa034d` and parent `f50d81f27dd5cbbf8652221f53805bb5ada53379`; only commit identity differs. Automatic approval review initially rejected the different SHA, then allowed the action after read-only verification of tree and parent equivalence. Main ref and fetched content were verified.

Automatic main CI: [run 34728082480](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34728082480), job `103645727498`. No manual test rerun or deployment was requested. No migrations, secrets/config changes, resource changes or second branch push occurred. Hosted photos remain disabled.

Initial release-window public checks: `/api/health/live` 200 and `/api/health/ready` 200. Anonymous transfer collection and detail routes both returned 404, expected 401 once the new runtime is active. Health responses do not identify the deployed commit. Railway tools are unavailable, so its active revision is not verified. No credentials were requested in chat and no authenticated session was created.

Main CI completed successfully: all check, PostgreSQL concurrency, browser, Docker runtime, diagnostic and strict TLS/CA steps PASS. The targeted anonymous transfer collection/detail recheck still returned 404, not the expected 401. Active Railway revision remains unverified. Authenticated transfer/isolation verification is NOT_RUN pending route availability; no full online Phase 9 completion is claimed.

Next operator action: confirm whether the existing service's automatic Railway deployment for `b93ee5d7bec573e244bbe33ce4a3a48fdd7dd12c` is active or failed. Share only commit/status, no secrets. Once active, recheck only the blocked routes and run `scripts/verify-transfers.cjs` locally with hidden input. Preserve any expected missing-existing-transfer NOT_RUN. This release record is saved in a local documentation commit only; no additional push/deployment is performed. Photos remain disabled hosted. Phase 10 has not started.

## Targeted routes after confirmed Railway deployment

The operator confirmed active Railway commit `b93ee5d7bec573e244bbe33ce4a3a48fdd7dd12c`. Only the previously blocked anonymous transfer routes were rechecked:

- GET transfer collection: HTTP 401 — PASS.
- GET transfer detail with probe ID `00000000-0000-4000-8000-000000000000`: HTTP 401 — PASS.

This resolves the earlier 404 blocker. Previous CI, migration and health tests were not repeated. No hosted data, configuration, photo setting or resources were changed; no push, migration or deployment was performed.

Remaining gate: operator runs the existing `scripts/verify-transfers.cjs` using hidden local publishable key/email/password, company `MV Plast`, and existing isolation company `b64edd83-ef7d-4fa9-93a0-424863a77cec`. Expected final result: `PHASE_9_READ_ONLY_VERIFICATION: PASS`. If no transfer exists, preserve `TRANSFER_EXISTING_RECORD: NOT_RUN (no existing transfer; no fixture created)` and do not count it as a pass. No business fixture is created. Authenticated verification remains pending until actual operator output is received. This documentation is committed locally only; Phase 10 has not started.

## Final Phase 9 verification and sign-off

The operator reported `PHASE_9_READ_ONLY_VERIFICATION: PASS` from the authenticated online verification. Login, session, permissions, transfer collection reads, response company scope, not-found behavior and cross-company isolation passed. Together with the previously recorded anonymous route checks and automated tests, this completes Phase 9 verification. No already-passed test was rerun for this sign-off.

Expected coverage limitation, preserved exactly:

```text
TRANSFER_EXISTING_RECORD: NOT_RUN (no existing transfer; no fixture created)
```

This is not counted as PASS. No existing transfer was available for that detail check, and no hosted business fixture was created. Hosted verification was read-only; transfer posting, atomicity, reversal and concurrency are covered by the previously recorded automated tests, not claimed as hosted write tests.

Only documentation was updated for closure. No code changes, migration runs, push, deployments, hosted configuration changes or resource changes were performed. Hosted photos remain disabled. Phase 9 is closed; Phase 10 requires separate approval.
