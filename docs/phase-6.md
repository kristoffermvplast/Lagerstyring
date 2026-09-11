# Fase 6 — Hierarkiske lagerplaceringer

Udgangspunkt: `main` / `51e845b`. Fasen omfatter kun placeringsstamdata og deres referencer. Ingen beholdninger, lagertransaktioner, QR-registrering eller senere workflows. Foto er fortsat deaktiveret hosted.

## Leverance

- Lagerplaceringer med stabile UUID'er, virksomhed, kode, navn, valgfri overordnet placering, fri niveaubetegnelse, aktiv/inaktiv, lagerføring tilladt, noter og versionsnummer.
- Opret, redigér, deaktiver, søg, filtrér, sortér, paginér, navigér mellem niveauer og se historik. Ingen permanent sletning.
- Standardlagerplacering på produkter, materialer og emballage samt placering på maskiner. Manglende placering kan oprettes i en dialog uden at miste den oprindelige formular.
- Virksomhedsspecifik læse-/skriveadgang via de eksisterende `masterdata.read` / `masterdata.manage`. Browseren bruger udelukkende NestJS til forretningsdata.

## Database og integritet

`app.locations` har composite foreign key `(company_id,parent_id)` til sig selv, virksomhedsspecifik kodeunikhed uden forskel på store/små bogstaver, RLS og indekser til forældre, listefiltre og referencer. `app.items.standard_location_id` og `app.machines.location_id` har tilsvarende virksomhedsspecifikke foreign keys. Eksisterende data får NULL i de nye valgfrie felter.

Stier beregnes fra stabile ID'er. Omdøbning og ændring af overordnet placering ændrer ikke underplaceringers identiteter. Maksimal dybde er 32 niveauer, kontrolleret inklusive hele den flyttede understruktur. Direkte/indirekte cirkler og aktive placeringer under inaktive overordnede afvises. Aktive børn skal først deaktiveres eller flyttes.

En privat `app_private.location_tree_locks`-række pr. virksomhed serialiserer hierarkiændringer. Den oprettes først ved en faktisk ændring. Den afgrænsede SECURITY DEFINER-trigger kontrollerer virksomhed og permissions og har fast `search_path`. Runtime har ingen direkte adgang til låsetabellen eller private funktioner. Samtidige konflikter afvises atomisk; brugeren henter listen og forsøger igen. Der foretages ingen automatisk gentagelse af brugerens skrivehandling.

Versionskontrol og det eksisterende append-only stamdata-audit gemmer før-/efterværdier og aktør i samme transaktion. Runtime må ikke slette placeringer, ændre deres identitet eller rette audit. Browserroller har ingen tabeladgang.

Nye placeringsreferencer kræver aktiv placering i samme virksomhed; varers standardplacering kræver også `is_storage=true`. Maskiner må tilknyttes et rent strukturelt niveau. Valideringen låser referencen under tildelingen. En eksisterende reference bevares ved senere deaktivering eller ændring til struktur alene; brugerfladen viser en advarsel. Det er stamdata, ikke en registrering af fysisk lager. Senere lagerfunktioner skal validere placeringens aktuelle anvendelighed ved bogføring.

## API

Alle ruter starter med `/api/companies/:companyId/locations` og kræver login:

| Metode / suffix | Funktion |
| --- | --- |
| GET | Liste med q, parent_id (root/all/UUID), active, storage, sort, direction, page, limit |
| GET /:id | Detaljer og fuld sti |
| GET /:id/history | Seneste 100 ændringer |
| POST | Opret placering |
| PATCH /:id | Redigér med `{version,data}` |

`exclude_subtree=UUID` udelukker en placering og dens efterkommere fra valg af overordnet. Lister er begrænset til 100 resultater pr. kald, standard 25. Input er strengt valideret; ukendte felter afvises. Ukendte ID'er i egen virksomhed giver 404, uvedkommende virksomhed giver 403, manglende login 401 og versions-/integritetskonflikter 409 uden SQL-detaljer.

## Kørsel og online-kontrol

Eksisterende miljøopsætning og dependencies genbruges; ingen nye secrets eller services. Start lokalt med de eksisterende kommandoer i README og vælg **Lagerplaceringer** efter login med stamdatarettigheder.

Efter publicering køres `node scripts/verify-locations.cjs` på operatørens egen computer. Alle indtastninger skjules, credentials lagres ikke i filer/argumenter, og output indeholder kun kontrollerede statusværdier. Brug egen eksisterende loginbruger, virksomhed og den allerede godkendte isolationstestvirksomhed. Scriptet foretager kun GET mod forretnings-API'et, opretter ingen fixtures og afslutter sin Supabase-session. Uden eksisterende placeringer bliver `LOCATION_EXISTING_RECORD` forventet NOT_RUN; det er ikke en hosted CRUD-test.

Se [verifikationsstatus](phase-6-verification.md) for udførte tests, migration og resterende publicering.
