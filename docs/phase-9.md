# Phase 9 — Stock transfers

Continues from approved main `aa015ff`. Phase 10 is not started; hosted photos remain disabled.

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
