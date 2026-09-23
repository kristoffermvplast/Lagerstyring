# Godkendt arkitektur

## Status og scope

Master Specification v2.0 og brugerens efterfølgende beslutninger er projektets primære kravgrundlag. Dette dokument beskriver implementeringen af det godkendte Fase 1-fundament. Det erstatter ikke kravene til senere faser.

## Komponenter

- `apps/web`: React/TypeScript/Vite, Tailwind, TanStack Query. Browseren kalder NestJS via `/api`. Ingen Supabase Data API-klient eller databasehemmelighed i frontend.
- `apps/api`: NestJS-modul, konfigurationsvalidering, databaseadapter, liveness/readiness, fejlfilter, eksplicit CORS og standardafvisende guard.
- Supabase PostgreSQL: schemas `app` og `app_private`, tekniske roller og kontrollerede default privileges.
- Supabase Auth: planlagt Fase 2; ingen egen adgangskodedatabase.
- Supabase Storage: planlagt ved første foto-/filfunktion. Private buckets, virksomhedskontrol og kontrollerede uploads.

## Tillidsgrænser

Alle læsninger og ændringer af forretningsdata går gennem NestJS. Ingen direkte browserændringer af stamdata, lager, produktion, reservationer eller forsendelser.

Kun health-handlinger er offentlige i Fase 1. En global guard afviser fremtidige controllers som standard. Health er infrastruktur, ikke login. Fase 2 erstatter afvisningsguarden med verificering af Supabase-token, aktivt medlemskab og konkrete rettigheder. Sikkerhed må ikke baseres på `user_metadata` eller et ubekræftet `company_id` fra browseren.

`app_owner` er en NOLOGIN-rolle, der ejer schemas og fremtidige objekter. Kun migrationsadministratoren kan bruge den. `app_runtime` er en NOLOGIN-rettighedsgruppe. `app_backend` er en begrænset LOGIN-rolle, som arver `app_runtime` og har USAGE på `app`, men ikke CREATE. Den har ingen adgang til `app_private`, ingen BYPASSRLS og ingen administrative rettigheder. Ingen password i migrationen.

Nye tabeller, funktioner og typer skal oprettes som `app_owner`, normalt med `SET LOCAL ROLE app_owner` i migrationstransaktionen. PostgreSQL giver som standard PUBLIC EXECUTE på funktioner; derfor ændres de globale default privileges for netop app_owner. Per-schema REVOKE alene ville ikke fjerne denne globale standard.

`app` og `app_private` må ikke tilføjes som eksponerede Data API-schemas. Browserroller har ingen schemaadgang. Fremtidige forretningstabeller skal få RLS, relevante WITH CHECK/USING-politikker, eksplicitte grants og virksomhedssikre foreign keys i samme migration som tabellen. Der findes ingen forretningstabeller i Fase 1, så tenant-RLS er endnu ikke implementeret eller testet.

Backendens direkte PostgreSQL-forbindelse overtager ikke automatisk Supabase-tokenets identitet. I Fase 2 etableres verificeret bruger- og virksomhedskontekst med transaktionslokale værdier; manglende kontekst skal afvise adgang. Ingen sessionskontekst må lække mellem pooled forbindelser.

## Faste forretningsprincipper til senere faser

1. Ingen hardkodede forretningsdata. Alle relevante kartoteker skal administreres i UI.
2. Multi-company fra første forretningstabel; første UI behøver kun én aktiv virksomhed.
3. Beholdning har eksplicit ejer: egen virksomhed eller ekstern partner.
4. Produktionsstatus: Kladde → Planlagt → Klar → I produktion → Afstemning → Færdig. Problem er separat.
5. Produktionsregistrering og lageraflevering er forskellige hændelser. Delaflevering understøttes.
6. Reservation ændrer disponibelt, ikke fysisk lager.
7. Palletype, handling unit og pallemellemværende er separate begreber.
8. Emballage har én forbrugsansvarlig pr. anvendelse: BOM for produktionskomponenter, pakning for transport-/pakkeemballage.
9. Negativ fysisk beholdning er blokeret. Korrektioner kræver begrundelse og audit.
10. Lager er en uforanderlig journal med atomisk opdaterede, genopbyggelige saldi. Kritiske mængder bruger numeric, ikke floating point.
11. Lagerkritiske handlinger skal låse berørte beholdninger/reservationsområder, genvalidere efter låsning og være idempotente.
12. Stamdataversioner og dokument-snapshots bevarer historiske beregningsgrundlag.
13. Materialedifference er ikke automatisk fysisk spild; afstemning sker pr. materiale.
14. Jobs, outbox, integrationer og notifikationer etableres først ved et konkret behov.

