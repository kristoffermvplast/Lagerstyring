# Phase 7 — Inventory foundation

Status: Phase 7 is complete. The operator reported `PHASE_7_READ_ONLY_VERIFICATION: PASS` on the verified Railway commit `fbd6f78a8002a02e1d8c853eba08d944b4dda91b`. The expected existing-entry NOT_RUN is recorded below. Earlier pending statements are historical checkpoints superseded by this final sign-off. Phase 8 is not started. Hosted photos remain disabled.

## Scope and boundaries

- `stock_owners`: explicit company/external ownership; customer/supplier references or another named external owner. One own-company owner per company. No seeded business records. Editable fields have optimistic version checks and audit history; kind/reference are immutable to runtime.
- `inventory_entries`: append-only corrections and complete compensating reversals, server actor/time, reason, optional reference, stable client UUID idempotency key.
- `inventory_lines`: append-only signed quantities and item/owner/location/path/unit snapshots.
- `stock_balances`: transaction-maintained projection, per company/item/owner/location and the item's immutable stock unit. The journal can reconstruct every balance.
- `inventory.read` and `inventory.adjust` are tenant-scoped, configurable permissions. No browser database access. No runtime direct writes to lines/balances, no private-schema access, and no historical updates/deletes.
- Frontend: stock overview, journal details, owner creation/edit/history, confirmed correction and reversal. Correction picker additionally needs `masterdata.read`. Owners and items are created through the existing UI, never hardcoded.

Receiving, transfer workflows, reservations, production, handling units, counting sessions and forecasts remain later phases. Corrections can introduce an explained starting balance; they are not a receipt workflow. The API supports up to 100 distinct balance keys per correction; the initial UI submits one line.

## Transaction guarantees

The existing NestJS `asActor` uses SERIALIZABLE transactions, authenticated session/revocation checks and company context. Posting requires both inventory permissions. Owner-executed triggers validate references, write all lines and update all balances in the same transaction. A narrow EXECUTE grant allows the owner trigger to use the existing `app.session_active()` function; it grants no new backend role membership or access to Auth tables.

Numeric quantities are strings in JSON and NUMERIC(20,8) in SQL: up to 12 integer and 8 fractional digits. Zero, exponents, NaN and excess precision are rejected. Count/package units require integers. There is no implicit unit conversion. Overflow fails atomically.

Balance keys are locked/updated in deterministic order. Negative physical stock always fails and rolls back every line and header. The backend retries the entire transaction up to three attempts on serialization/deadlock errors and a competing identical idempotency key. Identical normalized payload/key returns the existing entry; a different payload using that key conflicts. There is at most one full reversal of an original correction, and reversals cannot themselves be reversed. A compensating correction is available when required.

Positive quantities require active item, owner, unit and stock-enabled location. Negative corrections may clear existing stock on inactive references. Reversals obey these same current availability rules. No silent administrative override exists.

Snapshots remain unchanged when masterdata is renamed. Balance labels describe the most recent posting, not necessarily current masterdata labels. Correction fields lock after the first submission; retries reuse the same payload/key. If a user closes/reloads after a network error, they must check the journal before starting a new correction. No offline write queue is implemented.

## Local verification — 2026-09-12

- `npm run check`: PASS, including typecheck, 106 tests and production builds. Two real-PostgreSQL concurrency tests were explicitly skipped because no local PostgreSQL server was available.
- Additional targeted tests after that run: 11 PASS (inventory integrity/session revocation/history immutability and read-only operator helper). This is not an additional 11 unique tests: several overlap the full run.
- Final frontend typecheck: PASS.
- NestJS tests cover correction replay, mismatched idempotency keys, overdraw rejection, owner versions/history, reversal replay, anonymous 401, missing permission/foreign-company 403 and record-level 404.
- PGlite tests cover decimal accuracy, external-owner separation, rollback of multiple lines, immutable snapshots/journal, no direct runtime ledger/balance writes, revoked sessions, read-only rights and tenant isolation.
- Browser suite: BLOCKED before test bodies; Chromium is absent and its download timed out. This is an environment failure, not a passed UI test. New desktop/tablet/mobile cases cover ownership visibility, read-only controls, company switching and identical correction retry.
- Real concurrent connections: NOT_RUN locally. PGlite's single connection is not concurrency evidence. `tests/inventory-concurrency.test.ts` uses a rendezvous to start competing SERIALIZABLE transactions with overlapping snapshots; it checks duplicate-key replay and competing debits against 500 units. Existing GitHub CI is configured to run it in a temporary PostgreSQL container on its existing runner; no hosted database/service is added. The first branch CI run passed both real concurrency tests.

## Running the real concurrency checks locally

Use only a new disposable local database. The suite refuses remote hosts, URL query options, any database name other than `phase7_inventory_test`, or an existing `app` schema. It does not reset a database.

