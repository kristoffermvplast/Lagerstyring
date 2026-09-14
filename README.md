# Lagerstyring

Webbaseret lager- og produktionssystem. **Fase 1–16 er afsluttet. Fase 17 implementeres.**

**Fase 1 er afsluttet og godkendt.** Se [det endelige Railway/Supabase-resultat](docs/phase-1-completion.md).

React + TypeScript + Vite → NestJS → Supabase PostgreSQL. Supabase Auth anvendes i Fase 2; Storage-funktioner tilføjes i senere faser.

## Åbn lokalt

Installér Git og Node.js 24 med npm 11. Kør i en terminal:

```bash
git clone https://github.com/kristoffermvplast/Lagerstyring.git
cd Lagerstyring
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run dev
```

Åbn **http://localhost:5173**. API: http://localhost:3001/api/health/live. Teknisk API-dokumentation: http://localhost:3001/api/docs.

Grundlayoutet kan åbnes uden databasehemmeligheder. API-liveness svarer da 200, mens database-readiness på `/api/health/ready` korrekt svarer 503. Det er ikke bevis for en fungerende hosted databaseforbindelse.

For en faktisk databaseforbindelse: følg [miljø- og databasevejledningen](docs/environments.md). Se [Fase 2](docs/phase-2.md) for login, rettigheder, konfiguration og afgrænsninger. Lager-/produktionsfunktioner er ikke implementeret.

## Test og build

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm test` bygger API'et og tester konfiguration, HTTP-grænser og migrationens rettigheder i en isoleret PostgreSQL-motor (PGlite). Browser-tests dækker desktop, tablet og mobil. Fuld lokal Supabase kræver Docker; `npm run db:start` starter den.

## Dokumentation

- [Arkitektur og faste principper](docs/architecture.md)
- [Miljøer, Supabase-forbindelse og drift](docs/environments.md)
- [Fase 1: leverance, filer og begrænsninger](docs/phase-1.md)
- [Fase 1-verifikation](docs/verification.md)
- [Fase 2: authentication og adgang](docs/phase-2.md)
- [Fase 2-testresultater](docs/phase-2-verification.md)

Fase 1–15 er afsluttet. Fase 6 har brugerbekræftet `PHASE_6_READ_ONLY_VERIFICATION: PASS`; kontrol af en eksisterende placering er forventet NOT_RUN, da ingen fandtes. Se verifikationsstatus nedenfor. Den gældende økonomiske grænse er højst 1 kr. i forventet merudgift pr. konkret handling, når det kan vurderes med rimelig sikkerhed; ellers kræves særskilt godkendelse. Ingen varige ressourceforøgelser uden godkendelse. Fase 7 har brugerbekræftet `PHASE_7_READ_ONLY_VERIFICATION: PASS`; eksisterende lagerpostering er forventet NOT_RUN, da ingen fandtes. Fase 8 er afsluttet med brugerbekræftet `PHASE_8_READ_ONLY_VERIFICATION: PASS`. Kontrol af eksisterende modtagelse er forventet NOT_RUN, da ingen fandtes, og ingen fixture blev oprettet. Se [modtagelse og endelig verifikation](docs/phase-8.md). Foto forbliver deaktiveret hosted. Fase 9–13 er afsluttet; Fase 14 implementeres; Fase 15 er ikke startet.

- [Fase 6: hierarkiske lagerplaceringer](docs/phase-6.md)
- [Fase 6: verifikation og publicering](docs/phase-6-verification.md)

### Phase 7 inventory foundation

Implementation and final verification: [docs/phase-7.md](docs/phase-7.md). Phase 7 is complete: hosted migration, approved main release, route checks and operator-reported authenticated read-only verification pass. The existing-entry detail check is explicitly NOT_RUN because no entry existed; no fixture was created. Inventory uses tenant-scoped ownership, append-only corrections and nonnegative decimal balances; Phase 8 receiving extends this foundation; see [current status](docs/phase-8.md).

### Phase 9 stock transfers

[Implementation and verification status](docs/phase-9.md). Phase 9 is complete with operator-reported `PHASE_9_READ_ONLY_VERIFICATION: PASS`. `TRANSFER_EXISTING_RECORD` remains expected NOT_RUN because no transfer existed and no fixture was created. Hosted verification was read-only. Phase 10 is complete; Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete. Hosted photos remain disabled.

### Phase 10 production order planning

[Implementation and verification status](docs/phase-10.md). Drafts, planning, frozen BOM/packing snapshots and exact requirements; no production stock movements. Phase 10 implementation and automated tests pass (135 unit/API/database, 6 concurrency, 96 browser); hosted migration is applied. Railway is operator-confirmed at `5141e420ddd026f076a78731e71f08c4ee9b72ec`; readiness is verified HTTP 200 and anonymous production-order routes return 401. Phase 10 is complete with operator-reported `PHASE_10_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, production-order reads, response scope, not-found behavior and company isolation passed. `PRODUCTION_ORDER_EXISTING_RECORD` is expected NOT_RUN because no order existed and no fixture was created. Hosted verification was read-only; write coverage remains the previously documented automated tests. Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete; hosted photos remain disabled.

### Phase 11 material to production

