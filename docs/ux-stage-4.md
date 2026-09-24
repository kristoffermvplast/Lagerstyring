# UI/UX Etape 4 — produktion som tydelige arbejdsopgaver

Implementeret 2026-09-24 fra main `4a5b918d4b73335a796777261ca0508e1bee0601` på lokal gren `ux-stage4-production`. Etape 3 er brugerbekræftet afsluttet og Railway SUCCESS. Denne leverance er ikke publiceret.

## Forenkling

- Produktionsordren har én synlig opgave ad gangen: ordre/klargøring, materialeudlevering, produktionsregistrering, fysisk spild, lageraflevering eller retur/afslutning. Valgt opgave er markeret, og status samt næste relevante trin står over opgaverne.
- Problemmarkering og advarsler forbliver synlige på tværs af opgaver. Ordrehistorik er stadig tilgængelig. Ordre-QR ligger i en særskilt sektion.
- Opgaveskift skjuler, men afmonterer ikke formularerne. Kladder, afventende kommandoer, låste felter og idempotensnøgler bevares. Ordre- og virksomhedsskift adskiller komponenttilstand.
- Ny ordre viser vare, ordrenummer og planlagt antal først. Eksisterende serverstandarder genbruges. Kunde, maskine, revisioner, pakkeafvigelser, datoer, prioritet og noter ligger under “Flere oplysninger”. Manglende maskine/stykliste/pakning fremhæves før planlægning. Ingen nye standarder gættes, og ingen backendkrav gøres valgfrie.
- Produktionsregistrering viser nye gode emner først; kasser og kommentar ligger under “Flere oplysninger”. Registrering ændrer fortsat ikke fysisk lager.
- Lageraflevering er en separat opgave med mængde/ejer/placering først; palletype, eksisterende produktionsdato og kommentar kan foldes ud. Den øger fysisk færdigvarelager og genforbruger ikke materialer eller emballage.
- Materialeudlevering bevarer det samlede beholdningsvalg og eksisterende maskinplacering. Returformularen åbnes eksplicit under “Returnér ubrugt materiale”. Afstemning, genåbning og permanent afslutning bevarer deres særskilte bekræftelser.
- Den gamle tekst om endnu utilgængelig lageraflevering er rettet til at pege på den eksisterende opgave.
- Afstemnings-, materialeflytnings- og registreringstabeller ruller inden for deres eget område, så brede tabeller ikke blokerer mobilbetjening.

## Bevarede regler

Kun frontendpræsentation og tests/dokumentation er ændret. Ingen backend-, datamodel-, migrations-, afhængigheds- eller API-kontraktændringer. Ordrestatusser, versionskontrol, låste revisioner, materialeforbrug, retur, korrektioner, historik, rettighedsbetingelser og virksomhedsisolation er uændrede. Eksisterende kommandoindhold, decimalhåndtering, bekræftelser og genforsøgsmekanismer bevares. Skjulte felter forbliver monteret og indgår fortsat i samme payload. Scanning bogfører ikke noget.

## Målrettet verifikation

**Frontend TypeScript/produktionsbuild: PASS. 60 unikke browserprøver: PASS** (20 scenarier på desktop-, tablet- og mobilviewport, Chromium 153).

Kørsler:
1. Seks eksisterende berørte suites: 51 prøver, 49 PASS og 2 mobilfejl i retur/afslutning.
2. Tre nye scenarier: 9 prøver, 8 PASS og 1 mobilfejl i det samlede forløb.
3. Årsag: bred afstemningstabel kunne interceptere tryk på kontroller uden for skærmbredden. Tabellerne fik afgrænset vandret rulning. Fire berørte suites blev genkørt: **27 PASS**, inklusive alle tre tidligere fejl. Allerede beståede øvrige suites blev ikke gentaget.
4. Endeligt `npm run build -w @lager/web` og `git diff --check`: PASS.

```sh
CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npx playwright test tests/e2e/production-orders.spec.ts tests/e2e/material-issues.spec.ts tests/e2e/production-registrations.spec.ts tests/e2e/production-close.spec.ts tests/e2e/production-waste.spec.ts tests/e2e/finished-goods.spec.ts --workers=2
CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npx playwright test tests/e2e/ux-stage4.spec.ts tests/e2e/production-orders.spec.ts tests/e2e/production-registrations.spec.ts --grep stage4 --workers=2
CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npx playwright test tests/e2e/production-close.spec.ts tests/e2e/material-issues.spec.ts tests/e2e/production-registrations.spec.ts tests/e2e/ux-stage4.spec.ts --workers=2
```

Det samlede forløb kontrollerer planlægning → materialeudlevering → klar/start → delregistrering → delaflevering → restregistrering → spild → retur → afstemning → afslutning. Kommandoernes rækkefølge og mængder/ejer/placering/review-token kontrolleres eksplicit. Registrering alene giver ikke en lagerafleveringskommando. Øvrige prøver dækker modpostering af aflevering og spild, læseadgang, virksomhedsskift, usikre svar med samme kommando og nøgle, manglende opsætning uden gættede værdier samt bevaret låst registrering ved opgaveskift.

Testene bruger lokale API-fixtures og verificerer frontendens API-kontrakter og visning af serverresultater. De genbeviser ikke backendens bogføringsberegninger; uændrede Fase 1–26-regler og tidligere testresultater bevares. Fysiske telefon-/tablettests, Safari og hosted verifikation af Etape 4: **NOT_RUN**. Ingen gammel fuld testsuite er genkørt.

## Ændrede filer

Frontend (6):
- `apps/web/src/ProductionOrders.tsx`
- `apps/web/src/MaterialIssues.tsx`
- `apps/web/src/ProductionRegistrations.tsx`
- `apps/web/src/ProductionClose.tsx`
- `apps/web/src/ProductionWaste.tsx`
- `apps/web/src/FinishedGoods.tsx`

Tests (7):
- `tests/e2e/production-orders.spec.ts`
- `tests/e2e/material-issues.spec.ts`
- `tests/e2e/production-registrations.spec.ts`
- `tests/e2e/production-close.spec.ts`
- `tests/e2e/production-waste.spec.ts`
- `tests/e2e/finished-goods.spec.ts`
- `tests/e2e/ux-stage4.spec.ts` (ny)

Dokumentation (3): `README.md`, `docs/architecture.md`, `docs/ux-stage-4.md` (ny).

Lokal implementering/test: forventet og realistisk worst-case ekstern merudgift 0 kr. Ingen push, hosted deployment, migration eller ressourceændring. Foto forbliver deaktiveret hosted. Arbejdet stopper her; nye etaper kræver særskilt godkendelse.
