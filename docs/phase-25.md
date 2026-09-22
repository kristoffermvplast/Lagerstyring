# Fase 25 – Forecasting-grundlag

## Scope og status

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
