# Phase 7 — Inventory foundation

Status: implemented locally from main `9845d19`; hosted migration, push, deployment and online verification are pending. Phase 8 is not started. Hosted photos remain disabled.

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
- Real concurrent connections: NOT_RUN locally. PGlite's single connection is not concurrency evidence. `tests/inventory-concurrency.test.ts` uses a rendezvous to start competing SERIALIZABLE transactions with overlapping snapshots; it checks duplicate-key replay and competing debits against 500 units. Existing GitHub CI is configured to run it in a temporary PostgreSQL container on its existing runner; no hosted database/service is added. CI results are still pending.

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

Pending migration: `supabase/migrations/20260912000000_phase_7_inventory.sql`. It creates four tables, two permissions, constraints, indexes, policies and posting triggers. It creates no business records, environments or paid resources. No hosted migration has been run in this work session.

Before release: pass the real PostgreSQL/browser gates; check hosted plan/quota and migration list; apply this migration once with the privileged migration connection; verify runtime grants/RLS and security advisors. Do not use the privileged connection for NestJS. Readiness now requires `app.stock_balances`, so the migration must precede the backend release.

After an approved normal push/deployment, check live/readiness, the deployed commit and anonymous 401 for `/api/companies/<company UUID>/inventory/balances`, `/entries` and `/owners`. Run `node scripts/verify-inventory.cjs` interactively with the existing user and approved isolation company. It hides inputs, prints only safe statuses, makes no business writes and cleans up its Supabase session. Expected empty-data status: `INVENTORY_EXISTING_ENTRY: NOT_RUN (no existing entry; no fixture created)`. Do not claim hosted write/concurrency coverage from that read-only result.

Phase 7 is not signed off until remaining verification is recorded. Do not start Phase 8.