## Produktionsafstemningens fremtidige kontrakt

Nettomaterialeforbrug = udleveret − retur/overført ud − verificeret rest.
Materialedifference = nettomaterialeforbrug − teoretisk forbrug til gode emner.
Uforklaret difference = materialedifference − registreret fysisk spild.
Afslutning skal fratrække allerede bogført forbrug/spild og allerede lagerafleverede færdigvarer, så intet bogføres dobbelt.

## Infrastrukturvalg

Modulær monolit med én database. Ingen mikroservices, køplatform, forretnings-eventbus eller generisk integrationstabel i Fase 1. Separate frontend-/backendprocesser; databasecredentials eksisterer kun server-side. TLS med certifikatverificering er obligatorisk for hosted databaseforbindelser. Development kan bruge loopback uden TLS.

## Fortsættelse

Fase 2: Auth/permissions/tenant-RLS. Derefter stamdata, varer, BOM/pakning, placeringer og lagerkerne i den godkendte rækkefølge. Ingen af disse funktioner er startet her.

## Fase 2-udvidelse (lokal, afventer hosted aktivering)

Supabase Auth, sessionskontrol, medlemskaber, permissions og RLS er implementeret lokalt. Fase 1-afsnittene ovenfor er historisk baseline; PhaseOneGuard er erstattet af standardafvisende AccessGuard og eksplicit AuthRequired. Se [Fase 2](phase-2.md) for den aktuelle adgangsarkitektur, præcise privilegieundtagelser og økonomiske aktiveringsgrænse.


## Fase 3 — stamdata

Fase 2 er afsluttet på main `470b3f9`. Fase 3 udvider den eksisterende NestJS- og RLS-model med typed stamdatakartoteker og immutable audit for runtime. Se [Fase 3](phase-3.md) og [verifikation](phase-3-verification.md). Hosted migration og kodepublicering er gennemført. Fase 3 er afsluttet med bestået online-læseverifikation og virksomhedsisolation; skriveflows og brugerflade er verificeret lokalt. Fase 4 er ikke startet. Tidligere arkitekturstatusafsnit er historiske.

## Fase 4 — vareidentitet og kartoteker

Fra main `ae73038`: fælles `app.items` med tre typer, tenant-sikre stamdatareferencer, præcise decimalstandarder og eksisterende audit/permissions. Fotos er teknisk forberedt via NestJS og privat Supabase Storage, deaktiveret som standard. Se [Fase 4](phase-4.md) og [verifikation](phase-4-verification.md) for implementering, kørselsvejledning og hosted status. BOM/pakning og senere lagerfunktioner er ikke startet.

Fase 4 er afsluttet med brugerbekræftet `PHASE_4_READ_ONLY_VERIFICATION: PASS`. Hosted foto er fortsat deaktiveret; hosted skrivetests er ikke omfattet af online-læseresultatet. Fase 5 er ikke startet.

## Fase 5 — Versionerede styklister og pakning

Fase 5 tilføjer `recipes`, `recipe_revisions` og `recipe_lines` med virksomhedsspecifik RLS, uforanderlige versioner og snapshots samt en BigInt-baseret behovsberegner i NestJS. Aktive BOM-/pakkeopsætninger kan ikke forbruge samme komponent dobbelt. Indlejrede beholdere og tilbehør beregnes uden lagerbogføring. Stamdatarettigheder genbruges; browseren tilgår fortsat kun forretningsdata via NestJS. Ingen nye eksterne ressourcer eller dependencies. Se [Fase 5](phase-5.md) og [aktuel verifikationsstatus](phase-5-verification.md). Fase 5 er afsluttet med brugerbekræftet `PHASE_5_READ_ONLY_VERIFICATION: PASS`. Hosted kontrol af eksisterende publicerede revisioner er forventet NOT_RUN, da der ikke fandtes sådanne revisioner; hosted CRUD er ikke verificeret. Foto er fortsat deaktiveret hosted. Fase 6 er ikke startet.


## Fase 6 — Hierarkiske placeringer

