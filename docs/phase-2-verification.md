# Fase 2 – faktisk teststatus

## Endelig status — Fase 2 afsluttet

Den godkendte leverance og den aftalte online-verifikation er afsluttet. Dette afsnit erstatter tidligere statusnotater om manglende aktivering, bruger, bootstrap, login og isolation; de bevares nedenfor som historik. Fase 3 er ikke startet.

### Verificeret resultat

- Brugeren har rapporteret PASS fra det ægte Supabase-loginforløb: session, backend-accept, profilidentitet, MV Plast-medlemskab, adgang og administratorpermissions, refresh, logout, afvisning af begge tokens efter logout og Supabase-sessionoprydning.
- Brugeren har rapporteret PASS fra isolationstest version 4: forudsætninger, læsning af egne medlemmer/roller/audit, afvisning af fremmed adgang/medlemmer/roller/audit, afvisning af fremmed rolleændring, afvisning af fremmed rolle-ID under egen virksomhed, bevaret egen adgang og sessionoprydning. De forventede HTTP-svar er 403 for fremmed virksomhedsadgang og 404 for fremmed rolle-ID under egen virksomhed.
- Efter testen er testvirksomheden kontrolleret direkte med én read-only hosted SQL-forespørgsel. Navn, aktiv status og rolle-ID er uændrede. Der er fortsat præcis én ikke-administratorrolle, nul permissions, nul medlemskaber og én auditpost. Auditposten er den oprindelige `roles.insert`, og dens snapshot matcher den nuværende rolle. De afviste ændringsforsøg har ikke ændret testvirksomhedens kontrollerede tilstand.
- Ingen allerede beståede tests er genkørt i afslutningen. Tidligere lokal evidens omfatter 44 applikationstests, 24 Chromium-browsercases, 13 tests af login-diagnostik og 10 isolationstestscript-cases. Disse er resultater fra de dokumenterede kørsler, ikke en ny samlet testkørsel.
- Hosted Fase 2-migration: `20260910155545_phase_2_auth_access`. Den er tidligere gennemført og er ikke kørt igen. Readiness, TLS og den begrænsede databaserolle bygger på tidligere registreret verifikation.

### Afgrænsning og overdragelse

Online-isolationen dækker MV Plast-administratoren mod den særskilte testvirksomhed uden medlemskab gennem den aktive NestJS-API. Den dokumenterer ikke en anden hosted brugers modsatrettede adgang eller en selvstændig direkte hosted RLS-test. Lokale RLS-tests med to virksomheder er særskilt dokumenteret. Rigtige samtidige PostgreSQL-forbindelser og fysisk Safari/iPhone/iPad er ikke verificeret. Mailinvitationer og selvbetjent password-reset er ikke implementeret/aktiveret; ingen betalt SMTP er tilføjet.

Testvirksomheden og dens auditpost bevares. Ingen nye ressourcer, migrationer, konfigurationsændringer, push eller deployment er foretaget ved denne afslutning. Den afsluttende dokumentation gemmes som lokalt commit på `phase2-auth`; den er ikke publiceret til `main` ved denne handling.


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

- Bekræftelse af den aktive Railway-commit via Railway-kontrolplanet. Push og GitHub Actions er nu gennemført; se aktiveringsnotatet nedenfor.
- Railway-deployment eller ændringer af hosted miljøvariabler.
- Hosted Supabase-migration, Auth-konfiguration eller bruger-/virksomhedsoprettelse.
- Ægte Supabase-login, refresh, logout og readiness fra Railway med Fase 2.
- Samtidige administratorændringer på flere rigtige PostgreSQL-forbindelser. SERIALIZABLE og databaseinvarianten er implementeret; PGlite er ikke bevis for denne samtidighedstest.
- Lokal Docker-kørsel; runtime-build og containerkontroller er i stedet bestået i GitHub Actions.
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

## Godkendt publicering 2026-09-10

Brugeren godkendte kun push til main og den normale automatiske Railway-deployment i eksisterende konfiguration. Ingen Supabase-migration, ændring af ressourcer eller limits er udført.

