# UI/UX — Etape 2: enkel oprettelse af stamdata

Udgangspunkt: main `afd97b1102b054ac94a3d28772741aa48653741f`, med filindhold identisk med godkendt Etape 1. Lokal arbejdsgren: `ux-stage2`.

## Implementeret omfang

- Kunder og leverandører: kun nummer og navn vises i den almindelige formular. Kontakt-/adressefelter, leveringstid, noter og aktiv-status ligger under “Flere oplysninger”.
- Varer og materialer: nummer, navn og valgfri lagerenhed med tydelig anbefaling. Lagerenhed kan stadig udfyldes senere og er fortsat låst efter eksisterende valg.
- Øvrige vare-/materialefelter, relationer, lagerstandarder, produktionsstandarder og aktiv-status ligger under “Flere oplysninger”.
- Nye poster er fortsat aktive som standard. Ingen automatisk nummerering eller nye obligatoriske felter.
- Sammenfoldning sker med native details; alle kontroller forbliver monteret. Ingen ændring af draft-initialisering eller submit-payload. Skjulte værdier nulstilles ikke. Eksisterende åbning af sektioner ved native valideringsfejl genbruges fra Etape 1.
- Deaktivering, historik, version ved redigering, relationsvalg og eksisterende serverkald bevares. Andre stamdatatyper og emballage får ikke det forenklede layout i denne etape.

Ingen backend-, database-, migrations-, sikkerheds- eller API-kontraktændringer. Serverens dubletkontrol, audit og virksomhedsisolation er uændrede. Foto forbliver deaktiveret hosted. Etape 3 er ikke startet.

## Målrettet verifikation

Frontend TypeScript og produktionsbuild: PASS. **39 unikke målrettede browserkontroller består** (13 scenarier på desktop, tablet- og mobilviewport). Første kørsel: 38 PASS og én mobil-overløbsfejl. Den konkrete årsag var et sorteringsfelt, hvis flex/grid-celle blev for smal. Mindstebredde og gridkolonne på toolbar-labels retter dette; den berørte mobiltest blev genkørt og består. Midlertidig layoutdiagnostik er fjernet. Ingen øvrige beståede tests gentaget efter rettelsen.

Kørsler:
```sh
npx playwright test tests/e2e/masterdata.spec.ts tests/e2e/items.spec.ts --grep-invert 'authorized photo|packaging is separate|creates a machine type' --workers=2
npx playwright test tests/e2e/items.spec.ts --grep 'minimal product create edit deactivate' --project=mobile --workers=1
npm run build -w @lager/web
```
Testbrowser: lokal Chromium 153, angivet via CHROMIUM_EXECUTABLE_PATH. Fuld gammel testsuite er ikke kørt.

Dækning: minimal oprettelse for alle fire typer, aktiv standard, skjulte kontakt-/leverandørværdier ved redigering, skjulte vare-/materialerelationer og eksakte decimaler, bevaret inaktiv status, lagerenhedens låsning, inline-oprettelse af lagerenhed, deaktivering/historik, læseadgang, virksomhedsskift samt validering af skjult e-mail og håndtering af serverens 409-svar uden tab af kladde.

Browserprøver bruger lokale API-fixtures. De dokumenterer frontendens payload og adfærd, ikke en ny database-/sikkerhedscertificering. Tidligere backend-/databasetest er ikke genkørt. Fysiske telefon-/tablettests og hosted verifikation: NOT_RUN.

Lokal implementering/test: forventet og realistisk worst-case ekstern merudgift 0 kr. Ingen push, hosted deployment, nye tjenester eller ressourceændringer. Publicering vurderes særskilt efter økonomireglen.
