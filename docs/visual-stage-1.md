# Visuel etape 1 — fælles grundstruktur

## Omfang og reference

Implementeret fra `main` `88bf5eb3cfd931200943484e424910e87bf934a9` på `visual-stage1-foundation`.
Brugerens `lagersystem1.png` er primær visuel reference: mørk venstremenu, lys hovedflade, blå primære handlinger, luftige kort, diskrete tabeller og app-lignende mobilnavigation. Dette er en separat visuel etape oven på de afsluttede funktionelle/UI-flow-etaper, ikke en gentagelse af dem.

## Implementeret

- Desktop: fast mørk navigation med ikoner, virksomhedsvælger, aktive markeringer og eksisterende grupper. Topbjælke med virksomhed, aktuelt område, brugerinitial og eksisterende logout.
- Mobil/tablet op til 800 CSS-pixels: bundnavigation med tilladte genveje og Menu. Hele menuen åbnes i dokumentets flow; den er ikke en modal dialog. Luk/Escape, fokusretur og Gå til menu er bevaret. Større tablets bruger desktopstrukturen.
- Forside: personlig overskrift, rettighedsafledte kort til modtagelse, flytning, produktion og forsendelser. Kort åbner arbejdsområder; de opretter/bogfører ikke poster.
- Dashboard: eksisterende data i fælles kort, statusmærker på ordrer/forsendelser, kompakte tomme advarselsgrupper og samlet historiksektion. Kritiske/aktuelle advarsler, delvist overblik, fejl, genindlæsning og kvittering bevares. Ingen konstruerede lagertal, aktivitetsstrømme eller påstand om at alt er OK.
- Tokens for farver, spacing, radius og skygge i `visual-foundation.css`, indlæst efter eksisterende stylesheet. Ingen ny dependency eller fonttjeneste.
- Fælles inputkanter, synlige fokusmarkeringer, blå primærknapper, hvide sekundære knapper, formulargrid, cards, lavere tabelstøj og blåtonede “Flere oplysninger”. Eksisterende felter/komponenter forbliver monteret.
- `Surface`, `StatusBadge` og `QuickActions` er fælles komponenter. `MoreInformation`, `SearchSelect`, formularer, API-klient og eksisterende permissions genbruges.

Mockuppets globale søgning og beskedklokke er ikke indført som inaktive/fiktive kontroller. Områdespecifik ombygning af vare-, modtagelses-, produktions- og scannerskærme er ikke udført i denne etape; de arver det fælles design.

## Ændrede filer

Frontend (6): `App.tsx`, `WorkspaceNavigation.tsx`, `Dashboard.tsx`, `main.tsx`, `VisualPrimitives.tsx`, `visual-foundation.css` under `apps/web/src`.

Tests (4): `tests/e2e/visual-foundation.spec.ts`, `dashboard.spec.ts`, `ux-stage1.spec.ts`, `ux-helpers.ts`. Navigationstestene åbner mobilmenuen eksplicit. Den eksisterende test for ugyldigt ejeropslag rydder først en allerede entydigt forudfyldt ejer, så den faktisk tester et manglende valg.

Dokumentation (3): dette dokument, README og architecture.

## Verifikation

- Frontend TypeScript + produktionsbuild: PASS.
- 30 unikke målrettede browserprøver: PASS (10 scenarier × desktop/tablet/mobil, lokal Chromium 153).
- Omfatter navigation, virksomhedsskift, rettighedsafledte genveje, ingen skriveresultater ved navigation/scanneråbning, foldede formularfelter, inputkanter, primærfarve, vandret side-overflow, referencesøgning, blokeret ugyldigt valg, dashboardmål, fejltilstande og identiske genforsøg på kvittering.
- Visuel gennemgang af lokale dashboard- og formularskærmbilleder mod referencen. Testdata er kun lokale fixtures.
- Tastaturkontrol: skip-link til indhold samt menuens fokus/Escape. Efter sidste justering består den nye visuelle suite igen: 9/9; disse er genkontroller af de samme scenarier, ikke yderligere unikke tests.
- Normal Playwright-browserdownload var beskadiget i arbejdsmiljøet. Chromium blev derfor pakket ud fra en separat midlertidig `@sparticuz/chromium`-installation. Projektets dependencies/lockfile er uændrede.
- Ingen fuld genkørsel af Fase 1–26-tests. Backend, database, migrationer og skrivekontrakter er uændrede.

## Begrænsninger og stoppunkt