Terminalen havde ikke Git-login til push. GitHub App oprettede derfor commit 463ba080f2a9484249688607b63f9d1e9944adf8 med main fc4ea404aec10447c733437118721271ffff33f6 som parent. Filtræet ef42eec0653ec13f4ded6892c45b09bfeb787b12 matcher præcist den lokale commit 42480a2. Main er opdateret uden force; efter fetch gav git diff HEAD origin/main ingen filforskelle før dette dokumentationsnotat.

GitHub Actions-kørsel 34496716005 er completed/success. Typekontrol, automatiske tests, browsercases, Docker-build, runtime-verifikationsscript og streng TLS/CA-materialisering som ikke-root består. Ingen workflowændringer eller manuel ekstra kørsel.

Ved første offentlige kontrol svarede /api/health/live og /api/health/ready HTTP 200. Det fastslår ikke, hvilken commit Railway kører. Railway-værktøjer er ikke tilgængelige i samtalen, og GitHub har ingen deployment-record for committen. Den aktive deployment, dens commit og miljøkonfiguration er derfor ikke verificeret. Senere netværksforsøg har også haft timeouts fra testmiljøet.

For at verificere Railway skal den aktive deployment vise 463ba080f2a9484249688607b63f9d1e9944adf8. Det kan kontrolleres i Railway Dashboard eller med node -e 'console.log(process.env.RAILWAY_GIT_COMMIT_SHA || "COMMIT_UNAVAILABLE")' i containeren. Kommandoen viser kun commit-ID, ingen secrets.

Hosted Fase 2-migration og rigtig Auth-verifikation er stadig udestående. Når den nye kode kører, kræver readiness både Auth-konfiguration og de nye databaseobjekter. HTTP 200 fra en tidligere deployment er ikke en godkendelse af Fase 2.

Dette aktiveringsnotat gemmes lokalt; der udløses ikke et ekstra push/deployment alene for dokumentationen. Fase 3 er ikke startet.

## Hosted migration og rettighedskontrol 2026-09-10

Railway commit 463ba080f2a9484249688607b63f9d1e9944adf8 er verificeret af brugeren.
Supabase-organisation ltqcdagbwtuwtudnqpdn er via Management API bekræftet på Free; eksisterende projekt Produktionssystem (puwyontrchonoepisgun) var ACTIVE_HEALTHY. Samlet databasestørrelse før: 25.778.997 bytes; efter: 26.164.021 bytes. Free-planen indeholder 500 MB pr. projekt: https://supabase.com/docs/guides/platform/billing-on-supabase . Ingen opgradering, nye services eller ressourcer.

Første migrationsforsøg fejlede med permission denied for schema auth og blev rullet tilbage. Hosted postgres har USAGE og REFERENCES, men ingen GRANT OPTION. Rettelsen opretter app.profiles og dens auth.users-FK som postgres og overdrager tabellen til app_owner, før resten af migrationen fortsætter. Ingen Auth-privilegier delegeres til app_owner eller runtime. 22 berørte lokale database/API/bootstrap-tests består efter rettelsen. Et fuldt npm-testforsøg blev afbrudt af værktøjsmiljøet; den efterfølgende målrettede kørsel afsluttede med exit 0.

Vellykket hosted migration: 20260910155545_phase_2_auth_access. Den lokale SQL-fil er omdøbt til MCP's faktiske migrationsversion, så en kommende synkronisering ikke genanvender migrationen. Ingen forretningsdata eller Auth-brugere er oprettet.

Verificeret i hosted katalog:
- Otte app-tabeller: alle RLS=true og owner=app_owner.
- app_backend uden superuser, BYPASSRLS, CREATE ROLE eller CREATE DATABASE.
- USAGE på app, ingen CREATE, ingen schemaadgang til app_private eller auth, intet app_owner-medlemskab.
- Ingen INSERT/UPDATE/DELETE på audit-tabellen.
- app_backend kan kalde session-proben; anon/authenticated/service_role kan ikke.
- Supabase security advisor: ingen lints.

Forsøg på SET LOCAL ROLE app_backend fra migrationsforbindelsen blev afvist, fordi postgres ikke er medlem af app_backend. Der blev ikke givet ekstra medlemskab. Ovenstående hosted checks er derfor katalogbaserede; de erstatter ikke runtime-isolation med rigtige brugersessioner.

