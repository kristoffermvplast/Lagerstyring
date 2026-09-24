# UI/UX Etape 3 — lagerhandlinger med færre gentagne valg

Genimplementeret 2026-09-24 fra verificeret main `198c326947ff9aa14b06db911dd4d4ec5bab6031` på lokal arbejdsgren `ux-stage3-rebuilt`. Den tabte commit `a994ad7` er ikke rekonstrueret; dette er en ny implementering efter de godkendte krav. Leverancens nye SHA fremgår af Git-committen og overleveringen.

## Omfang

- Lagerkorrektion og forsendelseslinjer: ét beholdningsvalg samler ejer og placering og viser fysisk/tilgængelig mængde samt enhed. Ingen automatisk valg af en beholdning, selv ved ét resultat. Manuelt valg bevares til bl.a. oprettelse af ny positiv beholdning. Sideskift understøttes.
- Modtagelse: ejer forudfyldes kun ved præcis én aktiv ejer i et ufiltreret, afsluttet opslag. Rydning respekteres. Varens standardleverandør og standardplacering anvendes først efter validering af aktiv status og lagerplacering. Forsinkede svar overskriver ikke brugerens egne valg. Vareskift rydder vareafhængig kontekst.
- Reference, kommentar, transportør, forventet modtagelse, palleantal og valgfrie pakkedata ligger efter behov under “Flere oplysninger”. Felter forbliver monteret; sammenfoldning sletter ingen værdier eller udelader dem fra payload.
- Lagerflytning genbruger eksisterende samlet vare/ejer/fra-placering. Mængde og destination vælges eksplicit. Produktionsvariantens felter bevares; Etape 4 er ikke startet.
- Optælling viser den valgte beholdningskontekst; genoptællingsfeltet kan foldes sammen efter registrering. Godkendelse, reservationer, forældelsesadvarsler og annullering bevares.
- Primær handling fremhæves. QR genbruger eksisterende validering og åbner kun registreringen; scanning bogfører aldrig noget.

## Bevarede grænser

Ingen backend-, datamodel-, API-kontrakt-, migrations- eller lagerregelændringer. Bekræftelser, rettigheder, journalføring, ejerskab, enheder, decimalstrenge, pallehistorik, reservationer, godkendelser, modposteringer og virksomhedsisolation bevares. Serveren afgør altid aktuel beholdning og gyldighed ved skrivning. Forældede opslag giver ikke ekstra rettigheder. Eksisterende låsning og identisk idempotensnøgle/payload ved usikker forbindelse bevares. Ingen automatisk mængdekonvertering eller bogføring.

## Målrettede tests

- Frontend TypeScript og produktionsbuild: **PASS** (`npm run build -w @lager/web`).
- **78 browserprøver PASS**: 26 scenarier på desktop-, tablet- og mobilviewport.
- Den forsinkede standardtest blev skærpet til at afvente standardsvaret og genkørt alene på alle tre viewports: **3 PASS**. Disse er ikke tre ekstra unikke scenarier.
- `git diff --check`: PASS.

```sh
CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npx playwright test tests/e2e/inventory.spec.ts tests/e2e/receiving.spec.ts tests/e2e/transfers.spec.ts tests/e2e/shipments.spec.ts tests/e2e/stock-counts.spec.ts tests/e2e/qr.spec.ts --workers=2
CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npx playwright test tests/e2e/receiving.spec.ts --grep 'delayed standard lookup' --workers=2
```

Dækning: flere ejere/placeringer, ingen implicit beholdningsvalg, entydig aktiv ejer, inaktive standarder, manuelle valg mod forsinkede svar, vareskift, præcise delmængder, utilstrækkelig/forældet beholdning (serverafvisning), forkert/fremmed QR, ingen skrivning fra scanning, virksomhedsskift, læserettigheder, dobbelttryk, identiske genforsøg, optællingsgodkendelse og forældet optælling.

Browserprøver anvender lokale API-fixtures. Det er frontend-/payloadkontrol, ikke en ny databaseverifikation. Tidligere backend-/CI-tests er ikke genkørt. Tablet/mobil er Chromium-viewportprøver, ikke fysisk hardware eller Safari. Fysiske enheder og hosted verifikation for denne nye implementering: **NOT_RUN**. Normal Playwright-browserdownload fejlede; Chromium 153 blev installeret separat i testmiljøet uden ændring af projektets afhængigheder eller lockfil.

## Ændrede filer

Frontend:
- `apps/web/src/StockContext.tsx` (ny)
- `apps/web/src/Inventory.tsx`
- `apps/web/src/Receiving.tsx`
- `apps/web/src/Transfers.tsx`
- `apps/web/src/Shipments.tsx`
- `apps/web/src/StockCounts.tsx`
- `apps/web/src/Qr.tsx`

Tests:
- `tests/e2e/inventory.spec.ts`
- `tests/e2e/receiving.spec.ts`
- `tests/e2e/transfers.spec.ts`
- `tests/e2e/shipments.spec.ts`
- `tests/e2e/stock-counts.spec.ts`

Dokumentation:
- `README.md`
- `docs/architecture.md`
- `docs/ux-stage-3.md` (ny)

## Afslutning

Kun lokal implementering, test og commit. Forventet og realistisk worst-case ekstern merudgift: 0 kr. Ingen push til main, deployment, hosted skrivninger, nye tjenester eller ressourceændringer. Foto forbliver deaktiveret hosted. Etape 4 er ikke startet.
