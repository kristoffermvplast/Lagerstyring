# Fase 4 — Varer, materialer og emballage

## Status

Implementeret fra `main` / `ae7303897a71815e33746c07261cee91338bd7af` på `phase4-items`. Fase 3 genanalyseres ikke. Fase 5 er ikke startet.

Lokal implementering og test er gennemført. Hosted migration `20260911180004_phase_4_items` er anvendt én gang i det eksisterende Supabase Free-projekt. Koden er publiceret til main som `e44839e6b9110f3f22bcf07165efad67eb28236d` med præcis samme filtræ som den lokalt testede `0db912f`. Brugeren har bekræftet den aktive Railway-commit, og alle tre vareruter svarer nu 401 uden login. Fase 4 er afsluttet efter brugerens bekræftelse af `PHASE_4_READ_ONLY_VERIFICATION: PASS`: ægte login, session, virksomhedstilhørsforhold, permissions, læseadgang og isolation for produkter, materialer og emballage består. Foto-funktionen er teknisk implementeret, men deaktiveret som standard og ikke aktiveret hosted.

## Leverance og datamodel

Én fælles tabel `app.items` med stabil UUID og uforanderlig type `product`, `material` eller `packaging`. UI har tre selvstændige kartoteker. Varenummer er case-insensitivt unikt pr. virksomhed på tværs af alle tre typer, så senere lagertransaktioner kan referere til én entydig identitet. Nummer/navn kan ændres med historik. Aktivering/deaktivering erstatter sletning.

- Fælles: nummer, navn, beskrivelse, farve, produktgruppe, lagerenhed, noter, status og foto.
- Varer: kunde, standardmaskine, antal kaviteter, cyklustid og produktionsnoter.
- Materialer/emballage: leverandør, leverandørnummer, materialetype og leveringstid.
- Lagerstandarder: minimum, ønsket/maksimum, genbestillingsniveau, standardbestillingsmængde og vejledende mængde pr. palle.
- Opret med nummer og navn. Manglende lagerenhed vises tydeligt. Mængder kræver en lagerenhed. Når enhed er valgt, låses den for at undgå utilsigtet omfortolkning af historiske mængder.
- Søgning, statusfilter, kunde-/leverandør-/gruppe-/materialetypefilter, sortering i begge retninger og serverpaginering.
- Relationer oprettes direkte fra formularen med bevaret kladde og søgbare valg. Nuværende inaktive relation kan bevares; en ny relation skal være aktiv.
- Detaljer og seneste 100 auditposter; hele historikken bevares i databasen. Relationernes aktuelle navne vises i detaljer, audit bevarer reference-ID'et.

Mængder er `numeric(20,8)`, transporteret som decimalstrenge i JSON. Ingen floating-point-konvertering; intervalkontrol i API bruger skaleret BigInt. Minimum ≤ ønsket ≤ maksimum, når de pågældende felter er angivet. NaN, Infinity, negative mængder, eksponentnotation og mere end otte decimaler afvises af API.

## Adgang og integritet

Eksisterende `masterdata.read` og `masterdata.manage` gælder alle tre kartoteker og fotos. Der oprettes ingen nye standardroller eller forretningsdata. NestJS verificerer identitet/permissions og anvender den eksisterende transaktionslokale bruger-, sessions- og virksomhedskontekst under SERIALIZABLE.

`app.items` ejes af `app_owner`, har RLS og sammensatte foreign keys `(company_id, reference_id)`. Runtime kan læse/oprette og ændre udvalgte kolonner; ikke slette eller ændre identitet/type/virksomhed/tidsstempler direkte. Versionskrav forhindrer tabte opdateringer; nye relationer låses med FOR SHARE under valideringen. Manglende/forkert virksomhedskontekst afvises. Browserroller og service_role får ingen adgang til app-tabellen.

Eksisterende `app.masterdata_audit` og audit-trigger genbruges. Ny `app_private.validate_item` er SECURITY INVOKER med fast search_path; ingen ny privilegeret forretningsfunktion. Audit indeholder gammel/ny værdi, aktør og tidspunkt. Dokument-snapshots og BOM/pakkeversioner hører til deres senere faser.

## API

Alle ruter har `/api`-prefix og kræver verificeret session:

| Rute | Funktion |
| --- | --- |
| GET `/companies/:companyId/items/:kind` | Filtreret liste, max. 100 pr. side |
| POST samme rute | Opret |
| GET `/companies/:companyId/items/:kind/:id` | Detaljer |
| PATCH samme rute | Opdater med `{version,data}` |
| GET `.../:id/history` | Virksomhedsafgrænset audit |
| GET `.../:id/photo` | Foto gennem backend eller deaktiveret-status |
| POST `.../:id/photo` | Versionskontrolleret foto-upload |
| GET `/companies/:companyId/masterdata/:kind/:id` | Slå det aktuelle navn på en reference op |

Skrivninger til forkert virksomheds rute giver 403; et fremmed ID under egen virksomhed giver 404. Konkurrerende/stale redigering giver 409. Ingen lagerantal, reservationer, ejerbeholdninger eller forbrug beregnes her.

## Foto og økonomisk aktiveringsgrænse

Fotos går browser → NestJS → Supabase Storage. Ingen direkte browser-upload, offentlig bucket eller underskrevet URL. Backend kontrollerer permissions og ejerskab før Storage-kald. Storage-adapteren afviser public buckets, redirects og usanitiserede fejl.

Teknisk forberedt opsætning, **ikke udført hosted**:

1. Bekræft særskilt, at Storage-brug, trafik og Railway-belastning er inden for godkendt økonomisk ramme.
2. Opret/brug en privat bucket `item-photos`, max. 1 MiB pr. fil, MIME `image/png` og `image/jpeg`. Ingen browserpolitikker. Ingen automatisk oprettelse i appen eller migrationen.
3. Sæt en server-only Supabase `sb_secret_` key i Railway som `SUPABASE_STORAGE_SECRET_KEY`, aldrig i chat, Git, frontend eller VITE-variabler. Nøglen er privilegeret i Supabase og bruges kun af Storage-adapteren; PostgreSQL-forbindelsen er fortsat den begrænsede `app_backend`.
4. Sæt `ITEM_PHOTOS_ENABLED=true` først efter godkendelse og sikker opsætning. Standard er `false`; kernekartotekerne kræver ingen ny secret.
5. Verificér privat Storage og foto-upload online med en udtrykkeligt godkendt testregistrering. Lokale Storage-mocks er ikke bevis for hosted konfiguration.

Upload begrænses til 1 MiB og rasterformater med signatur-/dimensionskontrol, højst 4096 × 4096 pixels. Kontrollen er ikke en fuld billeddekoder eller malware-scanner. SVG/HTML accepteres ikke. JSON-bodygrænsen er kun udvidet til 1500 KB på fotoruten; øvrige ruter bevarer 64 KB.

Hver fil får en ny, servergenereret sti `company/item/uuid.extension`. Gamle fotos overskrives ikke; audit bevarer stireferencerne. En fejlet/uklar database-commit efter upload kan efterlade et privat, ikke-refereret objekt. Det slettes ikke automatisk, fordi commit kan være gennemført. Manuel oprydning skal sammenholde aktuelle og historiske referencer og igangværende uploads. Retention og ophobet Storage-forbrug skal indgå i senere driftsbudget; ingen jobs/Redis/ny service er tilføjet.

## Kørsel og afgrænsning

Brug eksisterende README/miljøopsætning: `npm ci`, `npm run dev`. Vælg Varer, Materialer eller Emballage efter login i en virksomhed med stamdataadgang. Lokal database skal have alle migrations; nulstil aldrig hosted database. Migrationen er allerede kørt hosted og må ikke genkøres.

BOM, materialeforbrug, emballagens forbrugsansvar, pakkeopbygninger og beregnet antal pr. palle hører til Fase 5. Placeringer hører til Fase 6, transaktionsbaseret lager til Fase 7. Vejledende pallemængde i Fase 4 erstatter ikke en pakkeopbygning. Beholdningsejerskab skal senere være pr. beholdning, ikke fejlagtigt én ejer på varekortet. Ingen af disse senere workflows er implementeret.

Fase 4 er afsluttet med bestået online-læseverifikation. Hosted CRUD og foto-upload er ikke online-verificeret; lokal testdækning er beskrevet i verifikationsdokumentet. Foto-aktivering kræver fortsat særskilt økonomisk og sikkerhedsmæssig afklaring. Fase 5 afventer brugerens godkendelse.
