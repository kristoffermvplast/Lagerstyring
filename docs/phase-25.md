# Fase 25 – Forecasting-grundlag

## Scope og status

**Afsluttet 2026-09-22** med brugerbekræftet `PHASE_25_READ_ONLY_VERIFICATION: PASS` inden for det nedenfor dokumenterede omfang. Tidligere afventende stoppunkter er historik og erstattes af den endelige verifikation nederst.

Implementeret fra main `363e6e07bfd89129f59f1efe3f1d5e7213ff3a48` på `phase25-forecast`. Faseplanens acceptkriterium er, at behov og reservationer ikke tælles dobbelt. Læsebaseret, eksplicit ejerafgrænset scenarieberegning; ingen lagerposteringer eller nye databaseobjekter.

API: `GET /api/companies/:companyId/forecast/options`, `POST /api/companies/:companyId/forecast/preview` (200; læsning trods POST). UI: **Prognose**, eksisterende formularlayout med vare, ejer og slutdato. Produktionsordrer, tilknyttede frie reservationer og forventede leverancer er valgfrie. Ingen redesignrunde.

## Beregning og sporbarhed

- Én vare, én lagerenhed og én eksplicit lagerejer. Ejerens placeringer summeres; andre ejeres lager lånes ikke. Nødvendige interne flytninger planlægges ikke automatisk.
- Startpulje = fysisk beholdning − aktive reservationer − nettomateriale bundet i alle ikke-afsluttede produktionsordrer hos ejeren. Materiale ved maskinen er stadig fysisk lager, men er ikke frit til planlægning.
- Valgt produktionsordres resterende behov = max(0, snapshotberegnet BOM/pakningsbehov − nettoudleveringer fra alle ejere til ordren). Eksisterende `production_material_state` genbruges, så retur og modposteringer følger lagerjournalen. Overudlevering bliver ikke automatisk fri beholdning.
- Produktionsordrer har ingen bindende fremtidig lagerejer. Brugeren vælger derfor udtrykkeligt, hvilke ordrers resterende behov denne ejer antages at dække. Kun planlagt/klar/i produktion kan vælges. Kladder, afstemning og afsluttede ordrer er ikke nye fremtidige behov.
- Planlagte/reserverede/klargjorte forsendelser inden slutdatoen indgår automatisk. Kladder, annullerede og afsendte forsendelser udelades. Kun forsendelsens egne aktive reservationer krediteres ved dens behov, så fradraget kun sker én gang.
- Frie reservationer har ingen relationsnøgle til produktion. Brugeren kan eksplicit vælge dem, der dækker de valgte ordrer. Kun aktive reservationer for denne vare/ejer uden forsendelseskobling accepteres. Puljen modregnes én gang i behovsrækkefølge, højst resterende behov. Ubrugt reservation forbliver bundet. Tekstreferencer bruges aldrig til at gætte relationer.
- Forventede leverancer er **ubogførte scenarieinput**: unik reference, forventet dato og resterende positiv mængde. De opretter ikke indkøb/modtagelser og gemmes ikke. Allerede modtagne mængder skal udelades.
- Disponibelt ved slutdato = startpulje + forventede tilgange − resterende behov + reservationer, der allerede dækkede netop disse behov. Resultatet er prognosticeret disponibelt, ikke en ny fysisk lagersaldo.
- Decimalstrenge og BigInt med 8 decimaler; ingen floating-point lagerberegning. Enheder blandes ikke. Snapshot-enhedsskift afvises, tælleenheder kræver hele leveringsmængder.
- Dansk tid. Udaterede/forfaldne behov regnes ved start. Behov regnes konservativt før tilgang samme dag. Slutbalance og største mangel undervejs vises; en sen levering skjuler ikke en tidligere mangel.
- JSON-download indeholder virksomhed, tidspunkt, input/antagelser, kilde-ID'er, ordre-/lagerrevisioner, udlevering/retur, reservationer, forsendelsesversioner, tidslinje og SHA-256 over payload uden hashfeltet. Det er et dokumenterbart øjebliksbillede, ikke servergemt auditkvittering eller signatur. Eksisterende historik ændres ikke.

## Sikkerhed og begrænsninger

Eksisterende sessionkontrol, serialiserbar transaktion, begrænset databasebruger og tenant-RLS. Alle fire kilderettigheder kræves: `inventory.read`, `production.read`, `masterdata.read`, `shipments.read`. Ingen nye rettigheder, tabeller, privilegier, browser-Data-API-kald eller migrationer. Parameteriseret SQL med company-filter; andre virksomheders objekter lækkes ikke. Ingen hemmeligheder i beregningsgrundlaget.

Højst 50 ordrer, 50 frie reservationer, 50 leverancer og 730 dages horisont; strikte input og unikke ID'er/referencer. Kildegrænser: 500 beholdningsplaceringer, 500 relevante åbne ordrer, 2.000 materialeposter, 500 forsendelser og 200 ejere. For store beregninger afvises uden et misvisende delresultat. Varesøgning viser 50 og oplyser behov for afgrænsning. Database-/computeindstillinger er uændrede.

