# Fase 5 — Verifikation og publiceringsstatus

## Endelig status — Fase 5 afsluttet

Brugeren har bekræftet resultatet af sin lokale online-verifikation:

`PHASE_5_READ_ONLY_VERIFICATION: PASS`

Login, session, virksomhedstilhørsforhold, permissions, produktreference, BOM, packing, not-found-adfærd og virksomhedsisolation består. Dette er brugerens rapport fra den faktiske online-kørsel; credentials er ikke indsamlet. Railway-committen er tidligere brugerbekræftet som `f6bd87d4d63d05f11449dec1decf46a60cc5094d`, og recipes-ruten er verificeret til HTTP 401 uden login.

Følgende kontroller er forventet ikke kørt:

- `BOM_EXISTING_REVISION: NOT_RUN`
- `PACKING_EXISTING_REVISION: NOT_RUN`

Der fandtes ingen eksisterende publicerede revisioner, og scriptet oprettede ingen fixtures. Online-resultatet verificerer derfor læseadgang, adgangsgrænser og not-found-adfærd, men ikke læsning eller beregning på eksisterende publicerede revisioner eller hosted CRUD. De tidligere 83 applikationstests, 63 browsertests, CI- og migrationskontroller bevares som separat evidens og er ikke genkørt.

Fase 5 afsluttes på dette grundlag med de beskrevne verifikationsbegrænsninger. Foto forbliver deaktiveret hosted. Denne afslutning ændrer kun dokumentation og medfører ingen eksterne kald, push, deployment, migration eller ressourceændring. Dokumentationen gemmes i en lokal commit på `phase5-bom-packing`; den er endnu ikke overført til `main`. Fase 6 er ikke startet.

Denne slutstatus erstatter de tidligere afventende statusangivelser længere nede, som bevares som historik.

## Lokal evidens

- `npm run check`: PASS, 81 applikationstests, TypeScript og begge produktionsbuilds. Gaten er kørt, fordi app-modul, readiness og databaseudvidelsen ændres.
- Efterfølgende målrettet test af det nye sikre online-helper-script: 2 yderligere tests PASS. I alt 83 beståede applikationstests; den tidligere suite er ikke gentaget for en isoleret helpertilføjelse.
- Efter inline-oprettelse og tekstrettelsen i vareformularen: frontend-produktionsbuild og TypeScript PASS.
- Hele Playwright-gaten: **63 PASS**, heraf 12 nye fase 5-cases (fire workflows på desktop, tablet og mobil).
- `git diff --check`: PASS.

Nye tests verificerer præcis decimalaritmetik inklusive store mellemresultater og 1/12-afrunding; flere materialer; alternative pakninger; fulde/delvise beholdere og tilbehør; immutable snapshots efter masterdata-/versionsændringer; afvisning af uforseglede commits; dobbelttælling og genaktivering; ugyldige niveauer, enheder og referencer; standardunikhed; versionskonflikter; virksomheders læse-/skrivegrænser; læsebrugerens beregningsadgang; browserroller; ingen snapshot-/linjerettelse; API-inputvalidering og et read-only verifikationsscript uden secret-output.

Browsercases omfatter oprettelse af BOM-versioner, historisk visning, indlejret pakning, standardvalg, behovsvisning, virksomhedsvalg, skjulte skrivehandlinger for læsere og inline-oprettelse uden utilsigtet indsendelse af den underliggende formular. Den første målrettede browserkørsel fandt upræcise accessible labels på select-felter. Eksplicitte labels rettede det; den fulde afsluttende kørsel består.

API-tests bruger rigtig NestJS og PostgreSQL/PGlite med en lokal Auth-stub. Browsertests bruger lokale API-fixtures. Ingen hosted brugere, virksomheder, varer eller opskrifter er oprettet til test. Real PostgreSQL-parallel belastning, fysisk Safari/iOS, hosted CRUD og en publiceret frontend er ikke verificeret. Docker-image bygges ikke lokalt uden Docker-daemon; Dockerfile og runtime-konfiguration er uændrede, og runtime-testen ligger fortsat i CI.

