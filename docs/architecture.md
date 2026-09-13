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

[Phase 9](phase-9.md) extends the existing journal with balanced, atomic two-location transfers, unchanged item ownership, `inventory.transfer` authorization and reversible immutable history. No new stock store or infrastructure is introduced. Phase 10 is complete; Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is not started.

Phase 9 is complete with operator-reported `PHASE_9_READ_ONLY_VERIFICATION: PASS`: login, session, permissions, transfer reads, response scope, not-found behavior and company isolation passed. `TRANSFER_EXISTING_RECORD` remains expected NOT_RUN because no transfer existed and no fixture was created. Hosted verification was read-only; posting and concurrency coverage comes from the previously recorded automated tests. See the final sign-off in [Phase 9](phase-9.md). Hosted photos remain disabled; Phase 10 is complete; Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is not started.

## Phase 10 production order planning

[Phase 10](phase-10.md) adds tenant-scoped planning documents and immutable order audit. Revision snapshots drive fixed-point requirements, including order-specific packing overrides. `production.read` grants snapshot access; planning additionally requires `production.manage` and `masterdata.read`. SERIALIZABLE transactions, creation idempotency and optimistic versions protect concurrent operations. Internal triggers enforce snapshots, references and supported status transitions. No inventory side effects. Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is not started; hosted photos remain disabled.

Phase 10 is complete. Previously recorded automated tests and hosted migration `20260913010919_phase_10_production_orders` remain the validation baseline. Railway revision `5141e420ddd026f076a78731e71f08c4ee9b72ec` is operator-confirmed, anonymous order routes return 401 and readiness returns HTTP 200. Actorless readiness checks the permission catalog structure without reading RLS-protected permission rows; no access rules were relaxed. Operator-reported `PHASE_10_READ_ONLY_VERIFICATION: PASS` covers login, session, permissions, production-order reads, response scope, not-found behavior and company isolation. `PRODUCTION_ORDER_EXISTING_RECORD` is expected NOT_RUN: no existing order and no fixture created. Hosted writes were not tested; their coverage remains the recorded automated tests. See [Phase 10 evidence](phase-10.md). Hosted photos remain disabled; Phase 11 is complete; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is not started.

## Phase 11 material issue

[Phase 11](phase-11.md) links existing balanced inventory transfers to production orders with a company-safe foreign key and immutable order/machine/component snapshot. Existing stock posting, ownership, decimal and RLS boundaries remain authoritative. An additional internal guard serializes issue vs order editing and checks production permissions and revision components. Reversals preserve order attribution; unreversed issues block return to draft. No consumption, production registration, new balance store or infrastructure is introduced. Hosted migration `20260913125931_phase_11_material_issue` and restricted database boundaries are verified; application release is confirmed on Railway commit `b992b6f4791a00f99c247ef3d6a12f6fface2845`. Phase 11 is complete with operator-reported `PHASE_11_READ_ONLY_VERIFICATION: PASS` covering login, session, permissions, production-order reads, material-issue access boundaries, not-found behavior and company isolation. `MATERIAL_ISSUE_ORDER_FIXTURE` is expected NOT_RUN because no order existed and no fixture was created. Positive material-issue reads on an existing order and hosted writes were not exercised; automated tests remain their evidence. Automated CI passes. Readiness checks column availability without actor-dependent permission reads. Photos remain disabled hosted; Phase 12 is complete; Phase 13 is complete; Phase 14 is complete; Phase 15 is not started.


## Phase 12 production registration

[Phase 12](phase-12.md) adds immutable company-scoped production events with order locking, exact quantities, idempotency, separate recording/correction permissions and RLS. Ready orders can start; running orders cannot return to planning. No stock or consumption side effects. Phase 12 is complete with operator-reported `PHASE_12_READ_ONLY_VERIFICATION: PASS` on confirmed Railway commit `28637bc708d952f39c9f62f6568722493f3e9906`. Login, session, permissions, production-order reads, registration access boundaries, not-found behavior and company isolation passed. `PRODUCTION_REGISTRATION_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive registration list/summary/detail reads for an existing order and hosted writes were not exercised; previously documented automated tests remain their coverage. Phase 13 is complete; Phase 14 is complete; Phase 15 has not started.

## Phase 13 material return and closure

[Phase 13](phase-13.md) adds issue-attributed returns and an immutable reviewed closure. It reuses the stock journal and shared order lock, posts confirmed net consumption once, and atomically closes the order. Production registration and future finished-goods delivery remain separate. Return/closure rights are explicit and manageable through NestJS; stale reviews, cross-company requests and negative stock fail closed. Implementation and automated CI verification are complete; hosted migration and approved main release are complete; operator-reported `PHASE_13_READ_ONLY_VERIFICATION: PASS` completes online sign-off. Login, session, permissions, production-order reads, close review/returns/result access boundaries, not-found behavior and company isolation passed. `PRODUCTION_CLOSE_ORDER_FIXTURE: NOT_RUN (no existing production order; no fixture created)` is expected. Positive close reads for an existing order and hosted writes were not exercised; the recorded automated tests remain their coverage. Phase 14 is complete; Phase 15 has not started; photos remain disabled hosted.

## Phase 14 material analysis

[Phase 14](phase-14.md) derives exact per-component/unit material differences from order and closure snapshots. Independent immutable waste observations have explicit creation/correction permissions and historical stock references. They never post inventory again. Shared order locking, SERIALIZABLE retries, RLS and column-level runtime grants protect history and company isolation. Operational trend history uses completion dates and keeps incompatible units separate. Automated verification passes (181 unit/API/database/helper, ten PostgreSQL concurrency and 129 browser tests). Hosted migration `20260913174524_phase_14_material_analysis` and its access boundaries are verified. Main publication is verified at `77b2e1c`; all four anonymous route checks pass with HTTP 401; operator-reported `PHASE_14_READ_ONLY_VERIFICATION: PASS` completes online sign-off. Expected `MATERIAL_ANALYSIS_ORDER_FIXTURE: NOT_RUN` means no existing order was available and no fixture was created. Positive existing-order reads and hosted writes retain the recorded automated-test coverage; Phase 15 has not started.