Offentlige endpoints efter migration: live HTTP 200, ready HTTP 503. Readiness-fejlens præcise årsag er endnu ikke fastslået. Auth-konfiguration er et konkret kontrolpunkt, da readiness nu kræver SUPABASE_URL og SUPABASE_PUBLISHABLE_KEY; Railway-værktøjer er ikke tilgængelige her. Ingen secrets er ændret eller udskrevet. Migrationen må ikke gentages som readiness-fejlfinding.

Rettelsen og dokumentationen gemmes lokalt uden yderligere Railway-deployment. Fase 2 er endnu ikke fuldt online-verificeret. Fase 3 er ikke startet.

## Readiness afklaret og næste login-test

Brugeren har efter konfigurationsrettelse verificeret AUTH_URL_SET, AUTH_PUBLIC_KEY_SET og DATABASE_URL_SET som true samt /api/health/ready HTTP 200 med status ready. Dette erstatter den tidligere readiness-fejl; ingen gentagelse af migration eller allerede beståede kontroller.

Den efterfølgende hosted optælling viser 0 Auth-brugere, 0 virksomheder og 0 aktive medlemskaber. Ægte login og online-isolation kan derfor endnu ikke gennemføres. Første Auth-bruger skal oprettes sikkert via Supabase Auths understøttede administration; ingen passwords eller tokens sendes i chat. Derefter kan det eksisterende bootstrap-flow oprette første virksomhedsmedlemskab, og de udestående live-tests gennemføres. Ingen direkte inserts i Supabase-managed auth.users.

Et forudgående read-only forsøg blev afvist af automatisk godkendelsesreview pga. ChatGPT-forbrugsgrænsen. Efter brugerens besked om at fortsætte lykkedes samme kontrol. Ingen credits, opgraderinger eller betalte ressourcer er købt.

Brugeren har godkendt synkronisering af migrationsrettelsen, hvis den kun udløser den eksisterende normale Railway-deployment. Den samlede dokumentations- og migrationsrettelse publiceres på den baggrund; migrationsfilen anvendes ikke igen i databasen. Ingen backend-runtime-kode ændres ved dette push.

## Første virksomhedsopsætning

Brugeren har oprettet og bekræftet første Supabase Auth-bruger og autoriseret virksomhedsnavnet MV Plast. Den eksisterende kompilerede bootstrapCompany-logik genererede en samlet SERIALIZABLE SQL-transaktion, kørt via migrationsadministratoren og SET LOCAL ROLE app_owner. UUID'er blev genereret under kørslen; ingen business-stamdata er hardcoded i applikationen. En kontrol af allerede eksisterende virksomhedsnavn blev tilføjet før inserts for at undgå utilsigtet gentagelse.

Hosted resultat verificeret: MV Plast, aktivt ADMINISTRATOR-medlemskab for første Auth-bruger, fem standardroller og otte audit-poster. Ingen adgangskoder læst/ændret, ingen Auth-brugere oprettet via SQL, ingen migration gentaget. Bootstrap må ikke genkøres.

scripts/verify-auth.cjs er et lokalt operator-værktøj til næste live-kontrol. Det køres af brugeren med Node.js i en interaktiv terminal, skjuler alle input og udskriver kun statuslinjer. Password og sessiontokens gemmes ikke i filer eller logoutput. TLS-verificering bevares. Værktøjet tester Auth-login, backendidentitet, virksomhedsadgang, adminpermissions, refresh, backendlogout, afvisning af gamle/fornyede tokens samt Supabase-sessionens cleanup. Det opretter sin egen session og logger denne ud; eksisterende sessioner logges ikke bevidst ud. Ingen profiler eller roller ændres af værktøjet ud over backendens normale /me-profilinitialisering og sessionstilbagekaldelse ved logout.

To målrettede tests af værktøjet består med lokale HTTP-fixtures. Dette er ikke et gennemført live-login. Live-login kræver brugerens egen skjulte passwordindtastning; online-isolation mod en separat virksomhed og ægte samtidighed er fortsat udestående. Den lokale to-virksomhedstest er allerede bestået og er ikke genkørt. Ingen ny deployment er udløst for operator-værktøjet.