Ingen vedvarende leveranceplan, indkøbsmodul, automatisk planlagt produktionstilgang, statistisk salgsprognose, spild-/udbytteprognose, kapacitetsplan eller automatisk ejerallokering. Scenarier må ikke summeres på tværs af ejere uden revurdering af ordrevalg. Reservationer efter horisonten forbliver bundet i startpuljen. Udeladte ordrevalg er en eksplicit scenarieafgrænsning, ikke garanti for en fuldstændig virksomhedsprognose.

## Verifikation

- 16 målrettede lokale beregnings-/API/databasetests PASS: decimaler/negative brøker, mangel før levering, reservation mod behov, nettoudlevering/retur/modpostering, ejere/overudlevering, forsendelse før/efter reservation/afsendelse, input/stale valg/datagrænse, isolation, kilderettigheder, tilbagekaldt session, HTTP-auth og uændret lagerjournal.
- Begge workspace-typechecks og builds PASS.
- 3 browsercases til desktop/tablet/mobil (9 kørsler): rettigheder, eksplicitte valg, download, ændrede input, fejl/stale resultat og virksomhedsskift. Testindsamling PASS. Lokal eksekvering blokeret: Chromium-download gav ugyldige/afkortede zip-filer. Ingen lokal browser-PASS påstås.
- Eksisterende CI køres på arbejdsgrenen for at verificere den nye controllerregistrering og navigation sammen med systemet. Resultatet dokumenteres efter kørslen.

## Økonomi og hosted grænse

Lokale ændringer/tests: 0 kr. Repository er verificeret offentligt; CI bruger `ubuntu-latest`, uændret workflow/lockfile og ingen nye artifact-/cachetrin. Arbejdsgren + standard-CI: forventet 0 kr., realistisk worst-case 0 kr., jf. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Railway-forbindelsen bekræfter source-branch `main`; ingen PR-/previewmiljøer oprettes.

Main/Railway-publicering er ikke udført. Senere main-publicering vurderes særskilt efter 1 kr.-reglen. Ingen migration kræves eller køres. Foto forbliver deaktiveret hosted. Supabase-skillens changelog/RLS-dokumentation er kontrolleret; ingen nye Supabase-funktioner/adgangsændringer.

Afsluttende UI/UX-krav bevares: færre obligatoriske felter, nødvendige oplysninger synlige som standard, skjulte/valgfrie avancerede felter, enklere oprettelsesflows og intuitiv navigation med mindre informationsmængde. Fase 26 er ikke startet.

## Første CI og målrettet rettelse

Arbejdsgrenen blev publiceret som `35495ddda5fd96b34dc3cc43b12dcbd6fd2d6f28`, identisk tree `e42c9ae58511413b1853274deb6758f565119040` med lokal `6eae5eb`. CI [35700939852](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35700939852): 302 unit/API/databasetests PASS, 21 PostgreSQL-samtidighedstests PASS, 234/240 browserprøver PASS. De seks fejlede kørsler er to nye forecast-cases i hver af tre viewports. Præcis label-locator fandt ikke vare-select, fordi Playwright medtager optiontekst fra det omsluttende label. Vare og lagerejer får eksplicitte, synlige-tekst-matchende aria-labels. Ingen beregnings-, database- eller andre workflowændringer. Runtime/TLS-trin blev sprunget over efter browserfejlen og afventer den korrigerede CI-kørsel.

## Endeligt CI-resultat og stoppunkt

2026-09-22: [CI 35701878822](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35701878822), job `106661568335`, **SUCCESS** på `804fc57872054827ddc2d3e01ef7ef380bee963f` på `phase25-forecast`.

- 302 unit/API/databasetests PASS.
- 21 PostgreSQL-samtidighedstests PASS i separat jobtrin. De samme 21 er sprunget over i det almindelige Vitest-trin; ingen dobbelttælling.
- 240 browserprøver PASS, inklusive alle ni nye forecast-kørsler på desktop/tablet/mobil.
- Begge workspace-typechecks/builds, backend runtime-image, diagnostikscript og strict TLS/CA-runtimekontrol PASS.
- Remote branch/tree er læst tilbage: `804fc57872054827ddc2d3e01ef7ef380bee963f`, tree `05a6884f1a9fff802f33fec0923e2998f75fc082`, præcis samme indhold som lokal labelrettelse `89a191a`.
- Main er kontrolleret uændret på `363e6e07bfd89129f59f1efe3f1d5e7213ff3a48`.

Implementering og CI-verifikation er færdige inden for det dokumenterede scenariescope. **Hosted publicering og målrettet online-verifikation udestår**; ingen online-PASS eller fuld hosted afslutning påstås. Ingen migration kræves. Ingen ny lokal gentagelse af allerede bestået CI. Denne afsluttende dokumentationsopdatering gemmes kun lokalt, så en ekstra CI-kørsel ikke udløses.

