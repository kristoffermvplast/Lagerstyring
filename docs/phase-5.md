# Fase 5 — Styklister og pakkeopbygninger

Udgangspunkt: `main` på `c81cd728fd77d8f2bddf86b5daaccbcf3e680e14`. Arbejdet er isoleret på `phase5-bom-packing`. Fase 6 er ikke startet.

Fase 5 er afsluttet med brugerbekræftet `PHASE_5_READ_ONLY_VERIFICATION: PASS`. Kontroller af eksisterende publicerede BOM-/pakkeversioner er forventet NOT_RUN, fordi sådanne versioner ikke fandtes. Se [verifikationen](phase-5-verification.md) for evidens og afgrænsning.

## Funktioner og brug

Log ind, vælg virksomhed og åbn **Styklister og pakning**. Vælg eller opret varen. Opret en navngiven stykliste eller pakkeopbygning, tilføj linjer, og gem en ny version. En tom opsætning kan gemmes, men kan ikke beregnes eller vælges som standard før første komplette version.

- Flere styklister og alternative pakninger pr. vare. Højst én aktiv standard pr. type. Valg af ny standard fjerner den tidligere standard atomisk.
- Omdøbning, deaktivering og genaktivering med versionskontrol og audit. Ingen permanent sletning gennem applikationen.
- Nye versioner udarbejdes i formularen og publiceres atomisk efter bekræftelse. Formularudkast gemmes ikke på serveren. Publicerede linjer og snapshots kan aldrig redigeres; næste ændring opretter en ny version.
- Tidligere versioner kan åbnes med deres oprindelige varenavn, komponentnavne, enheder, palletype, mængder og noter. Versionsforfatter og tidspunkt gemmes.
- Varer, komponenter og palletyper kan oprettes direkte fra formularen. En dialog bevarer den underliggende kladde; nye enheder kan oprettes i den eksisterende vareformular.
- **Beregn behov** foreslår standarderne, tillader alternative valg og beregner teoretisk materialebehov, beholdere, tilbehør, fulde/delvise pakninger og rester. Intet lager eller forbrug bogføres.

Varer og komponenter skal have aktive lagerenheder, når en ny version publiceres. Eksisterende versioner bevares, hvis stamdata senere omdøbes eller deaktiveres.

## Datamodel

Migration: `supabase/migrations/20260911185047_phase_5_recipes.sql`.

| Tabel | Formål og centrale felter |
| --- | --- |
| `app.recipes` | Stabil opsætning: virksomhed, produkt, type `bom`/`packing`, navn, aktiv, standard, aktuel versionsreference, optimistisk `version`, noter og audit-tidspunkter |
| `app.recipe_revisions` | Uforanderlig version: virksomhed, opsætning, fortløbende versionsnummer, basismængde, valgfri palletype, snapshot af produkt/enhed/opsætningsnavn/palletype, noter, forfatter, tidspunkt og `sealed` |
| `app.recipe_lines` | Versionslinjer: virksomhed, versionsreference, komponent, anvendelse `component`/`container`/`accessory`, niveau, mængde og snapshot af komponent/enhed/forbrugsansvar |

Alle referencer mellem virksomhedsdata bruger sammensatte foreign keys med `company_id`. En aktuel version skal høre til samme opsætning og være forseglet. Versionsnumre er unikke pr. opsætning. Opsætningsnavne er unikke pr. vare/type uanset store/små bogstaver. Højst én standard håndhæves med et partielt unikt indeks. Der er indeks på virksomheds-/produkt-/typeopslag, versionsrelationer og komponentreferencer.

`app_owner` ejer tabellerne; `app_backend` får adgang via `app_runtime`. Alle tre tabeller har RLS. Browserrollerne `anon`, `authenticated` og `service_role` har ingen tabeladgang. Læsning kræver `masterdata.read`; ændringer kræver både `masterdata.read` og `masterdata.manage`. Ingen runtime-DELETE. Linjer har ingen UPDATE-rettigheder; versioner kan kun ændres fra uforseglet til forseglet i oprettelsestransaktionen.

Et udskudt constraint-triggerkrav afviser COMMIT med uforseglede versioner. Snapshotindhold opbygges af databasen fra validerede referencer; klienten må ikke levere snapshots. Snapshot- og linjeændringer kan ikke skjules som metadataændringer. Nye versioner får en auditpost med deres linjer, mens opsætningens navne-, standard-, status- og versionsreferenceskift får almindelig stamdataaudit.

## Beregningsregler

**BOM:** Forbrug angives i komponentens lagerenhed pr. valgt basismængde af varen. Behov = produktionsmængde × komponentmængde / basismængde. En basis på 12 og komponentmængde 1 udtrykker præcis 1/12; man behøver ikke gemme den afrundede brøk 0,08333.

Input og databasefelter bruger højst 12 heltalscifre og 8 decimaler (`numeric(20,8)`). API-mængder er decimalstrenge. Beregningsmotoren bruger BigInt og ubegrænsede heltalsmellemregninger; aldrig floating point til mængder. Det teoretiske behov afrundes **op til 8 decimaler** ved slutdivisionen. Resultater kan derfor være større end inputfeltets maksimale værdi og returneres fortsat som strenge. Nul/negative/NaN/Infinity/eksponentnotation og mere end otte decimaler afvises.

