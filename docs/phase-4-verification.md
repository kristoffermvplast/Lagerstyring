# Fase 4 — Verifikation

## Lokalt

- `npm run check`: PASS. TypeScript for backend/frontend, 71 applikationstests og begge produktionsbuilds.
- Playwright: alle 51 cases PASS på desktop/tablet/mobil via eksisterende lokal Chromium. Heraf 15 nye Fase 4-browsercases.
- Nye applikationstests: 4 databasecases, 6 API-cases og 5 foto-/Storage-cases, i alt 15.
- Testdata og Storage-/Auth-stubs findes kun lokalt. Ingen nye hosted testvirksomheder, brugere eller varer.
- Den første browserkørsel fandt en uklar label på den eksisterende formular til enhedstype. Eksplicit aria-label rettede fejlen; den efterfølgende fulde browserkørsel består.
- Den eksisterende test af tabelantal er opdateret fra 17 til 18. Øvrige fundamenttests er kørt som påkrævet gate, fordi app-modul, konfiguration, request-bodygrænse og skema ændres.

Verificeret: minimal oprettelse, alle tre typer, audit før/efter, versionskonflikter, deaktivering, søgning/statusfilter, referencefiltrering, decimalpræcision, ugyldige intervaller, manglende enhed, uforanderlig tildelt enhed, kunde/leverandør/type på tværs af virksomheder, inaktive referencer, separat læse-/skriveadgang, browsergrænser, ingen direkte sletning, foto-versionering, fotoafvisning før Storage, upstream-fejl, størrelsesgrænse, deaktiveret foto uden eksterne kald og afvisning af offentlig bucket.

Browsertests bruger API-fixtures. API-tests bruger rigtig NestJS og PostgreSQL/PGlite med lokal Auth-stub. Storage-protokol er testet mod mock, ikke hosted Supabase Storage. Ingen påstand om real PostgreSQL-parallel belastning, fysisk Safari/iOS eller publiceret frontend.

## Hosted Supabase

Eksisterende projekt `puwyontrchonoepisgun` / Produktionssystem; organisation Lagersystem, plan Free bekræftet før ændring. Database før migration: 12.020.883 bytes. Ingen plan-/compute-/storage-/limitændringer.

Migration `20260911180004_phase_4_items` er anvendt én gang. Den lokale fil er afstemt med den returnerede hosted migrationsversion; SQL er uændret i omdøbningen. CLI-helperens netværksopstart var utilgængelig; SQL blev udarbejdet og testet lokalt og anvendt med Supabase migrationsværktøjet. Eksisterende migrationer er ikke kørt igen.

Efterkontrol:

| Kontrol | Resultat |
| --- | --- |
| RLS på app.items | true |
| Ejer | app_owner |
| app_backend SELECT | true |
| app_backend DELETE | false |
| app_backend UPDATE kind/company_id | false / false |
| anon/authenticated SELECT | false / false |
| Hosted vareregistreringer | 0 |

Kontrollen er en hosted katalog-/privilegiekontrol, ikke en live brugerbaseret API-isolationstest. Sidstnævnte kræver publicering af Fase 4-backenden og efterfølgende sessionstest.

## Økonomisk stop

Ingen push eller Railway-deployment er udført i Fase 4. Den tidligere engangsgodkendelse dækkede alene Fase 3-dokumentationspush. Fase 4-push vil udløse GitHub Actions og mulig Railway-deployment med muligt merforbrug; en ny udtrykkelig godkendelse kræves før push.

Foto-aktivering er separat: ingen bucket, key eller hosted foto-upload er oprettet/udført. Funktionaliteten er deaktiveret som standard og kræver økonomisk samt sikkerhedsmæssig afklaring som beskrevet i phase-4.md.

Security Advisor efter migration: ingen nye tabel-/RLS-advarsler. Den tidligere kendte Auth-advarsel om [deaktiveret leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) består; ingen Auth-indstilling eller betalt feature er ændret.
