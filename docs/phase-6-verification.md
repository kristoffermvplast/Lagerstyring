# Fase 6 — Verifikation og publiceringsstatus

## Endelig status — Fase 6 afsluttet

Brugeren har bekræftet resultatet af sin lokale online-kørsel:

`PHASE_6_READ_ONLY_VERIFICATION: PASS`

Login, session, virksomhedstilhørsforhold, permissions, locations-read, response scope, not-found-adfærd og virksomhedsisolation består. Dette er brugerens rapport fra den faktiske kørsel; credentials er ikke indsamlet. Railway er tidligere brugerbekræftet på `c01c32403223f1d45e1c9399000d5a85b5f73a9f`, og placeringsruten er verificeret til HTTP 401 uden login.

Følgende er forventet:

`LOCATION_EXISTING_RECORD: NOT_RUN (no existing location; no fixture created)`

Der fandtes ingen eksisterende placeringer, og scriptet oprettede ingen fixtures. Online-resultatet dokumenterer derfor læseadgang, response scope, not-found-adfærd og virksomhedsafgrænsning, men ikke læsning af en eksisterende placerings sti/historik/underplaceringer eller hosted CRUD. De tidligere 95 applikationstests, 72 browsertests, CI- og migrationskontroller bevares som separat evidens og er ikke genkørt.

Fase 6 afsluttes på dette grundlag med de beskrevne verifikationsbegrænsninger. Foto forbliver deaktiveret hosted. Afslutningen ændrer kun dokumentation og gemmes i en lokal commit på `phase6-locations`; den er endnu ikke pushet til `main`. Ingen nye eksterne kald, migrationer, deployments eller ressourceændringer. Fase 7 er ikke startet.

Denne slutstatus erstatter de tidligere afventende statusangivelser længere nede, som bevares som historik.

## Lokal evidens

- `npm run check`: PASS — 93 applikationstests, TypeScript og begge produktionsbuilds. Den samlede gate er relevant, fordi app-modul, readiness, databasemodel og fælles formularer ændres.
- Efterfølgende isoleret test af det nye online-verifikationsscript: 2 PASS. I alt **95 applikationstests**; den tidligere suite er ikke gentaget for denne helpertilføjelse.
- Fuld Playwright-gate: **72 PASS**, heraf ni nye fase 6-cases på desktop, tablet og mobil.
- `git diff --check`: PASS.

De syv nye databasetests dækker stabile identiteter og audit; direkte/indirekte cirkler; dybdegrænsen inklusive flytning af understruktur; aktive forældre; deaktivering; private rettigheder; kodeunikhed; læserettigheder; virksomheders isolation og item-/maskinreferencer. De tre nye API-tests bruger rigtig NestJS og PGlite med lokal Auth-stub og kontrollerer navigation, filtre, paginering, forældrevalg uden egen understruktur, versionskonflikter, inputvalidering og 401/403/404/409-grænser.

Browsertests bruger lokale fixtures. De nye workflows dækker oprettelse af hierarki, brødkrummer, redigering, historik, virksomhedsskift, læseadgang og inline-oprettelse, som bevarer vareformularen. Første målrettede kørsel fandt en forkert feltbetegnelse i testen (`Standardplacering` i stedet for `Standardlagerplacering`); testen er rettet, og den afsluttende fulde gate består.

Online-helperens tests verificerer kun GET-kald til forretnings-API'et, sessionsoprydning og fravær af secret-output, også ved fejl.

## Hosted migration

Projekt: `puwyontrchonoepisgun` / Produktionssystem. Organisation `ltqcdagbwtuwtudnqpdn` / Lagersystem blev genbekræftet som **Free**. Før migrationen: **12.479.635 bytes**, og `app.locations` fandtes ikke. Den lille additive migration kræver ingen ændring af plan eller ressourcer; forventet merudgift **0 kr.**

Migration **`20260911194729_phase_6_locations`** er kørt **én gang** via Supabase-migrationsværktøjet. Lokal fil er omdøbt til serverens registrerede version med uændret SQL. Tidligere migrationer er ikke genkørt. Den tidligere dokumenterede CLI-netværksbegrænsning er ikke genafprøvet eller omgået.

| Efterkontrol | Resultat |
| --- | --- |
| `locations` og `location_tree_locks`: ejer / RLS | app_owner / true |
| app_backend læsning af locations | true |
| app_backend sletning af begge tabeller | false |
| anon/authenticated læsning af begge tabeller | false |
| app_backend læsning af privat låsetabel | false |
| app_backend USAGE på app_private | false |
| app_backend direkte EXECUTE af begge nye triggere | false |
| app_backend ændring af locations.company_id | false |
| Runtime UPDATE af de to nye referencefelter | true |
| Composite foreign keys fra items/machines til locations | 2 |
| Hosted placeringsrækker / låserækker | 0 / 0 |

Security advisor viser én ny **INFO**: [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) på `app_private.location_tree_locks`. Det er bevidst deny-by-default: ingen applikationsrolle skal have direkte adgang; den afgrænsede ejertrigger udfører låsningen. Der oprettes derfor ingen adgangspolitik for at skjule noten. Den tidligere kendte [Leaked Password Protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)-advarsel består; Auth-konfiguration og betalte features er ikke ændret.

