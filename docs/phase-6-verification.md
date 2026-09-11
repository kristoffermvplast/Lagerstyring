# Fase 6 — Verifikation og publiceringsstatus

## Aktuel status

Implementeringen er færdig lokalt på `phase6-locations`, baseret på `main` / `51e845b`. Migrationen er kørt og efterkontrolleret på det eksisterende Supabase-projekt. Publicering til GitHub/Railway og den nye online-API-verifikation afventer; fasen er derfor **ikke endeligt online-verificeret**. Fase 7 er ikke startet. Foto forbliver deaktiveret hosted.

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

**Push er ikke udført.** Det udløser normalt GitHub Actions og Railway automatisk. Der foreligger ikke aktuelle Railway-forbrugstal, som med rimelig sikkerhed begrænser den samlede merudgift til højst 1 kr. Tidligere særgodkendelser gjaldt andre konkrete pushes. Der kræves derfor godkendelse til dette konkrete push og det normale automatiske flow på uændrede ressourcer, eller et tilstrækkeligt omkostningsgrundlag under 1 kr.

Efter godkendt push: verificér main, normal CI og aktiv Railway-commit; kontrollér readiness og `/api/companies/:companyId/locations` (401 uden login). Kør derefter `node scripts/verify-locations.cjs` lokalt med egne skjulte credentials og den allerede godkendte isolationstestvirksomhed. Uden eksisterende placeringer er `LOCATION_EXISTING_RECORD: NOT_RUN` forventet. Der kræves ingen ny migration. Registrér det faktiske online-resultat før endelig afslutning; gentag ikke andre beståede tests uden konkret grund.