## Målrettet login-fejlsøgning

Brugerens første liveforsøg stoppede ved REAL_SUPABASE_LOGIN: FAIL. Ingen konklusion om password, e-mail eller API-nøgle kan drages af dette generiske resultat alene.

Det lokale operator-script har nu LOGIN_DIAGNOSTICS_VERSION: 2 og udskriver ved login-afvisning kun HTTP-status og en allowlistet fejlkode. Ukendte koder, servermeddelelser og fejlbody vises aldrig. Syv målrettede script-tests består, inklusive afvisning af secret-lignende fejltekst. Ingen hosted konfiguration, passwords, migration, deployment eller andre tidligere beståede tests er ændret/genkørt. Næste trin er ét nyt lokalt loginforsøg fra brugeren med den opdaterede fil.

### Login diagnostics version 3

User reported HTTP 400 / UNCLASSIFIED with version 2. The diagnostic parser could ignore `error_code` when a numeric `code` was present, and did not classify legacy OAuth `error_description` responses. Version 3 checks both code fields and exact allowlisted messages, without printing raw bodies or credentials. All 13 focused local verification-script tests passed. The actual hosted login cause remains unconfirmed pending a user-run version 3 check. No hosted configuration, migration or deployment changed.

### User-confirmed live Auth success and pending hosted isolation

The user ran the live verification successfully: real Supabase login, session receipt, NestJS session acceptance, profile identity, MV Plast membership, company access, administrator permissions, refresh, refreshed session acceptance, backend logout, rejection of both access tokens and Supabase session cleanup all PASS. These checks have not been repeated.

Only MV Plast exists in the hosted company table. An attempt to create `TEST — Phase 2 isolation` and one non-admin role was rejected by automatic approval review: AGENTS.md requires explicit approval for hosted test tenants. No fixture was created, and no migration, deployment, plan or resource change was performed.

Prepared `node scripts/verify-auth.cjs --isolation` (diagnostics version 4). After operator confirmation of an actual active fixture company, its non-admin role named `Phase 2 isolation fixture role`, zero role permissions and no membership for the testing user, the script accepts both fixture UUIDs interactively. It authenticates once, checks own-company reads, requires HTTP 403 on foreign access/members/roles/audit and foreign role PATCH, and HTTP 404 when addressing the foreign role under the own-company route. PATCH uses identical fixture values with no permissions, avoiding privilege changes even if authorization fails. It checks own access after denials and cleans up its Supabase session. It does not repeat refresh/logout-replay checks.

Ten focused local isolation-script tests PASS, covering expected denials, six unexpected-access failures, invalid fixture context and session cleanup. Hosted execution is pending fixture approval and user-run login. This tests the live API boundary for the existing administrator against a separate non-member tenant; it does not claim a second independent user, reverse-direction testing, direct hosted RLS execution or concurrent database verification. Existing local two-company RLS evidence remains separate.

After the live run, inspect fixture role, membership and audit records to confirm denied operations made no changes. Keep test audit history; do not silently delete it.

### Approved hosted isolation fixture created

The user explicitly approved only `TEST — Phase 2 isolation` and its necessary isolation test, retaining the 0 DKK boundary. The existing Supabase project now contains the approved active company `b64edd83-ef7d-4fa9-93a0-424863a77cec` and one non-admin role `8cb47316-b22b-4ae1-97c3-3f88a83b53fe`, named `Phase 2 isolation fixture role`.

A targeted hosted query confirmed exactly one role, zero role permissions, zero memberships and one audit entry (initial role creation). No other tenant, Auth user, service, migration, deployment or paid resource was created. These values are the baseline for the post-test check.

The tested version 4 script is ready for the user to run with `--isolation`, entering MV Plast as the own company and these two fixture UUIDs. Credentials remain local and hidden. Hosted API isolation is still PENDING until that run supplies results; fixture creation alone does not constitute a passing isolation test. After results arrive, compare the hosted fixture against this baseline and record the outcome. Phase 3 has not started.