With Docker installed, after `npm ci` and `npm run build -w @lager/api`:

```sh
docker run --rm --name phase7-postgres -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=phase7_inventory_test -p 127.0.0.1:55432:5432 postgres:17
```

In another terminal, once PostgreSQL says it is ready:

```sh
INVENTORY_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/phase7_inventory_test npx vitest run tests/inventory-concurrency.test.ts
```

Stop the temporary container after testing. The passwordless trust configuration is local test infrastructure only, bound to loopback; never use it for the application or hosted PostgreSQL.

## Migration and hosted verification

Applied once: `supabase/migrations/20260912141755_phase_7_inventory.sql` (Supabase migration version, synchronized with the repository). It creates four tables, two permissions, constraints, indexes, policies and posting triggers. It creates no business records, environments or paid resources. The existing Free project was checked before migration (12,635,283 database bytes). Expected extra charge: 0 DKK. All four new tables remain empty; no fixtures or business records were created. RLS and app_owner ownership are enabled on every new table. Runtime may insert requests but cannot forge actor IDs, alter historical journals, write lines/balances directly, execute private posting functions or access the private schema. Browser roles have no app schema usage. These hosted catalog checks all passed.

Final branch CI passed. Before release: obtain approval for the main push/deployment under the economic gate below. Do not rerun the already applied migration. Security advisors found no new Phase 7 findings; the prior private location lock table INFO (intentional deny-by-default) and disabled Auth leaked-password protection warning remain unchanged. See [RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [Auth protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Do not use the privileged connection for NestJS. Readiness now requires `app.stock_balances`, so the migration must precede the backend release.

After an approved normal push/deployment, check live/readiness, the deployed commit and anonymous 401 for `/api/companies/<company UUID>/inventory/balances`, `/entries` and `/owners`. Run `node scripts/verify-inventory.cjs` interactively with the existing user and approved isolation company. It hides inputs, prints only safe statuses, makes no business writes and cleans up its Supabase session. Expected empty-data status: `INVENTORY_EXISTING_ENTRY: NOT_RUN (no existing entry; no fixture created)`. Do not claim hosted write/concurrency coverage from that read-only result.

Phase 7 is not signed off until remaining verification is recorded. Do not start Phase 8.

## CI recovery of unavailable local tools

[Branch CI run 34698679876](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34698679876) passed the complete workflow: typecheck/build, automated tests, both real PostgreSQL concurrency tests, all 78 browser cases, backend Docker build and strict-TLS diagnostic runtime checks. This resolves the earlier local browser/PostgreSQL environment limitations. Follow-up changes add client decimal validation, an integer-unit test, a journal actor index and synchronize the hosted migration filename. They passed the complete workflow in [final branch CI run 34699001864](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34699001864) on commit `3812368f60ebe67bbfb5a2cee28ece15b43acc93`: 110 automated tests plus 2 real PostgreSQL concurrency tests, 78 browser tests, typecheck/build, Docker and strict-TLS runtime checks. No remaining local/CI failures are known.

Only standard runners on this public repository are used ([GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)); expected Actions execution charge is 0 DKK. No main update or Railway deployment has occurred.

## Economic gate for main release

A main push remains separate from the free working-branch CI runs. It triggers the existing Railway deployment. Current Railway plan usage, remaining included credit, CPU/RAM measurements and deployment overlap are unavailable, so the additional charge cannot confidently be bounded to 1 DKK.

Planning estimate for that one push/deployment: **0–0.30 DKK expected**, **1–3 DKK realistic stress-case**, one-off. No new recurring resources/subscriptions are proposed. Estimate uses [Railway rates](https://docs.railway.com/pricing/plans) of USD 0.000463/vCPU-minute and 0.000231/GB-minute, normal additional execution of 5–10 minutes at 1–2 vCPU and 1–2 GB, versus 30–60 minutes at 4 vCPU and 8 GB if allowed by existing resources. Budget conversion is 8 DKK/USD plus up to 25% VAT, not a quoted current exchange rate. These are resource-use assumptions, not measurements or a claim that build minutes themselves are separately billed. Included credits can reduce the actual additional bill to zero. Explicit approval is required before the main push when these assumptions cannot be confirmed.

## Pre-release handoff (superseded by release record below)

Main was verified unchanged at `9845d199b2312f4f83cb658802275837661b98d2` after final CI success. Implementation is on `phase7-inventory` at `3812368`; this documentation-only follow-up is local. Next: approved normal main push/deployment, anonymous route/readiness checks, then operator-run authenticated read-only inventory verification. Do not apply the migration again. Photo configuration remains untouched/disabled hosted. Phase 7 online sign-off is pending; Phase 8 is not started.

## Approved main release — 2026-09-12

The user approved exactly the `b2435cc` push and its normal automatic GitHub Actions/Railway consumption on unchanged resources. Main was fast-forwarded to `fbd6f78a8002a02e1d8c853eba08d944b4dda91b`. GitHub commit creation assigned different author/timestamp metadata: its tree `791eb33695249c5429379c2fca154f05a25e07cb`, parent `3812368f60ebe67bbfb5a2cee28ece15b43acc93` and message exactly match approved local commit `b2435ccdfc1d35606ccfabdda63608b6cceb9e1b`. Both remote metadata and a local Git content comparison were checked. The initial automatic approval review rejection about the differing SHA was resolved by supplying this equivalence evidence before retrying the main update.

[Automatic main CI run 34699406655](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34699406655). No manual workflow/deployment, migration, resource setting or photo configuration was changed in this release step.

Railway tools are unavailable in this conversation. GitHub does not expose a Railway commit status here; its connector also does not support deployment-list reads. Public endpoints can verify route availability, but cannot prove the running Railway commit. No authenticated online verification is claimed without the operator's login results.

### Release verification result

- Main update: PASS, verified remote SHA and exact content equivalence with the approved commit.
- Automatic main CI: PASS, all workflow steps completed successfully (run 34699406655). The unchanged implementation's 110 automated tests, 2 real PostgreSQL concurrency tests, 78 browser tests and Docker/TLS checks remain passing.
- Public `/api/health/live`: HTTP 200.
- Public `/api/health/ready`: HTTP 200. These were measured during the release window and do not identify the deployed version.
- Anonymous `/api/companies/<own-company>/inventory/balances`, `/entries`, `/owners`: HTTP 404 both initially and in the targeted recheck after main CI completed. Expected after Phase 7 runtime is active: HTTP 401.
- Active Railway commit: NOT_VERIFIED. The GitHub check-runs response lists only GitHub Actions; no Railway status is exposed. No claim is made that the new Railway deployment succeeded.
- Authenticated inventory/isolation verification: NOT_RUN, blocked until the routes are available. Credentials have not been requested in chat and no login session was created.

Next action for the operator: inspect the existing Railway service's automatic deployment for `fbd6f78a8002a02e1d8c853eba08d944b4dda91b`, and report whether it is active or failed (safe status only). Once active, recheck only the blocked inventory routes; then run `scripts/verify-inventory.cjs` locally with the existing Supabase user, `MV Plast` and the already-approved isolation company. Do not create fixtures or repeat migrations. Phase 7 is not yet fully verified online. This release record is committed locally only; there is no second push/deployment.

### Targeted route verification after confirmed Railway deployment

The operator confirmed Railway is running `fbd6f78a8002a02e1d8c853eba08d944b4dda91b`. Only the three previously blocked routes were retested against the public Railway address, without authentication:

- `inventory/balances`: HTTP 401 — PASS.
- `inventory/entries`: HTTP 401 — PASS.
- `inventory/owners`: HTTP 401 — PASS.

This resolves the earlier 404 route-availability blocker. Existing successful CI, migration and health tests were not repeated. No deployment, migration, hosted configuration or business data was changed.

Remaining gate: operator runs the existing `scripts/verify-inventory.cjs` with credentials entered locally and hidden. Use company `MV Plast` and the existing approved isolation company `b64edd83-ef7d-4fa9-93a0-424863a77cec`. Expected final result is `PHASE_7_READ_ONLY_VERIFICATION: PASS`; an absent existing journal entry is explicitly NOT_RUN, not a fabricated pass. Await actual output before Phase 7 sign-off. This documentation update is local only.

## Final Phase 7 sign-off

Evidence source: the operator's reported result from the existing online verification script; no tests were repeated for this documentation update.

`PHASE_7_READ_ONLY_VERIFICATION: PASS`

The operator confirms successful real login, session handling, inventory permissions, balances/entries/owners read access, response company scope, not-found behavior and cross-company isolation. Together with the already recorded passing database, API, concurrency, browser, build and runtime checks, this closes the remaining Phase 7 verification gate.

Expected exclusion, preserved exactly:

`INVENTORY_EXISTING_ENTRY: NOT_RUN (no existing entry; no fixture created)`

No existing hosted journal entry was available for the detail check. This remains NOT_RUN; it is not counted as a pass. No fixtures were created. The hosted verification was read-only for business data; it does not claim hosted posting or concurrency coverage. Posting, rollback, immutable history and concurrency are covered by the previously recorded automated tests.

Phase 7 is now closed. No new code, test runs, migrations, pushes, deployments or resource changes were performed for this sign-off. This final documentation is saved in a local commit on `phase7-inventory`; publishing that commit is a separate action under the economic rule. Hosted photos remain disabled. Phase 8 requires explicit user approval.