Fase 6 bygger videre fra `51e845b` med virksomhedsspecifikke placeringer, beregnede stier, audit, versionskontrol og en privat skrivelås for samtidige hierarkiændringer. Varer/materialer/emballage får valgfri standardplacering; maskiner får valgfri placering. Der indføres ingen lagerbeholdninger eller lagertransaktioner. Se [leverancen](phase-6.md) og [aktuel verifikationsstatus](phase-6-verification.md). Tidligere fasers slutstatus ovenfor er historik. Fase 7 er ikke startet.

Fase 6 er afsluttet med brugerbekræftet `PHASE_6_READ_ONLY_VERIFICATION: PASS`. `LOCATION_EXISTING_RECORD: NOT_RUN` er forventet, da ingen placeringer fandtes, og ingen fixtures blev oprettet. Hosted læsning af eksisterende stier/historik/underplaceringer og hosted CRUD er ikke verificeret. Foto forbliver deaktiveret hosted. Fase 7 er ikke startet.

## Phase 7 inventory foundation

See [Phase 7](phase-7.md) for the journal, owner/balance dimensions, append-only posting triggers, SERIALIZABLE/idempotent command strategy, permissions, snapshot behavior and completed Phase 7 verification, including the explicitly excluded hosted existing-entry detail check. All inventory routes use NestJS; only its atomic posting path may change physical balances. Receiving and later workflows remain deferred.

## Phase 8 receiving

See [Phase 8](phase-8.md). Receiving uses the immutable inventory journal with one positive line per receipt, typed receipt metadata, supplier snapshots and `inventory.receive` authorization. It reuses the existing atomic balance writer and reversal path. No Phase 9 workflows are included.

Phase 8 is complete with operator-reported `PHASE_8_READ_ONLY_VERIFICATION: PASS`. The existing-receipt detail check remains expected NOT_RUN because no receipt existed and no fixture was created. Hosted verification was read-only; posting and concurrency coverage comes from automated tests. See the final sign-off in [Phase 8](phase-8.md). Hosted photos remain disabled; subsequent Phase 9 status is recorded below.

## Phase 9 stock transfers

[Phase 9](phase-9.md) extends the existing journal with balanced, atomic two-location transfers, unchanged item ownership, `inventory.transfer` authorization and reversible immutable history. No new stock store or infrastructure is introduced. Phase 10 is complete; Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete.

Phase 9 is complete with operator-reported `PHASE_9_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, transfer reads, response scope, not-found behavior and company isolation passed. `TRANSFER_EXISTING_RECORD` remains expected NOT_RUN because no transfer existed and no fixture was created. Hosted verification was read-only; posting and concurrency coverage comes from the previously recorded automated tests. See the final sign-off in [Phase 9](phase-9.md). Hosted photos remain disabled; Phase 10 is complete; Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete.

## Phase 10 production order planning

[Phase 10](phase-10.md) adds tenant-scoped planning documents and immutable order audit. Revision snapshots drive fixed-point requirements, including order-specific packing overrides. `production.read` grants snapshot access; planning additionally requires `production.manage` and `masterdata.read`. SERIALIZABLE transactions, creation idempotency and optimistic versions protect concurrent operations. Internal triggers enforce snapshots, references and supported status transitions. No inventory side effects. Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete; hosted photos remain disabled.

Phase 10 is complete. Previously recorded automated tests and hosted migration `20260913010919_phase_10_production_orders` remain the validation baseline. Railway revision `5141e420ddd026f076a78731e71f08c4ee9b72ec` is operator-confirmed, anonymous order routes return 401 and readiness returns HTTP 200. Actorless readiness checks the permission catalog structure without reading RLS-protected permission rows; no access rules were relaxed. Operator-reported `PHASE_10_READ_ONLY_VERIFICATION: PASS` covers login, session, permissions, production-order reads, response scope, not-found behavior and company isolation. `PRODUCTION_ORDER_EXISTING_RECORD` is expected NOT_RUN: no existing order and no fixture created. Hosted writes were not tested; their coverage remains the recorded automated tests. See [Phase 10 evidence](phase-10.md). Hosted photos remain disabled; Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete.

## Phase 11 material issue

[Phase 11](phase-11.md) links existing balanced inventory transfers to production orders with a company-safe foreign key and immutable order/machine/component snapshot. Existing stock posting, ownership, decimal and RLS boundaries remain authoritative. An additional internal guard serializes issue vs order editing and checks production permissions and revision components. Reversals preserve order attribution; unreversed issues block return to draft. No consumption, production registration, new balance store or infrastructure is introduced. Hosted migration `20260913125931_phase_11_material_issue` and restricted database boundaries are verified; application release is confirmed on Railway commit `b992b6f4791a00f99c247ef3d6a12f6fface2845`. Phase 11 is complete with operator-reported `PHASE_11_READ_ONLY_VERIFICATION: PASS` covering login, session, permissions, production-order reads, material-issue access boundaries, not-found behavior and company isolation. `MATERIAL_ISSUE_ORDER_FIXTURE` is expected NOT_RUN because no order existed and no fixture was created. Positive material-issue reads on an existing order and hosted writes were not exercised; automated tests remain their evidence. Automated CI passes. Readiness checks column availability without actor-dependent permission reads. Photos remain disabled hosted; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is complete.


## Phase 12 production registration

[Phase 12](phase-12.md) adds immutable company-scoped production events with order locking, exact quantities, idempotency, separate recording/correction permissions and RLS. Ready orders can start; running orders cannot return to planning. No stock or consumption side effects. Phase 12 is complete with operator-reported `PHASE_12_READ_ONLY_VERIFICATION: PASS` on confirmed Railway commit `28637bc708d952f39c9f62f6568722493f3e9906`. Login, session, permissions, production-order reads, registration access boundaries, not-found behavior and company isolation passed. `PRODUCTION_REGISTRATION_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive registration list/summary/detail reads for an existing order and hosted writes were not exercised; previously documented automated tests remain their coverage. Phase 13 is complete; Phase 14 is complete; Phase 15 is complete.

