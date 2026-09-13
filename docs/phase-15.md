# Phase 15 — Finished goods and individual handling units

Status: implementation on `phase15-finished-goods`, from verified main `2ef92c1`. Verification in progress; hosted migration applied once; no main deployment yet. Photos remain disabled hosted. Phase 16 is not started.

## Scope and behavior

Production registration remains separate from inventory delivery. An order can deliver registered good output incrementally while running, during reconciliation, or after completion. Deliveries across every owner and location cannot exceed the net good registration total. No material or packaging is consumed again. Existing completed orders are not rewritten.

Each immutable delivery records the original product/unit/order/packing snapshot, production date, selected stock owner and storage location, actor/time and a unique journal reference. Ownership may be internal or external. One delivery is either loose goods or one individually identified full/partly filled pallet. Multiple pallets use separate deliveries with their own identities. The existing frozen order packing and overrides remain the packing basis. Pallet type, a concrete handling unit and future pallet debt are separate concepts; no pallet-debt transaction is created.

A generated `PAL-<UUID>` is stable and unique per company. The handling unit retains its delivery/order link and derives its quantity, owner, product, production date and packing from that delivery. The list supports search, pagination, current location and movement history. No QR scanner or label integration is introduced before Phase 16. Splitting/repacking already delivered pallets is not part of this phase; partial pallets can be delivered initially.

Reasoned full delivery reversals append a new document and debit stock atomically. Moved pallets must return to their original delivery location first; an inactive pallet cannot move. Insufficient loose stock blocks reversal. A production-registration correction cannot reduce good quantity below delivered quantity. Completed-order output corrections preserve the original closure and consumption evidence.

## Integrity and access

Migration `20260913193539_phase_15_finished_goods.sql` adds `production_deliveries`, `handling_units`, `handling_unit_moves`, company-safe FKs, history indexes, RLS and limited grants. New permissions are `production.deliver` and `production.delivery.correct`; reads require production.read + inventory.read. Whole-pallet moves additionally require inventory.transfer. Frontend creation pickers use existing masterdata.read access.

Runtime cannot modify journals, handling-unit projections, snapshots, entry IDs or actor/time fields. Private NOLOGIN-owner triggers check company, session, revocation and permissions, derive historical fields, and write through the existing inventory posting trigger. New inventory kinds require their private-created source documents; generic journal insert cannot forge an output. Internal functions have fixed search paths and no PUBLIC/browser/runtime EXECUTE grants.

Order locks serialize deliveries against production registration, closure and pallet moves. Existing SERIALIZABLE transactions retry serialization/deadlock failures; idempotency collisions retry only recognized command keys and require matching payloads. Identified pallet stock is protected from generic balance debits: a balance cannot fall below its active pallet allocation. Full pallet moves update location and balanced inventory postings together; failure rolls back both. No negative stock or second editable stock store.

## API and UI

Order `/deliveries`: GET history, GET `/summary`, GET `/:id`, POST delivery, POST `/:id/reverse`.
Company `/handling-units`: GET paginated search, GET `/:id`, GET/POST `/:id/moves`.

Production page: good/delivered/remaining quantities, explicit delivery confirmation, stock owner/location/pallet type/date/comment, history and reasoned reversal. Pallet page: searchable identified stock and full-pallet movement. Uncertain write responses retain the same command/key; inputs lock until retry succeeds. No visual redesign.

## Verification and release

Existing tests are the baseline; new coverage exercises partial output, retries, overdelivery, registration floors, owner/packing snapshots, whole-pallet movement, generic-debit protection, reversals, role/tenant boundaries, forgery and post-closure delivery without repeat consumption. Real PostgreSQL concurrency coverage is added to the existing disposable CI database. Browser tests cover read-only controls, delivery confirmation/retry and reversal/retry across desktop/tablet/mobile.

`node scripts/verify-finished-goods.cjs` is a hidden-input, business-GET-only hosted helper. It never creates fixtures or prints secrets. Expected final result: `PHASE_15_READ_ONLY_VERIFICATION: PASS`. Absent existing production orders, deliveries or handling units are recorded as NOT_RUN, never inferred as positive reads. Hosted writes are not tested by that helper.

The Supabase [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) was consulted for policy/grant separation. No Supabase SDK/API change or new dependency is needed.

All infrastructure and workflows are unchanged. Local tests are zero external cost. Existing standard public-repository GitHub Actions are used for working-branch CI; no main deployment is requested by working-branch verification. Hosted migration and main publication must satisfy the economic rule before execution. Main push/automatic Railway deployment cannot currently be confidently bounded at 1 DKK: prior expected one-off usage 0–0.30 DKK, realistic worst-case 1–3 DKK depending on compute time, deployment overlap and included credits. No new ongoing resource allocation is proposed. Do not apply migrations twice or reset hosted data.


## Hosted migration and local verification checkpoint

Local check passes: 192 unit/API/database/helper tests, typecheck and build. Eleven real PostgreSQL tests are delegated to unchanged CI and have passed in run `34778037294`; browser/runtime steps remain pending. New browser coverage includes the pallet navigation entry and whole-pallet movement retry.

Existing Supabase organization confirmed Free; database size before migration 13,642,899 bytes; Phase 15 absent. Applied once at expected 0 DKK as version `20260913193539`. Local filename aligned to hosted history by rename only; SQL unchanged. RLS, browser denial, protected snapshot/history/projection and private writer EXECUTE denial all PASS. Delivery count is zero; no hosted business fixtures created. No new security advisory: existing [default-deny private location-lock RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remain unchanged. No paid setting enabled.

Do not apply the migration again. Main and authenticated online sign-off remain pending. Photos remain disabled; Phase 16 has not started.
