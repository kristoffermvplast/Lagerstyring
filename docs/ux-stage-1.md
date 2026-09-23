# UI/UX — Etape 1: navigation og fælles formularprincipper

## Status og afgrænsning

Implementeret lokalt fra `main` `70336e0` på `ux-stage1` den 23. september 2026.
Kun Etape 1 er implementeret. Ingen publicering, CI-kørsel, hosted deployment eller migration i denne runde. Etape 2–4 kræver fortsat særskilt igangsættelse.

## Ændringer

- Arbejdsområder grupperet i Overblik, Lager, Produktion, Stamdata og Administration. Kun én gruppe åben ad gangen; eksisterende tilladte sider bevares. Scan QR er direkte tilgængelig.
- Aktiv side fremhæves, dens gruppe åbnes automatisk, og virksomhedsskift nulstiller navigationens gruppetilstand. Eksisterende rettighedsbetingelser og virksomhedsnøgler er bevaret.
- Gå til menu ruller til menuen, nulstiller dens interne rulning og flytter tastaturfokus. Navigationen er fortsat højdebegrænset på små skærme.
- Fælles synlige feltkanter, minimum 44 px kontrolhøjde, 16 px felttekst, tydelig obligatorisk markering og primærknap-styling. Eksisterende status- og fejlbeskeder får tydeligere visuel adskillelse.
- Native valideringsfejl åbner overliggende sammenfoldede sektioner, så det fejlede felt er tilgængeligt.
- Stamdatalisters status/sortering ligger under Filtre og sortering; ændrede filtre markeres også i sammenfoldet tilstand. Søgning og Opret ny er direkte synlige.
- Det eksisterende fælles Inventory.Picker bruger nu ét søgbart combobox-felt. Tastaturvalg, rydning, valgt værdi, indlæsning, tomme resultater, fejl og genforsøg understøttes. Fritekst er aldrig et ID; kun eksplicit valg ændrer værdien. Søgegrænse 100 og eksisterende API-kald bevares. Et valgt ID bevares, når søgningen ændres eller afbrydes.
- Eksisterende browsertests er tilpasset den grupperede navigation og fælles referencekontrol via små testhelpers. Forretningsassertioner bevares.

Formularernes domænefelter, avancerede stamdata, lagerforudfyldning og produktionsarbejdsopgaver hører til de senere etaper og er ikke omlagt her. Specialiserede vare-/lokations-/opskriftsopslag er bevaret; de kan tilpasses i deres godkendte etape.

## Bevarede grænser

Backend, database, API-kontrakter, sikkerhed, audit, virksomhedsskel, lagerregler, decimalbehandling, idempotens og forretningsvalidering er uændrede. Ingen nye standardejere, varenummergeneratorer eller automatiske bogføringer. Foto forbliver deaktiveret hosted.

## Målrettet verifikation

- Frontend TypeScript-kontrol og produktionsbuild: PASS.
- 39 unikke Playwright-kontroller: PASS på desktop, tablet- og mobilviewport (13 scenarier × 3).
- Dækning: grupper/aktiv side/rettigheder, virksomhedsskift, fokus/menu, smal skærm og decimalinput, stamdatalistefiltre, minimal stamdataoprettelse/redigering/historik, læseadgang, inline-kladdens bevarelse, søgefejl/tom liste/tastaturvalg, fritekst uden valgt ejer blokerer modtagelse, samt identiske genforsøg for modtagelse, lagerkorrektion og forsendelseskladde.
- Første browserforsøg kunne ikke starte: standardbrowser-download var utilgængelig. Lokal Chromium 153 blev derefter installeret som midlertidigt testværktøj uden ændring af projektets afhængigheder.
- Under test blev labelopslag i den nye kontrol og tests rettet. Slutresultat: 27 beståede kontroller fra `masterdata`, `mobile-workflows` og de nye navigations-/opslagstests; derefter 12 beståede målrettede kontroller for filtre, obligatoriske valg, lagerkorrektion og forsendelseskladde. Ingen udestående testfejl i dette scope.
- Backend/databasetest og fuld historisk CI-suite: ikke genkørt. Playwrights eksisterende startkommando byggede lokal API til testserveren; ingen hosted database blev brugt.
- Fysisk telefon/tablet og hosted UI-verifikation af denne ændring: NOT_RUN. Viewporttests er ikke fysisk enhedsverifikation.

Reproduktion med installeret Playwright-browser:

```sh
npx playwright test tests/e2e/masterdata.spec.ts tests/e2e/mobile-workflows.spec.ts tests/e2e/ux-stage1.spec.ts
npx playwright test tests/e2e/inventory.spec.ts tests/e2e/shipments.spec.ts --grep 'draft creation|confirms correction'
npm run build -w @lager/web
```

Lokale tests og værktøjer: forventet og realistisk worst-case ny ekstern tjenesteudgift 0 kr. Ingen ressourcer eller spend/usage limits ændret. Publicering/deployment er ikke udført.