## Phase 13 material return and closure

[Phase 13](phase-13.md) adds issue-attributed returns and an immutable reviewed closure. It reuses the stock journal and shared order lock, posts confirmed net consumption once, and atomically closes the order. Production registration and future finished-goods delivery remain separate. Return/closure rights are explicit and manageable through NestJS; stale reviews, cross-company requests and negative stock fail closed. Implementation and automated CI verification are complete; hosted migration and approved main release are complete; operator-reported `PHASE_13_READ_ONLY_VERIFICATION: PASS` completes online sign-off. Login, session, permissions, production-order reads, close review/returns/result access boundaries, not-found behavior and company isolation passed. `PRODUCTION_CLOSE_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive close reads for an existing order and hosted writes were not exercised; the recorded automated tests remain their coverage. Phase 14 is complete; Phase 15 is complete; photos remain disabled hosted.

## Phase 14 material analysis

[Phase 14](phase-14.md) derives exact per-component/unit material differences from order and closure snapshots. Independent immutable waste observations have explicit creation/correction permissions and historical stock references. They never post inventory again. Shared order locking, SERIALIZABLE retries, RLS and column-level runtime grants protect history and company isolation. Operational trend history uses completion dates and keeps incompatible units separate. Automated verification passes (181 unit/API/database/helper, ten PostgreSQL concurrency and 129 browser tests). Hosted migration `20260913174524_phase_14_material_analysis` and its access boundaries are verified. Main publication is verified at `77b2e1c`; all four anonymous route checks pass with HTTP 401; operator-reported `PHASE_14_READ_ONLY_VERIFICATION: PASS` completes online sign-off. Expected `MATERIAL_ANALYSIS_ORDER_FIXTURE: NOT_RUN` means no existing order was available and no fixture was created. Positive existing-order reads and hosted writes retain the recorded automated-test coverage; Phase 15 is complete.


## Phase 15 extension

[Phase 15](phase-15.md) separates production registration from physical finished-stock delivery. Immutable delivery documents and pallet-movement records feed the existing journal atomically; handling units are internal derived location/status projections. Order-level serialization caps deliveries at registered good output and prevents production corrections below delivered stock. The balance writer protects identified pallet quantities from generic debit paths. No repeat material/packaging consumption, pallet-debt accounting, QR workflow or new infrastructure. Runtime writes remain column-limited and tenant-scoped; private triggers derive history. Automated verification passes (192 unit/API/database/helper, 11 PostgreSQL concurrency and 141 browser tests). Hosted migration is applied once and access boundaries verified. Main/Railway `554937b273d846a6fcc6ef4ceb1a420fb26b4ef8` is verified. Operator-reported `PHASE_15_READ_ONLY_VERIFICATION: PASS` completes Phase 15 online sign-off. Login, session, permissions, production orders, finished-goods and handling-unit access, not-found behavior and company isolation passed. Expected `HANDLING_UNIT_EXISTING_RECORD: NOT_RUN` and `FINISHED_GOODS_ORDER_FIXTURE: NOT_RUN` reflect absent existing records; no fixtures were created. Positive existing-record reads and hosted business writes retain automated-test coverage.


## Phase 16 extension

[Phase 16](phase-16.md) adds a frontend QR reference layer on top of existing guarded NestJS reads and confirmed writes. The versioned non-URL payload contains only company, type and immutable UUID. It never grants access or encodes commands. Camera frames and PNG generation stay on-device, using bundled libraries; no storage, API routes, migration, service or permission expansion. Existing tenant and stock invariants remain authoritative. Phase 17 has not started.

Phase 16 automated verification is complete: CI `34880414365` passed 200 unit/API/helper tests, 11 PostgreSQL concurrency tests and 159 browser tests. No new database or backend authorization surface. Main publication is verified at `94f3789479e67247287c53fd302007716bbabf60`. Operator-reported `PHYSICAL_QR_CAMERA_SCAN: PASS` confirms a displayed QR was scanned with a real camera and resolved the correct record without an automatic stock/data change. Phase 16 is complete; physical keyboard-scanner/printer testing remains NOT_RUN. See the phase report for coverage limits.


## Phase 17 extension

[Phase 17](phase-17.md) adds reservation events and protected reservation/balance projections. SERIALIZABLE commands and shared physical-balance writes prevent overreservation against concurrent debits. Loose allocations exclude identified stock; pallet allocations retain the same ownership/location and block movement/reversal until released. All active reservations reduce available, never physical, inventory. Only NestJS can submit events; private database triggers derive state and snapshots under tenant/session checks. Shipment linkage and dispatch remain Phase 18. No new infrastructure.

Phase 17 is complete with operator-reported `PHASE_17_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, reservation reads, not-found behavior and company isolation passed. Expected `RESERVATION_EXISTING_RECORD: NOT_RUN (no existing reservation; no fixture created)` means positive hosted detail/history reads were not exercised; previously recorded automated tests remain their coverage. Hosted reserve/release writes are not claimed by this read-only verification. Photos remain disabled hosted; Phase 18 has not started.