## Hosted migration

Eksisterende Supabase-projekt: `puwyontrchonoepisgun` / Produktionssystem. Organisation Lagersystem blev genbekræftet som **Free** umiddelbart før ændringen. Database før migration: **12.217.491 bytes**; fase 5-tabeller fandtes ikke. Den lille additive migration med tomme tabeller kræver ingen plan- eller ressourceændring og har forventet merudgift **0 kr.**

`20260911185047_phase_5_recipes` blev kørt **én gang** via migrationsværktøjet. Den lokale migrationsfil er omdøbt til serverens returnerede migrationsversion uden ændring af SQL. De fire tidligere migrationer er ikke genkørt. Den eksisterende CLI-netværksbegrænsning er ikke forsøgt omgået eller genafprøvet.

Efterkontrol af alle tre tabeller (`recipes`, `recipe_revisions`, `recipe_lines`):

| Kontrol | Resultat |
| --- | --- |
| RLS | true på alle tre |
| Ejer | app_owner |
| app_backend SELECT | true |
| app_backend DELETE | false |
| anon/authenticated SELECT | false |
| app_backend UPDATE på versionssnapshot | false |
| app_backend UPDATE på linjer | false |
| Direkte EXECUTE af privat versionstrigger | false |
| app_backend USAGE på app_private | false |
| Hosted opsætninger / versioner / linjer | 0 / 0 / 0 |

Security advisor: ingen nye tabel-/RLS-advarsler. Den allerede kendte Auth-advarsel om deaktiveret [Leaked Password Protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) består. Auth-konfiguration og betalte features er ikke ændret.

## Økonomisk grænse og næste trin

Den gældende regel er højst **1 kr. i forventet ny/øget ekstern udgift pr. konkret handling** uden særskilt godkendelse, forudsat at grænsen kan vurderes med rimelig sikkerhed. Ingen varige ressourceforøgelser er tilladt uden godkendelse.

Lokalt arbejde bruger eksisterende dependencies og Chromium. Ingen nye eksterne tjenester, betalte integrationer, kreditter, miljøer, replicas, compute/RAM eller spend/usage limits er oprettet eller ændret. Foto forbliver deaktiveret hosted.

Et push udløser det eksisterende GitHub Actions-flow og kan udløse Railway automatisk. De seneste tre Actions-kørsler varede 137, 160 og 185 sekunder. Den aktuelle [GitHub-pris](https://docs.github.com/en/billing/concepts/product-billing/github-actions) for standard Linux 2-core er $0,006/minut ud over inkluderet forbrug; selve den forventede CI-kørsel er derfor beskeden. [Railway](https://docs.railway.com/pricing) afregner efter faktisk CPU/RAM/netværksforbrug. Railway-værktøjer og aktuelle forbrugstal er ikke tilgængelige i denne samtale. Den samlede merudgift for push og automatisk deployment er derfor ikke fastlagt med tilstrækkelig sikkerhed; der er ikke foretaget push.

Før publicering kræves godkendelse til det konkrete push med de normale automatiske kørsler på eksisterende uændrede ressourcer, eller et tilstrækkeligt omkostningsgrundlag under 1 kr. Der er ikke behov for en manuel deployment eller yderligere migration.

Efter godkendt push: verificér remote main, normal CI og aktiv Railway-commit; kontrollér live/ready og den nye recipes-rutes 401 uden login. Kør derefter `node scripts/verify-recipes.cjs` lokalt med egne skjulte credentials og den eksisterende isolationstestvirksomhed. Resultater fra den nye online-kørsel skal tilføjes, før fasen markeres endeligt verificeret. Tidligere auth-/fase 4-resultater skal ikke genanalyseres.
