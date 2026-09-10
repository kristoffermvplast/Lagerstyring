# Fase 2 – faktisk teststatus

## Bestået lokalt

npm run check: 44 tests fordelt på 10 testfiler, TypeScript-kontrol af API/frontend og begge produktionsbuilds.

Testene omfatter:
- Eksisterende fundament, TLS/CA-konfiguration og sikker fejlhåndtering.
- Begge migrations kørt i isoleret PGlite/PostgreSQL med minimale auth.users/auth.sessions-testtabeller.
- To virksomheder med adskilte administratorer, en læsebruger og en bruger uden medlemskab. Operator-bootstrap testes også med et særskilt fixture-navn. Ingen fixtures oprettet eksternt.
- Manglende kontekst giver ingen medlemskabsdata; transaktionskontekst nulstilles.
- En administrator kan ikke læse eller ændre den anden virksomheds adgangsdata.
- Composite FK afviser tildeling af en rolle fra en anden virksomhed.
- Læsebrugeren kan ikke oprette roller eller eskalere sit eget medlemskab.
- Sidste administrator kan ikke deaktiveres, og audit kan ikke slettes af runtime.
- Inaktivt medlemskab mister adgang ved efterfølgende forespørgsel.
- Profiler er afgrænset til egen profil og autoriseret medlemsadministration i valgt virksomhed.
- Browserroller kan ikke kalde den privilegerede session-probe.
- Den kompilerede NestJS-app testes med rigtig RLS og en lokal Auth-serverstub: manglende/forfalskede/udløbne tokens, forkert issuer/role/sub/session og metadata-baserede eskaleringsforsøg afvises.
- Profilændringer valideres, ekstra inputfelter afvises, gamle medlemskabsversioner giver konflikt.
- Slettet Supabase-session afvises; logout-session kan ikke genbruges.
- Operator-bootstrap opretter fem standardroller, første administrator og audit atomisk.
- Fejlet rollback medfører kassation af poolforbindelsen.
- Privilegerede Supabase API-nøgler afvises som public Auth-konfiguration.

Auth-serverstubben accepterer kun præregistrerede testtokens. Dette verificerer backendens tillidsgrænse og efterfølgende claims-/rettighedskontrol, ikke en live Supabase-signaturvalidering.

## Browserverifikation efter genoptagelse fra f0c46e7

Den tidligere downloadblokering er løst med en midlertidig lokal Chromium 152.0.7977.0 fra @sparticuz/chromium 152.0.0. Browseren er installeret uden for repositoryet; ingen produktionsdependency, lockfile eller ekstern service er ændret.

CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e: **24 beståede browsercases** (otte flows på desktop, tablet og mobil). Supabase SDK kører i browseren, mens Auth-/profil-/adgangssvar er lokale fixtures. Ingen rigtige credentials eller hosted Auth-kald.

Dækning:

- Responsivt loginlayout og ærlig API-fejlvisning.
- Login, profil, adgang uden administrationsrettigheder og logout.
- Session gendannes efter genindlæsning; token gemmes ikke i localStorage.
- Udløbet access-token fornyes, før beskyttet API kaldes, og API modtager det nye token.
- Afvist refresh-token sender brugeren til login uden beskyttede API-kald.
- Ved fejl i serverlogout kan lokal session lukkes; den forbliver lukket efter genindlæsning.
- Skift fra en virksomhed med administrationsadgang til en anden uden denne adgang fjerner den første virksomheds medlemsdata og administrationsknapper.

Screenshots af login og adgangsadministration er gennemgået. Den visuelle kontrol fandt et sammenklemt rollefelt på tablet/mobil; feltet har nu minimumsbredde 170 px, og tabellen kan scrolles inde i sit kort. Indholdsområdets bredde er også bundet til den tilgængelige plads. Overflow-tests sammenligner nu med den konfigurerede viewportbredde, så mobilbrowserens automatiske udvidelse af layoutviewport ikke kan skjule en fejl. Den samlede kørsel på 24 cases er genkørt efter rettelsen; den bevarede Playwright-resultatfil viser passed uden fejlede tests. Mobil-screenshot er kontrolleret efter genoptagelsen. Tabellen scroller inde i kortet uden horisontal overflow på selve siden.

Dette er Chromium med emulerede skærmstørrelser, ikke fysisk iPhone/iPad eller Safari. Browserfixtures beviser UI-/SDK-adfærd; backendens RLS-verifikation ligger i de separate NestJS/PGlite-tests.

## Lokal PostgreSQL-samtidighedstest: miljøblokering

PostgreSQL 17.6-binærer blev hentet midlertidigt lokalt (@embedded-postgres/linux-x64 17.6.0-beta.15), men kørselsmiljøet er root og tillader ikke skift til en ikke-root-bruger (`runuser: cannot set groups: Operation not permitted`). En PostgreSQL-server kan derfor ikke startes normalt her. Ingen sikkerhedsgrænser er omgået, ingen hosted database er oprettet, og samtidighedstesten rapporteres ikke som bestået.

## Ikke udført

- Push eller GitHub Actions-kørsel for Fase 2.
- Railway-deployment eller ændringer af hosted miljøvariabler.
- Hosted Supabase-migration, Auth-konfiguration eller bruger-/virksomhedsoprettelse.
- Ægte Supabase-login, refresh, logout og readiness fra Railway med Fase 2.
- Samtidige administratorændringer på flere rigtige PostgreSQL-forbindelser. SERIALIZABLE og databaseinvarianten er implementeret; PGlite er ikke bevis for denne samtidighedstest.
- Docker-runtime-build for Fase 2 (Docker mangler lokalt).
- Mailudsendelse eller aktivering af SMTP.

Fase 1 forbliver afsluttet. Fase 2 må ikke markeres fuldt online-verificeret på baggrund af de lokale tests alene. Ekstern aktivering afventer økonomisk afklaring under brugerens 0 kr.-regel. Ingen Fase 3-implementering.

## Ændringer i denne fortsættelse

- Fortsat direkte fra f0c46e7 på phase2-auth.
- Ny tests/e2e/session.spec.ts med fem ekstra flows på tre skærmstørrelser.
- tests/e2e/foundation.spec.ts gemmer login-screenshot til lokal visuel kontrol. Overflow-kontrollen i tests/e2e/access.spec.ts er også skærpet.
- apps/web/src/styles.css retter rollefeltets bredde.
- Dokumentation ajourført; ingen nye migrationer eller ændringer i de eksisterende migrationsfiler.
- npm run check genkørt og bestået: 44 tests, typekontrol og begge builds. Den endelige CSS-rettelse er efterfølgende verificeret med den samlede browserkørsel.
- Ingen push, hosted SQL, deployment, ressource-/planændring eller nye eksterne services.