## Phase 18 extension

[Phase 18](phase-18.md) adds shipment command history, protected document projections and company-qualified reservation links. Dispatch atomically releases its reservations, retires shipped handling units and posts the existing immutable physical journal once. Explicit read/manage/dispatch permissions, RLS, idempotency and optimistic versions preserve tenant and history boundaries. Packing snapshots are descriptive and do not consume packaging twice. CI run `34961142635` passes on `afbd7c0`: 217 unit/API/database/helper tests, 13 real PostgreSQL concurrency tests and 174 browser tests, plus build/runtime TLS diagnostics. Hosted migration `20260915113708_phase_18_shipments` and its access boundaries are verified. Main/Railway commit `afbd7c0` is verified; all nine anonymous shipment routes return 401. Phase 18 is complete with operator-reported `PHASE_18_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, shipment reads, not-found behavior and company isolation passed. Expected `SHIPMENT_EXISTING_RECORD: NOT_RUN (no existing shipment; no fixture created)` means positive hosted detail/history/packing reads were not exercised. Hosted business writes are not claimed; previously recorded automated tests remain their coverage. Photos remain disabled hosted; see Phase 19 status below.

## Phase 19 extension

[Phase 19](phase-19.md) adds immutable reusable-packaging debt entries and authorized command events. Balances are sums per tenant/counterparty/type, independent of physical inventory and handling units. Versioned draft-shipment declarations generate debt atomically on dispatch without consuming packaging again. RLS, column-limited grants, exact idempotency and one-time reversals preserve company and history boundaries. Phase 19 is complete: prior CI passed, hosted migration was verified, and main/Railway implementation `5e429fa` is verified. Operator-reported `PHASE_19_READ_ONLY_VERIFICATION: PASS` covers login/session, permissions, balance and entry-list reads, response scope, not-found behavior and company isolation. Expected `PALLET_ACCOUNT_EXISTING_RECORD: NOT_RUN` reflects an empty journal; positive hosted entry-detail reads and business writes are not claimed. No hosted fixture was created. Photos remain disabled hosted. See Phase 20 status below; no resource changes.


## Phase 20 extension

[Phase 20](phase-20.md) adds count sessions and immutable commands with role-separated approval. A monotonic physical-balance revision rejects stale and net-zero intervening movements. Short SERIALIZABLE transactions post only an approved delta through the existing journal, preserving reservation and identified-pallet guards. No locks span operator counting time. CI passes on working-branch commit `80f1093`: 236 unit/API/database/helper tests, 17 real PostgreSQL concurrency tests and 189 browser tests, plus builds/runtime/TLS. Phase 20 is complete within the documented verification scope. Hosted migration is applied and checked; main/Railway commit `80f1093` is verified, with six anonymous routes returning 401. Operator-reported `PHASE_20_READ_ONLY_VERIFICATION: PASS` covers login/session, permissions, count-list reads, response scope, not-found behavior and company isolation. Expected `STOCK_COUNT_EXISTING_RECORD: NOT_RUN` reflects empty count history; positive hosted detail reads and business writes are not claimed. No hosted fixture was created. Photos remain disabled hosted. See Phase 21 status below; no resource changes.


## Phase 21 extension

[Phase 21](phase-21.md) adds a permission-filtered dashboard assembled in one short SERIALIZABLE transaction. All sources retain their existing read permissions and tenant RLS. New dashboard.read and dashboard.acknowledge permissions expose no additional source access. Personal immutable acknowledgements store only source keys, fingerprints and server identities/timestamps; they never update inventory or operational status. Current alerts are recomputed before acknowledgement; stale fingerprints conflict, identical acknowledgements are idempotent. Resolved history requires a complete scan and accessible existing source. Source lists are bounded and partial results are explicit. Snapshot requirements use exact fixed-point arithmetic against company-owned unreserved stock, in planned-start/deadline order; the result is indicative and does not allocate stock. Danish calendar-day filtering uses Europe/Copenhagen. No hosted migration or configuration is changed by local implementation. CI passes on `4fd3db9`: 249 unit/API/database/helper tests, 18 real PostgreSQL concurrency tests and 198 browser tests, plus builds/runtime/TLS. Hosted Phase 21 migration is applied once and verified. Main and Railway SUCCESS deployment run `4fd3db9`; readiness is 200 and both anonymous dashboard routes are 401. Operator-confirmed `PHASE_21_READ_ONLY_VERIFICATION: PASS` covers login/session, dashboard permissions/read, response scope, alert shape, company isolation and session cleanup; `DASHBOARD_COMPLETENESS: PASS`. Phase 21 is closed within this read-only hosted verification scope; hosted acknowledgement writes are not claimed tested. Photos remain disabled hosted. Phase 22 is not started.


## Phase 22 extension

[Phase 22](phase-22.md) adds permission-scoped, paginated report projections over existing immutable journals and current balances. The six views cover stock, inventory movements, production registrations, posted consumption, measured waste and dispatched shipments. Exact decimal strings and totals grouped by unit UUID avoid rounding and mixed-unit sums. Count, totals and rows use one short SERIALIZABLE snapshot. Source IDs link back to journal entries, production orders and shipment documents. Copenhagen calendar-day filters apply to event timestamps; current stock does not pretend to be a historical balance. CSV generation is capped at 2,000 rows / 4 MiB, escapes spreadsheet formulas and records immutable personal receipts with filters, row count and SHA-256. No new infrastructure, stock posting or photo enablement. The only new migration adds two permissions and an empty receipt table with RLS and column-limited grants. Local targeted verification and CI pass. Working-branch commit `b2f947dd759fb6124bc632cd623df2b0ff3bffa5` has exactly the same tree as local implementation `dd1d595`. CI run `35116957817` passes 263 unit/API/database/helper tests, 19 real PostgreSQL concurrency tests and 210 browser tests, plus typechecks, builds, runtime and TLS checks. Phase 22 is closed within the documented read-only hosted verification scope. Hosted migration `20260916155717_phase_22_reports` was applied once and its access boundaries verified. Main/Railway implementation `b2f947d`, SUCCESS deployment, readiness 200 and 13 anonymous routes returning 401 were verified. Operator-confirmed `PHASE_22_READ_ONLY_VERIFICATION: PASS` covers login/session, report permissions, all six report reads, response scope, decimal/unit shape, company isolation, not-found behavior, export history and session cleanup. Expected `REPORT_CSV_GENERATION: NOT_RUN` preserves the read-only scope; hosted CSV generation and receipt writes are not claimed tested, and retain local/CI coverage. Photos remain disabled hosted. Phase 23 status follows below.


## Phase 23 extension

[Phase 23](phase-23.md) improves touch/keyboard operation of the existing workspace without changing business APIs, authentication, tenant policy or journal commands. Bounded mobile/tablet navigation and focus movement preserve access to all permitted areas. A browser-connectivity notice makes stale/uncertain state explicit. Single-attempt JSON transport distinguishes failed reads from uncertain writes and never queues or automatically replays commands. Existing form-owned immutable payloads and idempotency keys remain authoritative for manual retries. QR lookups can be explicitly retried using their existing reference and permission checks. No migration, dependency, infrastructure or hosted-photo change. Ten targeted local transport tests, frontend typecheck and build pass. Working-branch commit `35fe05d` passes CI run `35231833769`: 273 unit/API/database/helper tests, 19 real PostgreSQL concurrency tests and 222 browser tests, plus typechecks, builds, runtime and TLS checks. A mobile role-selector minimum-width regression was corrected after two failed CI runs. Main and automatic Railway deployment are verified at `35fe05d`; live/ready return 200 and anonymous /api/me returns 401. Railway hosts only the API; actual-user acceptance subsequently used authorized local mkcert HTTPS on Mac/iPhone. Phase 23 is functionally closed by operator acceptance on 2026-09-21 with documented limits: physical tablet NOT_RUN, prior Phase 16 physical QR lookup evidence reused, and intermittent access 500 NOT_REPRODUCED during subsequent normal use (not claimed fixed). Field visibility and explicit menu-return scrolling were confirmed on iPhone. Follow-up diagnostics remain in place; further investigation requires a concrete ACCESS_FAILURE event. The follow-up changes remain local/unpublished, and their automated browser run was blocked by Chromium EACCES; typechecks and two diagnostic tests passed. Final UI/UX simplification requirements are recorded in phase-23.md for after the functional phases. Photos remain disabled hosted. Phase 24 is not started.

## Fase 24 — afgrænset import

NestJS-import af kunder, leverandører, varer, materialer og startbeholdninger bruger eksisterende stamdatavalidering, rettigheder og SERIALIZABLE virksomhedstransaktioner. CSV-filer begrænses til 100 rækker/32 KiB; Excel gemmes som CSV UTF-8. Forhåndsvisning gemmer en uforanderlig jobpost med kildeværdier, resolved referencer og indholdsfingeraftryk. Bekræftelse genvaliderer og gemmer hele importen og en entydig kvittering samlet. RLS, aktørbinding, 24-timers bekræftelsesfrist og unikke databaseconstraints beskytter isolation/genforsøg. Startbeholdninger indsættes som lagerkorrektion gennem den eksisterende journaltrigger og afvises ved eksisterende historik på lagernøglen. Ingen direkte lagerbalanceskrivning, Storage-bucket eller worker. Se [Fase 24](phase-24.md) for faktiske testresultater og hosted grænse. De tidligere UI/UX-forenklingskrav bevares til den afsluttende UI/UX-fase.

Fase 24 er afsluttet med brugerbekræftet `PHASE_24_READ_ONLY_VERIFICATION: PASS` den 2026-09-22. Migrationen er registreret én gang hosted som `20260921191204_phase_24_imports`; main og automatisk Railway-deployment er verificeret på `9437c79`. Login/session, import permissions, alle fem typers templates/historik, scope/shape, isolation, not-found og session cleanup består. `IMPORT_PREVIEW_AND_CONFIRM: NOT_RUN` er en forventet afgrænsning: online-kontrollen er læsebaseret, og importskrivninger dækkes af CI, ikke af en påstået hosted skriveprøve. Foto forbliver deaktiveret hosted. Fase 25 er afsluttet som beskrevet nedenfor.

## Fase 25 – Forecasting-grundlag

Se [fasebeskrivelsen](phase-25.md). Read-only prognose i eksisterende actor-transaktion/RLS med samlet krav om inventory/production/masterdata/shipments read. Eksakte decimaler og ejer-/enhedsafgrænsning; faktisk nettoudlevering trækkes fra snapshotbehov. Forsendelsesreservationer kobles via eksisterende relation, produktionsreservationer kun ved eksplicit scenarievalg. Forventede leverancer er midlertidige input, ikke nye lagerposter eller vedvarende indkøb. Kilder/antagelser kan downloades med SHA-256. Ingen schema-, rettigheds- eller ressourceændringer; foto forbliver deaktiveret hosted. Den afsluttende UI/UX-forenkling forbliver separat. Fase 26 er ikke startet.

Historisk status før publicering: Fase 25 implementering og CI er verificeret på arbejdsgrenen `phase25-forecast` i `804fc57` (302 unit/API/database, 21 PostgreSQL-samtidighed, 240 browserprøver, build/runtime/TLS). Main står fortsat på `363e6e0`; ingen hosted publicering eller online-PASS påstås. Ingen migration kræves. Endelig evidens og grænser fremgår af fasebeskrivelsen.

Historisk hosted status før operatørkontrollen 2026-09-22: godkendt main-publicering og automatisk Railway-deployment af `804fc57` er verificeret (SUCCESS). Health 200 og anonyme forecast-endpoints 401 består. Ingen migration eller konfigurationsændringer; foto deaktiveret. Autentificeret online-verifikation afventer operatørlogin med den lokalt klargjorte verifier; ingen endelig online-PASS påstås endnu.

Endelig Fase 25-status 2026-09-22: **afsluttet** inden for det dokumenterede læsebaserede online-omfang. Brugerbekræftet `PHASE_25_READ_ONLY_VERIFICATION: PASS` dækker login/session, forecast permissions, options read, scope/shape, virksomhedsisolation, not-found og session cleanup. `FORECAST_EXISTING_RECORD_PREVIEW: NOT_RUN` skyldes manglende eksisterende vare/ejer; `FORECAST_COMPLEX_SCENARIOS: NOT_RUN` skyldes fravalg af hosted fixtures. Positive previewberegninger, decimal-/formel-/hashkontrol og komplekse issue/return/reservation-scenarier påstås ikke online-verificeret; lokal/CI-evidens bevares. Ingen migration kræves eller er kørt for Fase 25. Foto forbliver deaktiveret hosted, UI/UX-forenklingskravene bevares til afslutningsfasen, og Fase 26 er ikke startet.

## Fase 26 – Samlet integrationstest og driftsklarhed

Se [fasebeskrivelse](phase-26.md) og [drifts-/gendannelsesplan](operations.md). Arbejdsgren fra `ec84bd5`: tværgående HTTP-forløb, adgangsgrænser, afgrænset lokal belastning og separat native PostgreSQL-gendannelse. CI består på `phase26-operations` i `261fc75`: 305 almindelige tests, 21 PostgreSQL-samtidighedstests, 5 native driftsprøver og 240 browserprøver samt build/runtime/TLS. Lokal belastning og separat database-/rollegendannelse består. Hosted eksport og isoleret lokal databasegendannelse er nu brugerbekræftet PASS (2026-09-22–23): 88 tabeller, 87 COPY-datablokke med 405 rækker og 2 sekvenstællere matcher backupen. Backup og rolleafbildning uden passwords er kopieret til privat FileVault-krypteret opbevaring på Mac; SHA-256 er verificeret. Lokal Colima-instans er stoppet. Dette er en databaseprøve, ikke hosted-til-hosted restore eller en ny login-/applikationsprøve efter restore. Se fasebeskrivelsen for begrænsninger. Pilotadgangen er nu afklaret som eksisterende lokal HTTPS; løbende backupansvar/frekvens/retention er fortsat driftsopfølgning, ikke påstået etableret. Ingen migration, hosted ressourceændring eller UI/UX-redesign. Foto forbliver deaktiveret hosted.

Fase 26 er **afsluttet 2026-09-23 inden for det brugeraccepterede omfang**. Frontendpilotadgangen er den eksisterende Mac-frontend via lokal mkcert HTTPS på samme betroede Wi-Fi med lokal backend. Mac og frontend/backend-processer skal være tændt, og testenheder skal have tillid til testcertifikatet. Tidligere fysisk iPhone-/QR-evidens fra Fase 23 genbruges; ingen ny test eller aktuel build-/tilgængelighedsverifikation påstås. Offentlig frontendadresse og adgang uden for netværket er ikke del af denne pilot. Backupresultatet fra `8665ed0` bevares: login/applikationsadgang efter faktisk restore ikke testet, Storage-filer ikke omfattet og ingen separat off-device backup. Ingen ny hosting/deployment eller ekstern merudgift ved denne dokumentationsafslutning. Foto forbliver deaktiveret hosted. UI/UX-redesign og nye faser kræver særskilt godkendelse.
