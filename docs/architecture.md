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