## Begrænsninger

PGlite-testene verificerer constraints, rettigheder og den private låsemekanismes anvendelse, men er ikke en parallel belastningstest på rigtig flerproces-PostgreSQL. Samtidige transaktioners sikkerhed bygger på eksisterende SERIALIZABLE-transaktioner og den konfliktgivende virksomhedslås. Fysisk Safari/iOS, hosted CRUD og en publiceret frontend er ikke verificeret. Docker-image bygges i det eksisterende CI-flow; lokal Docker-daemon er ikke tilgængelig. Ingen hosted testdata er oprettet.

## Økonomisk grænse og resterende trin

Lokalt arbejde og tests bruger eksisterende dependencies/Chromium. Ingen nye services, miljøer, replicas, compute/RAM, credits, spend limits eller varige ressourcer er ændret. Foto er ikke aktiveret.

Brugeren godkendte særskilt dette ene push af `fa2924c` med normale automatiske GitHub Actions-/Railway-kørsler på eksisterende, uændrede ressourcer. `main` er opdateret og genlæst som **`c01c32403223f1d45e1c9399000d5a85b5f73a9f`**. GitHub-committen har præcis samme tree som den godkendte lokale commit: `949f4e4d3d579b84912a1b87ccf5e34cdd242202`; `git diff fa2924c origin/main` er tom. Det nye commit-ID skyldes overførslen via GitHub-integrationen. Ingen yderligere migration, manuel deployment eller ressourceændring er udført.

Den efterfølgende verifikationsdokumentation gemmes kun lokalt, så opdateringen ikke udløser et ekstra automatisk deployment-flow uden om engangsgodkendelsen.

Resterende kontrol: verificér normal CI og aktiv Railway-commit; kontrollér readiness og `/api/companies/:companyId/locations` (401 uden login). Kør derefter `node scripts/verify-locations.cjs` lokalt med egne skjulte credentials og den allerede godkendte isolationstestvirksomhed. Uden eksisterende placeringer er `LOCATION_EXISTING_RECORD: NOT_RUN` forventet. Der kræves ingen ny migration. Registrér det faktiske online-resultat før endelig afslutning; gentag ikke andre beståede tests uden konkret grund.


## Publiceringskontrol efter det godkendte push

- Remote `main`: **c01c32403223f1d45e1c9399000d5a85b5f73a9f**, genlæst via GitHub og `git fetch`; filindhold identisk med `fa2924c`.
- [GitHub Actions 34650988420](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34650988420): **success**. TypeScript, applikationstests, produktionsbuilds, hele browsersuiten, Docker-runtime-build, runtime-diagnosescript og CA-materialisering med strikt TLS består.
- Offentlig `/api/health/live`: **HTTP 200**.
- Offentlig `/api/health/ready`: **HTTP 200**.
- `/api/companies/:companyId/locations` uden login: seneste gennemførte kontrol gav **HTTP 404**, ikke forventet 401. En efterfølgende kontrol kunne ikke afsluttes, fordi netværksgodkendelsen blev annulleret. De to health-svar beviser ikke, at Railway kører den nye commit.
- Railway-værktøjer er ikke tilgængelige i samtalen; aktiv deployment/commit kunne derfor ikke verificeres direkte. Ingen manuel deployment er iværksat.
- Ægte login og fase 6-virksomhedsisolation: **NOT_RUN**. Operatørens credentials er ikke tilgængelige her, og den nye rute er endnu ikke verificeret aktiv. Kør det forberedte `scripts/verify-locations.cjs` lokalt efter bekræftelse af Railway-committen og rutens forventede 401.

Næste konkrete trin: bekræft i Railway, at den normale automatiske deployment kører commit `c01c32403223f1d45e1c9399000d5a85b5f73a9f`. Derefter genkøres kun den nye rutes kontrol og fase 6-helperen. Fasen er fortsat afventende online-verifikation; ingen tidligere beståede tests skal gentages. Denne dokumentationsændring er kun lokal og er ikke pushet.


## Målrettet kontrol efter bekræftet Railway-deployment

Brugeren har bekræftet, at Railway kører `c01c32403223f1d45e1c9399000d5a85b5f73a9f`. Den efterfølgende målrettede GET af `/api/companies/:companyId/locations` uden credentials gav **HTTP 401 — PASS**. Dette erstatter den tidligere 404 som aktuel rutestatus. Tidligere beståede CI-/health-/databasetests er ikke genkørt.

Den autentificerede online-verifikation afventer stadig operatørens lokale kørsel af `node scripts/verify-locations.cjs`; brugerens loginpassword findes ikke i dette arbejdsmiljø og skal ikke deles i chatten. Scriptet bruger skjulte indtastninger, foretager kun læsning af forretningsdata og opretter ingen fixtures. Brug `MV Plast` samt den eksisterende godkendte isolationstestvirksomhed. Uden eksisterende placeringer er `LOCATION_EXISTING_RECORD: NOT_RUN` forventet. Fasen kan ikke markeres fuldt online-verificeret før det faktiske resultat foreligger.

Kun denne dokumentation er ændret og gemt lokalt. Ingen push, migration, deployment, ændring af foto eller ressourceændring. Fase 7 er ikke startet.
