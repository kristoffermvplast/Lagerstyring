# Lagerstyring

Webbaseret lager- og produktionssystem. **Fase 1–23 er funktionelt afsluttet inden for det dokumenterede og brugeraccepterede testomfang. Fase 23-felt-/menurettelser og diagnostik er fortsat lokale, ikke publiceret. Fase 24 er ikke startet.**

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

For en faktisk databaseforbindelse: følg [miljø- og databasevejledningen](docs/environments.md). Se [Fase 2](docs/phase-2.md) for login, rettigheder, konfiguration og afgrænsninger. Aktuel funktionalitet og verifikationsstatus er beskrevet under de enkelte faser.

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

See [Phase 16](docs/phase-16.md). Local QR labels for pallets, locations, orders and machines; camera or keyboard scanning into existing authenticated workflows. Strict company/type validation, explicit stock confirmation, no QR service or migration. Automated verification PASS: 200 unit/API/helper, 11 PostgreSQL concurrency and 159 browser tests. Main publication is verified at `94f3789479e67247287c53fd302007716bbabf60`. Operator-reported `PHYSICAL_QR_CAMERA_SCAN: PASS`: the QR displayed and scanned with a real camera, found the correct record, and triggered no automatic stock/data change. Phase 16 is complete. Physical keyboard-scanner/printer checks remain NOT_RUN; camera lifecycle and other device combinations are covered only as specified in the phase report. Photos remain disabled hosted; Phase 17 is complete.


## Phase 17 — Reservations

See [Phase 17](docs/phase-17.md). Separate reserve/release events protect available stock without changing physical inventory. Supports loose stock and individual pallets, owner/location boundaries, exact quantities, immutable history and idempotent retries. Existing debit and pallet workflows protect active reservations. NestJS permissions/RLS remain authoritative. Hosted migration, main publication and online sign-off are recorded in the phase report. Photos remain disabled hosted; Phase 18 has not started.

Phase 17 is complete with operator-reported `PHASE_17_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, reservation reads, not-found behavior and company isolation passed. Expected `RESERVATION_EXISTING_RECORD: NOT_RUN (no existing reservation; no fixture created)` means positive hosted detail/history reads were not exercised; previously recorded automated tests remain their coverage. Hosted reserve/release writes are not claimed by this read-only verification.

## Fase 18 — forsendelser

Implementeret og CI-verificeret på arbejdsbranchen i `afbd7c0`: 217 automatiske tests, 13 PostgreSQL-samtidighedstests og 174 browserprøver består. Hosted Fase 18-migration er kørt én gang og adgangsgrænserne verificeret. Main/Railway er verificeret på `afbd7c0`. Fase 18 er afsluttet med brugerbekræftet `PHASE_18_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, forsendelser, not-found-adfærd og virksomhedsisolation består. `SHIPMENT_EXISTING_RECORD: NOT_RUN` er forventet, da ingen forsendelse fandtes, og ingen fixture blev oprettet. Se [Fase 18](docs/phase-18.md) for workflows, migrations- og teststatus. Foto forbliver deaktiveret hosted. Fase 19-status fremgår nedenfor.

## Fase 19 — pallemellemværender

[Leverance og verifikation](docs/phase-19.md): separate saldi pr. modpart og genbrugstype, historik, modpostering og automatisk bogføring af angivet genbrugsemballage ved afsendelse. Fase 19 er afsluttet: CI består, migrationen er verificeret, og `5e429fa` er publiceret på main og verificeret aktiv på Railway. Brugerbekræftet `PHASE_19_READ_ONLY_VERIFICATION: PASS` dækker login, session, permissions, pallebalancer, posteringernes liste, response scope, not-found-adfærd og virksomhedsisolation. `PALLET_ACCOUNT_EXISTING_RECORD: NOT_RUN` er forventet ved tom historik; ingen fixture blev oprettet. Fysisk lager forbruges ikke igen. Fase 20-status fremgår nedenfor.


## Fase 20 — optælling