[Implementation and verification status](docs/phase-11.md). Order-linked material issues reuse atomic inventory transfers, preserve ownership and total physical stock, and do not record consumption. Includes immutable order/machine snapshots, idempotent retries, production permissions and protection against replanning with outstanding issues. Automated verification passes (146 unit/API/database/helper tests, 7 real PostgreSQL concurrency tests, 102 browser tests). Hosted migration `20260913125931_phase_11_material_issue` is applied and database boundaries verified. Released on main and operator-confirmed Railway commit `b992b6f4791a00f99c247ef3d6a12f6fface2845`. Phase 11 is complete with operator-reported `PHASE_11_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, production-order reads, material-issue access boundaries, not-found behavior and company isolation passed. `MATERIAL_ISSUE_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive reads of an existing order’s material issues and hosted writes were not exercised; their coverage remains the previously recorded automated tests. Photos remain disabled hosted. Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete.


## Phase 12 production registration

[Implementation and verification](docs/phase-12.md). Incremental good production, exact totals/progress, immutable snapshots and reasoned reversal. Production recording is separate from inventory delivery and consumption. Automated verification PASS: 155 unit/API/database/helper tests, 8 PostgreSQL concurrency tests and 108 browser tests. Phase 12 is complete with operator-reported `PHASE_12_READ_ONLY_VERIFICATION: PASS` on confirmed Railway commit `28637bc708d952f39c9f62f6568722493f3e9906`. Login, session, permissions, production-order reads, registration access boundaries, not-found behavior and company isolation passed. `PRODUCTION_REGISTRATION_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive registration list/summary/detail reads for an existing order and hosted writes were not exercised; previously documented automated tests remain their coverage. Photos remain disabled hosted. Phase 13 is complete; Phase 14 is complete; Phase 15 is complete.

## Phase 13 — material return and production closure

See [Phase 13 scope and verification](docs/phase-13.md). Implementation continues main `e7eb62b`; Automated CI verification passes (164 tests, nine PostgreSQL concurrency tests and 117 browser tests); hosted migration and approved main release are complete; operator-reported `PHASE_13_READ_ONLY_VERIFICATION: PASS` completes online sign-off. Login, session, permissions, production-order reads, close review/returns/result access boundaries, not-found behavior and company isolation passed. `PRODUCTION_CLOSE_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive close reads for an existing order and hosted writes were not exercised; the recorded automated tests remain their coverage. Material return is linked to the original issue; confirmed closure consumes the net issued amount once without creating finished stock or treating differences as physical waste. Phase 14 is complete; Phase 15 is complete. Photos remain disabled hosted.

## Phase 14 — material differences and measured waste

See [Phase 14 implementation and verification](docs/phase-14.md). Exact theoretical/difference calculations, separate immutable measured-waste observations and reversals, company-scoped analysis history with period/material/product/machine/customer filters. No additional inventory consumption. Automated verification PASS: 181 unit/API/database/helper tests, ten PostgreSQL concurrency tests and 129 browser tests. Hosted migration is applied once; main publication is verified at `77b2e1c`; all four anonymous route checks pass with HTTP 401; operator-reported `PHASE_14_READ_ONLY_VERIFICATION: PASS` completes online verification. Login, session, permissions, production-order reads, waste-analysis access boundaries, material trend, not-found behavior and company isolation passed. `MATERIAL_ANALYSIS_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected; positive existing-order reads and hosted writes retain automated-test coverage. Photos remain disabled hosted; Phase 15 is complete.


## Phase 15 — finished-goods deliveries and individual pallets

See [Phase 15 implementation and verification](docs/phase-15.md). Incremental registered-good output enters the existing stock journal with preserved order/owner/unit/packing evidence. Individual pallets have protected stock allocations, whole-pallet moves and history; reasoned reversals cannot invalidate production totals or create negative stock. Automated verification PASS: 192 unit/API/database/helper tests, 11 real PostgreSQL concurrency tests and 141 browser tests. Hosted migration is applied once and database boundaries verified. Main/Railway `554937b273d846a6fcc6ef4ceb1a420fb26b4ef8` is verified. Operator-reported `PHASE_15_READ_ONLY_VERIFICATION: PASS` completes Phase 15 online sign-off. Login, session, permissions, production orders, finished-goods and handling-unit access, not-found behavior and company isolation passed. Expected `HANDLING_UNIT_EXISTING_RECORD: NOT_RUN` and `FINISHED_GOODS_ORDER_FIXTURE: NOT_RUN` reflect absent existing records; no fixtures were created. Positive existing-record reads and hosted business writes retain automated-test coverage. Photos remain disabled hosted; Phase 16 is complete.


## Phase 16 — QR labels and scanning

See [Phase 16](docs/phase-16.md). Local QR labels for pallets, locations, orders and machines; camera or keyboard scanning into existing authenticated workflows. Strict company/type validation, explicit stock confirmation, no QR service or migration. Automated verification PASS: 200 unit/API/helper, 11 PostgreSQL concurrency and 159 browser tests. Main publication is verified at `94f3789479e67247287c53fd302007716bbabf60`. Operator-reported `PHYSICAL_QR_CAMERA_SCAN: PASS`: the QR displayed and scanned with a real camera, found the correct record, and triggered no automatic stock/data change. Phase 16 is complete. Physical keyboard-scanner/printer checks remain NOT_RUN; camera lifecycle and other device combinations are covered only as specified in the phase report. Photos remain disabled hosted; Phase 17 has not started.


## Phase 17 — Reservations

See [Phase 17](docs/phase-17.md). Separate reserve/release events protect available stock without changing physical inventory. Supports loose stock and individual pallets, owner/location boundaries, exact quantities, immutable history and idempotent retries. Existing debit and pallet workflows protect active reservations. NestJS permissions/RLS remain authoritative. Hosted migration, main publication and online sign-off are recorded in the phase report. Photos remain disabled hosted; Phase 18 has not started.
