# Fase 3 — Grundlæggende stamdata

## Status

Implementeret fra `main` / `470b3f95218ce0d762081c174401d56570f88d14` på den separate branch `phase3-masterdata`. Fase 2 er bevaret. Fase 4 er ikke startet.

Lokal implementering og tests er gennemført; den additive migration er anvendt i det eksisterende Supabase Free-projekt. Koden er endnu ikke pushet/deployet. Online-verifikation af Fase 3-API og brugerflade afventer publicering. Dette er ikke en erklæring om fuld online-aktivering.

## Leverance

- Kunder: nummer, navn, adresse, kontaktperson, telefon, e-mail, aktiv/inaktiv og noter.
- Leverandører: samme kontaktfelter samt standardleveringstid i hele dage.
- Maskiner: nummer, navn, valgfri maskintype, aktiv/inaktiv og noter.
- Produktgrupper, maskintyper, materialetyper og palletyper: kode, navn, aktiv/inaktiv og noter.
- Enheder: kode, navn, symbol og teknisk dimension (antal, masse, længde, volumen eller pakkeenhed). Dimensionen kan ikke ændres efter oprettelse. Der er endnu ingen enhedskonvertering; systemet antager ikke, at en kasse eller palle har et fast indhold.
- Søgning efter kode/navn, statusfilter, sortering, serverpaginering, oprettelse, redigering og deaktivering.
- Detaljer og de seneste 100 ændringer med aktør, tid samt tidligere/nye feltværdier. Al historik bevares i databasen.
- Maskintyper kan oprettes direkte fra maskinformularen uden at miste maskinkladen.
- Mobiltilpassede formularer og tabeller i det eksisterende layout. Tomme lister indeholder ingen demodata.

Lagerplaceringer hører til Fase 6. Produktionskapacitet, styklister, pakkeopbygninger, varer, materialebeholdninger, forsendelser, pallemellemværender, enhedskonverteringer og lagertransaktioner er ikke implementeret i denne fase. Ejerskabsmodellen for senere beholdninger ændres ikke.

## Database og adgang

Migration: `supabase/migrations/20260911171505_phase_3_masterdata.sql` (lokalt oprettet med Supabase CLI; filnavnet er efter hosted anvendelse synkroniseret med den faktiske migrationsversion).

Nye relationelle tabeller under `app`: `customers`, `suppliers`, `machines`, `product_groups`, `units`, `machine_types`, `material_types`, `pallet_types` og `masterdata_audit`.

Alle kartoteker har UUID-identitet, virksomhed, kode, navn, status, noter, version og tidsstempler. Koder er unikke uden forskel på store/små bogstaver inden for virksomhed og kartotek. Kundenummer og leverandørnummer er ikke primary keys. Maskinens sammensatte foreign key `(company_id,machine_type_id)` forhindrer referencer på tværs af virksomheder. Der kan ikke vælges en ny inaktiv maskintype; eksisterende referencer bevares ved deaktivering.

`masterdata.read` og `masterdata.manage` er tekniske permissions. Læsning kræver førstnævnte; skrivning kræver begge. Administratorrollen har dem automatisk via den eksisterende permissionmodel. Andre roller tildeles dem eksplicit under Adgang. Migrationen udleder ikke rettigheder fra rollenavne og ændrer ingen eksisterende medlemskaber. Det eksisterende bootstrap-værktøj er bevaret; også fremtidige ikke-administratorroller tildeles stamdatarettigheder eksplicit.

Alle requests går gennem NestJS' eksisterende verificerede Auth-guard og transaktionslokale virksomheds-/brugerkontekst. Inputskemaer er strikte; SQL-værdier er parametriserede, og tabel-/kolonnenavne kommer fra lukkede serverdefinerede lister. Fremmed virksomhed afvises med 403; fremmede objekter under egen virksomhedsroute findes ikke (404). Versionskonflikter/dubletter giver 409, ugyldigt input 400.

RLS dækker både læsning og skrivning. `app_backend` kan ikke slette stamdata, ændre identitet/virksomhed, skrive historik direkte eller ændre enhedsdimension. Historiktriggere kræver aktør, bevarer snapshots og håndhæver versionsstigning. Den snævre `app_private.audit_masterdata`-triggerfunktion er SECURITY DEFINER med fast search_path; den er ikke et API-endpoint eller direkte runtime-funktion. Auditobjekter bruger type + UUID som bevidst historikreference til flere tabeller.

Readiness kræver de nye tabeller, så ny backendkode ikke erklærer sig klar mod en database uden migrationen.

## API

Præfiks: `/api/companies/:companyId/masterdata/:kind`.

| Metode | Sti | Funktion |
| --- | --- | --- |
| GET | præfiks | Liste; `q`, `active`, `page`, `limit` (maks. 100), `sort`, `direction` |
| POST | præfiks | Opret med validerede felter |
| PATCH | præfiks + `/:id` | Gem `{version,data}`; hele formularens aktuelle felter |
| GET | præfiks + `/:id/history` | Seneste 100 historikposter |

`kind` er en af de otte kartotekstabeller ovenfor. Ingen DELETE-endpoints.

## Kørsel og aktivering

Brug eksisterende Node 24/npm 11-opsætning: `npm ci`, de eksisterende miljøeksempler og `npm run dev`. Ingen nye environment variables, secrets eller afhængigheder er tilføjet. Frontend bruger fortsat Supabase Auth alene; al stamdataadgang går gennem NestJS.

Hosted migration er allerede gennemført — kør den ikke igen. Publicér først backend/frontend efter økonomisk afklaring af push/deployment. Den eksisterende Railway-ressourceopsætning skal bevares. Frontend er ikke hostet på en ny platform i denne fase.

Ved efterfølgende onlinekontrol: readiness, adgang til kartoteker med administrator og læsebruger, opret/redigér/deaktivér en særskilt godkendt testregistrering, kontrollér historik samt afvisning mod den eksisterende isolationstestvirksomhed. Ingen nye hosted testdata er oprettet som del af denne leverance.

## Verifikation og begrænsninger

Se `phase-3-verification.md`. Historikken er uforanderlig for runtime, ikke for en privilegeret databaseejer. Ingen påstand om beskyttelse mod kompromitterede administratorcredentials. Lokale PGlite-tests beviser ikke samtidighed mellem flere rigtige PostgreSQL-serverforbindelser. Søgeresultater er begrænsede og virksomhedsspecifikke; indeksering af fritekst og avancerede enhedskonverteringer kan udvides, når reelle datamængder og anvendelser kræver det.