[Leverance og verifikation](docs/phase-20.md): optælling pr. vare/ejer/placering, godkendte differencer og bevægelseskontrol. Reservationer og identificerede paller forbliver beskyttede. CI består på arbejdsgrenen i `80f1093`: 236 unit/API/database-tests, 17 PostgreSQL-samtidighedstests og 189 browsertests samt build/runtime/TLS. Fase 20 er afsluttet: hosted migration er kørt og kontrolleret, og `80f1093` er verificeret aktiv på main/Railway. Seks anonyme ruter svarer 401. Brugerbekræftet `PHASE_20_READ_ONLY_VERIFICATION: PASS` dækker login, session, permissions, optællingsliste, response scope, not-found-adfærd og virksomhedsisolation. `STOCK_COUNT_EXISTING_RECORD: NOT_RUN` er forventet ved tom historik; ingen fixture blev oprettet. Foto er fortsat deaktiveret hosted. Fase 21-status fremgår nedenfor.


## Fase 21 — dashboard og advarsler

[Leverance og verifikation](docs/phase-21.md): rettighedsstyret overblik med kritiske advarsler, aktive produktioner, dagens modtagelser/forsendelser, kommende materialemangel og direkte handlinger. Personlige kvitteringer følger den konkrete problemversion; løsning afledes af kildedata. CI består på `4fd3db9`: 249 unit/API/database-tests, 18 PostgreSQL-samtidighedstests og 198 browsertests samt build/runtime/TLS. Hosted migration er kørt én gang, og `4fd3db9` er verificeret på main og aktiv i Railway. Readiness svarer 200; de to anonyme dashboard-ruter svarer 401. Brugerbekræftet `PHASE_21_READ_ONLY_VERIFICATION: PASS` dækker login/session, dashboard permissions/read, response scope, alert shape, virksomhedsisolation og session cleanup. `DASHBOARD_COMPLETENESS: PASS`. Fase 21 er afsluttet inden for det dokumenterede verifikationsomfang. Foto forbliver deaktiveret hosted. Fase 22 (rapporter og eksport) er implementeret og CI-verificeret på arbejdsgrenen; hosted migration, publicering og online-verifikation afventer.

- [Fase 22: rapporter, sporbarhed og CSV-eksport](docs/phase-22.md)

- [Fase 23: mobil-/tabletbetjening og brugerafprøvning](docs/phase-23.md)

Fase 23 er afsluttet efter brugerafprøvning på Mac/iPhone: `access`-500 er `NOT_REPRODUCED` under efterfølgende normal brug, ikke erklæret rettet; diagnostikken bevares. Fysisk tablet er `NOT_RUN`, og tidligere fysisk QR-opslag genbruges. Se [afsluttende accept og begrænsninger](docs/phase-23.md). Krav til færre standardfelter og samlet senere UI/UX-forenkling er registreret dér.

## Fase 24 — import

[Implementering og verifikation](docs/phase-24.md): import af kunder, leverandører, varer, materialer og startbeholdninger med minimale CSV-skabeloner, forhåndsvisning, rækkefejl, dubletkontrol og atomisk bekræftelse. Startbeholdninger bruger den eksisterende lagerjournal. Excel-ark gemmes som CSV UTF-8; native XLSX-import er ikke implementeret. CI består på arbejdsgrenen `phase24-import-export` i `9437c79`: 286 unit/API/database-tests, 21 PostgreSQL-samtidighedstests og 231 browserprøver samt build/runtime/TLS. Fase 24 er afsluttet: migrationen er kørt én gang, `9437c79` er verificeret på main og aktiv på Railway, og brugerbekræftet `PHASE_24_READ_ONLY_VERIFICATION: PASS` dækker login/session, importrettigheder, alle fem typers skabeloner og historik, response scope/shape, virksomhedsisolation, not-found og session cleanup. `IMPORT_PREVIEW_AND_CONFIRM: NOT_RUN` er forventet ved læsebaseret online-verifikation; oprettelse og importskrivninger er dækket af CI. Foto forbliver deaktiveret hosted. Fase 25 er afsluttet som beskrevet nedenfor.

## Fase 25 – Forecasting-grundlag