Fysisk iPhone/iPad/Safari-test, skærmlæserprøve og hosted verifikation: NOT_RUN i denne visuelle etape. Viewports i Chromium er ikke fysisk enhedsverifikation. Senere skærmspecifikke etaper kræver særskilt godkendelse.

Ingen push, deployment, migration eller hosted konfigurationsændring. Forventet ny ekstern tjenesteudgift: 0 kr. Foto forbliver deaktiveret hosted; indstillingen er ikke ændret. Arbejdet stopper efter denne lokale implementering og dokumentation.

## Godkendt visuel poleringsrunde — 2026-09-25

Fortsættelse på samme branch fra `8da2832`. Kun de identificerede visuelle forskelle er bearbejdet:

- Menuen er 216 px bred, med tættere grupper, ét direkte Overblik, diskret QR og virksomhed/bruger/logout nederst. Forsiden åbner ikke automatisk Stamdata. Mobil har Hjem, Lager, Scan og Menu (færre ved manglende adgang); produktion og øvrige funktioner er fortsat i menuen og relevante genveje.
- Dashboardets genvejskort er lavere med kortere tekst. Status, aktive produktioner og dagens modtagelser/forsendelser står i tre desktopkolonner. Tomme advarselssektioner skjules; et neutralt statusudsagn gælder udtrykkeligt kun det viste udsnit. Delvise data, aktuelle fejl og kritiske advarsler bevares. Tidsstempel og forklaring kan åbnes under Om overblikket.
- Lettere menutekst, feltværdier og sekundære overskrifter. Obligatoriske felter markeres med dekorative stjerner; native required/aria-required og inputnavne er uændrede.
- Stamdata, varer, modtagelse og produktionsoprettelse skjuler den konkurrerende liste-/søgeflade under redigering via præsentationsklasser; query-/filtertilstande bevares. Formularernes luk/annullér-knap står før primærhandlingen i DOM og nederst til højre. De eksisterende bekræftelser ved usikre gemninger bevares.
- Åben produktionsordre får fokuseret visning med Tilbage til ordrer. Desktopopgaver står til venstre for den aktive opgave; alle tidligere paneler, kommandoer og historik består. Modtagelse får to desktopkolonner. Mobil har fortsat én kolonne.
- Gå til menu optager ikke længere plads på mobil, hvor bundmenuen overtager. Logout findes i den fulde menu; den overflødige topknap er fjernet.

### Målrettede kontroller

- Frontend typecheck/build: PASS.
- 30 navigations-, dashboard-, formular- og referenceprøver på desktop/tablet/mobil: PASS, med målrettede genkontroller efter justeringerne.
- 12 yderligere prøver af kunde-/vareoprettelse, redigering, deaktivering/historik, præcis modtagelse med identisk genforsøg og komplet produktionsforløb: PASS. Produktionsforløbet verificerer de samme 11 kommandoer, mængder og virksomhedsskift. Ældre mobile tests er tilpasset til først at åbne menuen før virksomhedsskift.
- Screenshotforløb desktop og mobil: PASS. Tablet-screenshotforløbet er bevidst skipped; tablet er dækket af flowprøverne. 42 unikke flowprøver plus 2 screenshotforløb; gentagne kontroller tælles ikke som nye prøver.
- Visuel kontrol opdagede en for bred CSS-regel for referencefelter, som blev afgrænset til vareformularens sektioner. Søgefelternes stjerner ligger uden for labelteksten, så de eksisterende feltopslag bevares.
- Ingen fuld genkørsel af de funktionelle faser. Ingen backend-/datamodel-/migrations-/dependencyændring, ingen hosted handling og ingen ny ekstern tjenesteudgift.

### Nye screenshots

`tests/e2e/visual-polish-screenshots.spec.ts` tager følgende fra den faktiske React-frontend med lokale API-fixtures. Filstien vælges med `VISUAL_SCREENSHOT_DIR`; default er test-results/visual-polish.

1. `01-dashboard-desktop.png`
2. `02-opret-vare-desktop.png`
3. `03-modtagelse-desktop.png`
4. `04-produktionsordre-desktop.png`
5. `05-lageroversigt-desktop.png`
6. `06-mobilforside.png`
7. `07-mobil-scanning.png`

Eksempelposter er udelukkende testfixtures, ikke nye produktionsdata. Scanningsbilledet viser skærmen før kamerastart, ikke en fysisk kameratest. Screenshots er hele sider; faste navigationselementer følger browserens viewport. Fysisk telefon/tablet/Safari er fortsat NOT_RUN. Ingen publicering til main. Fotoindstillinger og øvrig hosted konfiguration er uændrede.