Hver komponent bruger sin egen lagerenhed. Der sker ingen implicit kg↔g-, masse↔volumen- eller kasse↔stk.-konvertering. Varer med `count`-enhed kræver hele producerede antal. Lagerførte varekomponenter kan indgå som almindelige BOM-komponenter; deres egen BOM udfoldes ikke rekursivt i denne fase.

**Pakning:** Op til 16 sammenhængende niveauer, fra 0 (inderste beholder) til yderste beholder. Niveau 0 angiver varenheder pr. beholder; næste niveauer angiver hele antal af den foregående beholder. Tilbehør kan knyttes til ethvert niveau som et helt antal pr. faktisk beholder. Alle komponenter i en pakning er lagerført emballage med `count`- eller `package`-enhed. Maksimalt 100 linjer pr. version. Hvert komponent-ID forekommer højst én gang i en version.

Kapaciteten pr. niveau er produktet af kapaciteterne. Behovet for beholdere rundes op; fulde beholdere, én eventuel delbeholder og restantal beregnes separat. Tilbehør gælder også delbeholdere. En valgfri palletype beskriver det yderste niveau; den er ikke selv et ekstra emballageforbrug. Pallen skal optræde som den relevante emballagekomponent. Modellen understøtter homogene indlejrede pakninger med tilbehør; blandede varer eller flere forskellige indre pakkeforløb i én palle er ikke en del af denne fase.

Varens tidligere `quantity_per_pallet` er fortsat vejledende og indgår **ikke** i beregningerne. Den valgte pakkeversion er beregningens eneste kapacitetsgrundlag.

## Entydigt forbrugsansvar

Produktionskomponenter tilhører BOM; pakke-/transportemballage tilhører pakning. Forbrugsansvaret gemmes i linjesnapshottet. Samme komponent må ikke optræde i både aktive aktuelle BOM- og pakkeversioner for samme vare. Databasen kontrollerer dette ved versionsskift og genaktivering. Ændringer serialiseres på produktets række, og NestJS bruger den eksisterende SERIALIZABLE-transaktion, så konkurrerende ændringer må afvises frem for at bryde reglen.

Ved flytning af et forbrugsansvar skal de konfliktende opsætninger først deaktiveres eller erstattes med nye versioner uden komponenten. Gamle versioner ændres ikke. Beregning af historiske versionskombinationer kontrollerer også overlap og afviser dobbelttælling. Det er en konservativ regel pr. komponent og vare: den samme SKU kan ikke have begge ansvar i samtidigt aktive opsætninger.

## API

Alle ruter er under `/api/companies/:companyId/recipes` og kræver login.

| Metode/rute | Handling |
| --- | --- |
| `GET ?product_id=UUID&kind=bom\|packing` | Opsætninger for en vare; typefilter er valgfrit |
| `POST /` | Opret med `{product_id,kind,name}` |
| `GET /:id` | Metadata, aktuel version med linjer og versionsoversigt |
| `PATCH /:id` | `{version,data:{name,active,is_default,notes}}`; versionskonflikt giver 409 |
| `POST /:id/revisions` | `{version,data:{base_quantity,pallet_type_id,notes,lines}}`; opretter og forsegler ny version atomisk |
| `GET /:id/revisions/:revisionId` | Historisk version; skal tilhøre opsætningen og virksomheden |
| `GET /:id/history` | Seneste 100 ændringer af opsætningen |
| `POST /calculate` | Read-only beregning med `{quantity,bom_revision_id?,packing_revision_id?}`; mindst én version kræves |

En linje består af `{component_id,kind,level,quantity}`. Ukendte felter afvises. Læsere må beregne, men ikke publicere. Foreign-company-adgang afvises før data hentes; ukendte objekter i egen virksomhed giver 404. SQL-/leverandørfejl og secrets sendes ikke til klienten.

## Kørsel og afgrænsning

Eksisterende Node 24/npm 11, miljøfiler og kommandoer fortsætter uændret: `npm ci`, `npm run dev`, `npm run check`, `npm run test:e2e`. Ingen nye pakker, miljøvariabler, secrets, services eller ressourcekonfigurationer er nødvendige. Readiness kræver nu de tre nye tabeller. Migrér derfor før ny backend deployment; gamle backendversioner er kompatible med den additive migration.

Online-kontrol: `node scripts/verify-recipes.cjs` på operatørens computer. Alle indtastninger er skjulte. Scriptet bruger eksisterende Supabase/Railway-adresser, accepterer kun en publishable key og skriver kun kontrollerede statuskoder. Det opretter ingen forretningsdata. Sessionen ryddes op hos Supabase. Tomme kataloger testes som tomme, og kontrollen af eksisterende versioner markeres tydeligt NOT_RUN, hvis sådanne ikke findes. Brug kun den allerede godkendte isolationstestvirksomhed.

Foto forbliver deaktiveret hosted. Ingen lagerplaceringer, fysiske paller, ordreoverrides, lagertransaktioner, reservationer, produktion, forecasting-jobs, integrationer eller fase 6-funktioner er implementeret. Senere ordrer kan referere til uforanderlige versioner og supplere dem med egne snapshots/overrides.