[Implementering og verifikation](docs/phase-25.md): læsebaseret prognosescenarie pr. vare og lagerejer med forventede ubogførte leverancer, nettobehov fra valgte produktionsordrer og automatiske forsendelsesbehov. Reservationer modregnes én gang; allerede udleveret materiale genbruges ikke som frit lager eller nyt behov. Sporbar JSON-download. CI består på `phase25-forecast` i `804fc57`: 302 unit/API/databasetests, 21 PostgreSQL-samtidighedstests og 240 browserprøver samt build/runtime/TLS. Main og normal automatisk Railway-deployment er verificeret på `804fc57`; health svarer 200 og forecast-ruter afviser anonym adgang med 401. Fase 25 er afsluttet med brugerbekræftet `PHASE_25_READ_ONLY_VERIFICATION: PASS`: login/session, forecast permissions, options read, scope/shape, virksomhedsisolation, not-found og session cleanup består. `FORECAST_EXISTING_RECORD_PREVIEW: NOT_RUN` (ingen eksisterende vare/ejer) og `FORECAST_COMPLEX_SCENARIOS: NOT_RUN` (ingen hosted fixtures) er forventede; previewberegninger og komplekse scenarier har lokal/CI-dækning, ikke en påstået hosted beregningsprøve. Ingen migration. Foto forbliver deaktiveret hosted. Fase 26 er ikke startet.

## Fase 26 – Samlet integrationstest og driftsklarhed

Se [fasebeskrivelse](docs/phase-26.md) og [drifts-/gendannelsesplan](docs/operations.md). Arbejdsgren fra `ec84bd5`: tværgående HTTP-forløb, adgangsgrænser, afgrænset lokal belastning og separat native PostgreSQL-gendannelse. CI består på `phase26-operations` i `261fc75`: 305 almindelige tests, 21 PostgreSQL-samtidighedstests, 5 native driftsprøver og 240 browserprøver samt build/runtime/TLS. Lokal belastning og separat database-/rollegendannelse består. Hosted eksport og isoleret lokal databasegendannelse er nu brugerbekræftet PASS (2026-09-22–23): 88 tabeller, 87 COPY-datablokke med 405 rækker og 2 sekvenstællere matcher backupen. Backup og rolleafbildning uden passwords er kopieret til privat FileVault-krypteret opbevaring på Mac; SHA-256 er verificeret. Lokal Colima-instans er stoppet. Dette er en databaseprøve, ikke hosted-til-hosted restore eller en ny login-/applikationsprøve efter restore. Se fasebeskrivelsen for begrænsninger. Pilotadgangen er nu afklaret som eksisterende lokal HTTPS; løbende backupansvar/frekvens/retention er fortsat driftsopfølgning, ikke påstået etableret. Ingen migration, hosted ressourceændring eller UI/UX-redesign. Foto forbliver deaktiveret hosted.

Fase 26 er **afsluttet 2026-09-23 inden for det brugeraccepterede omfang**. Frontendpilotadgangen er den eksisterende Mac-frontend via lokal mkcert HTTPS på samme betroede Wi-Fi med lokal backend. Mac og frontend/backend-processer skal være tændt, og testenheder skal have tillid til testcertifikatet. Tidligere fysisk iPhone-/QR-evidens fra Fase 23 genbruges; ingen ny test eller aktuel build-/tilgængelighedsverifikation påstås. Offentlig frontendadresse og adgang uden for netværket er ikke del af denne pilot. Backupresultatet fra `8665ed0` bevares: login/applikationsadgang efter faktisk restore ikke testet, Storage-filer ikke omfattet og ingen separat off-device backup. Ingen ny hosting/deployment eller ekstern merudgift ved denne dokumentationsafslutning. Foto forbliver deaktiveret hosted. UI/UX-redesign og nye faser kræver særskilt godkendelse.

## UI/UX-forenkling

[Etape 1 — navigation og fælles formularprincipper](docs/ux-stage-1.md) er implementeret og målrettet testet lokalt fra `70336e0`. Backend og datamodel er uændrede. Etape 1 er senere publiceret som `afd97b1`.

[Etape 2 — enkel oprettelse af stamdata](docs/ux-stage-2.md) er implementeret lokalt på `ux-stage2`. Kun kunder, leverandører, varer og materialer er forenklet. Etape 2 er publiceret på `198c326`.

[Etape 3 — lagerhandlinger med færre gentagne valg](docs/ux-stage-3.md) er genimplementeret fra `198c326` på den lokale gren `ux-stage3-rebuilt`. Samlet beholdningsvalg, kontrollerede standardværdier og færre synlige felter. Ingen publicering til main; Etape 4 er ikke startet.