For eventuel senere main/Railway-publicering gælder et nyt økonomisk stoppunkt: forventet 0–0,30 kr., realistisk worst-case 1–3 kr. for én normal automatisk deployment, baseret på build/opstart og kort containeroverlap på eksisterende uændrede Railway-ressourcer. Estimatet er ikke en udbydergaranti; ingen sådan handling er udført eller godkendt her. Foto forbliver deaktiveret hosted. Fase 26 er ikke startet.

## Hosted publicering og offentlig kontrol – 2026-09-22

Brugeren godkendte konkret main-publicering af `804fc57`, én normal automatisk Railway-deployment og målrettet online-verifikation (forventet 0–0,30 kr., realistisk worst-case 1–3 kr.). Main blev fast-forwardet uden force til `804fc57872054827ddc2d3e01ef7ef380bee963f`; remote main er læst tilbage og verificeret. Lokale dokumentations-/verifier-commits blev ikke medtaget.

Railway-forbindelsen verificerede automatisk deployment `9c7d5f12-0f39-4d04-9b8f-82b2c5802441`: branch main, præcis `804fc57872054827ddc2d3e01ef7ef380bee963f`, **SUCCESS** (2026-09-22T08:12:04.945Z). Ingen manuel deployment, migration, miljø-, ressource- eller konfigurationsændring. Fotoindstillinger er uændrede/deaktiverede hosted.

Målrettede offentlige HTTPS-kontroller består:

- `/api/health/live`: 200.
- `/api/health/ready`: 200.
- Forecast options GET uden token: 401, ikke 404.
- Forecast preview POST med tom JSON uden token: 401, ikke 404; ingen beregning/skrivning gennemføres uden auth.

**Autentificeret online-verifikation afventer operatørlogin.** Der er ingen brugeradgangskode/session i Work-sessionen. Intet endeligt `PHASE_25_READ_ONLY_VERIFICATION: PASS` påstås endnu.

`scripts/verify-forecast.cjs` er klargjort lokalt: skjult indtastning af offentlig publishable key, e-mail, password, virksomhedsnavn og eksisterende isolationsvirksomheds-ID; real-login/session, fire kilderettigheder, options/scope, isolationsafvisning på begge endpoints, not-found, læsebaseret POST-preview med eksisterende vare/ejer, decimaler, formel og SHA-256 samt lokal sessionsoprydning. Ingen hosted fixtures, ordreændringer, reservationer eller lagerposteringer. Eventuel manglende eksisterende vare/ejer logges eksplicit som `FORECAST_EXISTING_RECORD_PREVIEW: NOT_RUN`; komplekse issue/return/reservation-scenarier dækkes af eksisterende CI og skabes ikke hosted.

Tre nye målrettede verifier-tests PASS (success, afvisning ved scope/formelfejl med cleanup, tomt datagrundlag uden fixture); syntakskontrol PASS. De allerede beståede applikations-/CI-tests blev ikke genkørt manuelt. Main-push kan automatisk starte repositoryets uændrede CI. Script, tests og denne status er kun lokale følgefiler, ikke en ekstra deployment.

Fase 25 kan først færdigmeldes hosted efter den autentificerede operatørkontrol. Fase 26 er ikke startet.

## Endelig online-verifikation og afslutning – 2026-09-22

Brugeren har bekræftet følgende slutresultat fra den autentificerede online-kontrol:

`PHASE_25_READ_ONLY_VERIFICATION: PASS`

- Login og session: PASS.
- Forecast permissions: PASS.
- Forecast options read: PASS.
- Response scope/shape: PASS.
- Virksomhedsisolation: PASS.
- Not-found-adfærd: PASS.
- Session cleanup: PASS.

Forventede afgrænsninger bevares ordret:

```text
FORECAST_EXISTING_RECORD_PREVIEW: NOT_RUN (no existing item/owner pair; no fixture created)
FORECAST_COMPLEX_SCENARIOS: NOT_RUN (no hosted fixtures; issue/return/reservation scenarios covered by CI)
```

Der er ikke oprettet hosted fixtures. Positiv previewberegning med eksisterende vare/ejer, tilhørende decimal-/formel-/hashkontrol og komplekse issue/return/reservation-scenarier påstås ikke gennemført online. Deres beregnings- og sikkerhedsdækning er den allerede dokumenterede lokale/CI-verifikation på `804fc57`. Online-resultatet er brugerbekræftet; ingen tests eller hosted kontroller er gentaget ved denne dokumentationsafslutning.

**Fase 25 er afsluttet** på dette grundlag. Main og automatisk Railway-deployment på `804fc57` er tidligere verificeret som beskrevet ovenfor. Ingen migration kræves eller er kørt for Fase 25. Foto forbliver deaktiveret hosted. Ingen kode-, konfigurations- eller ressourceændringer, ekstra deployment eller eksterne tjenesteudgifter ved denne lokale dokumentationsopdatering. Afslutningsdokumentationen er gemt lokalt og endnu ikke publiceret til main.

UI/UX-forenklingskravene bevares til den afsluttende UI/UX-fase. Fase 26 er ikke startet.
