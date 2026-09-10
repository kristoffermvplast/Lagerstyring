# Fase 2 – Authentication og rettigheder

## Status

Implementeret på den lokale branch phase2-auth fra main fc4ea404aec10447c733437118721271ffff33f6.
Fase 1 er bevaret. Fase 3 er ikke startet. Hosted aktivering og endelig accept af Fase 2 afventer fortsat verifikation.

Økonomisk grænse: 0 kr. i nye eller øgede eksterne udgifter uden brugerens udtrykkelige godkendelse. Der er ikke ændret planer, compute, replicas, spend caps eller købt tjenester/credits. Der er ikke kørt migrationer mod hosted Supabase eller deployet til Railway. Push til main er tilbageholdt, fordi det kan udløse automatisk deployment med ændret forbrug; ingen bekræftet restkvote eller faktureringsgrænse er tilgængelig.

## Bygget

- Supabase Auth-login/logout med e-mail/password. Supabase SDK 2.116.0 er fastlåst i lockfile.
- Sessionsfornyelse via SDK, sessionStorage pr. browserfane, ingen passwords gemt af applikationen. Auth-tokens er følsomme; XSS kan læse browserstorage. Ingen analytics eller tredjeparters scripts tilføjet.
- Backend validerer det konkrete bearer-token hos projektets Supabase Auth /user endpoint (understøtter både asymmetriske og ældre signing keys). Kontrollerer derefter issuer, audience, sub, role, exp, session_id og fravær af anonym bruger. Ingen autorisation fra user_metadata.
- Auth-kald har timeout og fast lokal grænse på 300 valideringer/minut pr. proces. Ingen Redis eller betalt rate-limit-tjeneste. Dette er ikke en distribueret DDoS-beskyttelse.
- Databasetransaktioner er SERIALIZABLE med transaktionslokal bruger-, session- og virksomhedskontekst. Rollback renser konteksten; en forbindelse kasseres, hvis rollback fejler. Konflikter returneres som 409, så brugeren kan genindlæse og forsøge igen.
- Aktuel Supabase-session skal findes, og app-sessionen må ikke være tilbagekaldt. Logout tilbagekalder session-ID i databasen før lokal logout og Supabase-logout; genbrug af samme access/refresh-session afvises i backend.
- Profiler, virksomhedsmedlemskaber, aktive/inaktive medlemskaber, virksomhedsspecifikke roller og permissions.
- Login, arbejdsrum, virksomhedsvælger, Min profil og administration af medlemskaber/roller/adgangshistorik. Ingen lager-, produktions- eller kundekartoteker.
- Brugeren kan lukke sin lokale session ved serverfejl; UI forklarer, at serverlogout da ikke er bekræftet.
- Versionskontrol på medlemskabsændringer, databasekontrol af sidste administrator og automatisk audit med før/efter-værdier.
- Operator-værktøj til første virksomhed og dens administrator. Fem godkendte standardroller oprettes fra tekniske rolledefinitioner; navn på virksomhed og administrator-ID indtastes som konfiguration. Ingen virksomhed eller person hardcodes.

## Migration

Ny migration: supabase/migrations/20260909185857_phase_2_auth_access.sql.
Filnavnet er genereret af Supabase CLI under den første kørsel. En ekstra tom lokal migrationsfil fra afbrydelsen blev fjernet; ingen hosted migrationshistorik ændret.

Migrationen er kørt i isolerede PGlite-tests efter den eksisterende Fase 1-migration. Hosted migrationer kørt i Fase 2: **ingen**.

Tabeller: app.profiles, app.companies, app.permissions, app.roles, app.role_permissions, app.memberships, app.revoked_sessions, app.access_audit.
Alle otte tabeller har RLS. Composite foreign keys binder roller og medlemskaber til samme virksomhed. Profiler refererer til auth.users; historiske profiler kan ikke slettes via kaskade. Supabase-brugere oprettes ikke af migrationen.

Ingen schemaadgang til anon/authenticated/service_role i app/app_private. app_backend er fortsat NOBYPASSRLS, ikke ejer, ingen CREATE, intet app_owner-medlemskab. Runtime har kun de nødvendige tabel-/kolonnerettigheder og kan ikke slette audits, virksomheder, profiler eller medlemskaber.

## Bevidste privilegiegrænser

- app.actor_id/company_id læser kun transaktionskontekst etableret af backend. Dette er defense in depth bag en betroet NestJS-proces, ikke beskyttelse mod en angriber, der allerede har selve app_backend-passwordet.
- app.is_member/allowed er snævre read-only SECURITY DEFINER-funktioner ejet af NOLOGIN app_owner. De undgår rekursiv membership-RLS og bruger ingen brugerleveret actor. search_path er fast og objekter fuldt kvalificerede. De ligger i det ikke-eksponerede app-schema. Ejeren er undtaget fra RLS; app_backend er ikke.
- app_private.audit_access_change er en triggerfunktion, som håndhæver historik og sidste administrator. Runtime kan ikke kalde den direkte eller skrive sin egen audit.
- app.session_active er en snæver boolean SECURITY DEFINER-probe ejet af migrationsadministratoren (postgres), som læser auth.sessions for den aktuelle bruger/session. Runtime får EXECUTE på netop denne funktion, aldrig schema-/tabeladgang til auth eller administrative privilegier. PUBLIC og browserrollers EXECUTE er eksplicit tilbagekaldt.
- Backend udfører både permission-kontrol og RLS i samme transaktion. Valgt virksomheds-ID, UI og Supabase user_metadata giver ingen rettigheder alene.
- access.manage giver mulighed for at tildele administratorrolle. KONTOR og LÆSEADGANG har kun access.read i denne fase; LAGER/PRODUKTION får deres forretningspermissions i senere faser. ADMINISTRATOR har alle virksomhedens permissions. Standardadministratorrollen kan ikke redigeres i UI.

## Konfiguration og første anvendelse (afventer aktivering)

Backend: eksisterende DATABASE_URL, DATABASE_CA_FILE, DATABASE_CA_PEM og DATABASE_SSL_MODE=require bevares. Tilføj SUPABASE_PUBLISHABLE_KEY fra det eksisterende projekt (public/publishable eller legacy anon; aldrig service_role). SUPABASE_URL skal være projektets HTTPS-origin. Readiness kræver nu Auth-konfiguration og Fase 2-databaseobjekter.

Frontend: VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY er offentlige Auth-værdier. VITE_API_BASE_URL peger på NestJS. Ingen databasecredentials eller administrative Supabase-nøgler i frontend. Alle profil-/adgangsdata læses og skrives via NestJS; Supabase SDK bruges kun til Auth.

Lokal kørsel: npm ci, kopier de eksisterende miljøeksempler til lokale miljøfiler, og kør npm run dev. Uden Auth-konfiguration vises et tydeligt utilgængeligt login, ikke en falsk demo-session. For en lokal fuld Supabase-stack kræves Docker; denne er ikke kørt i Work-miljøet.

Før online aktivering skal økonomien afklares. Derefter: anvend migrationen kontrolleret, tilfør public Auth-konfiguration, opret den første Auth-bruger sikkert i projektet, initialisér første virksomhed med operator-værktøjet og deploy den testede kode. Første bruger logges ind med en rigtig Auth-session; efterfølgende medlemmer skal have logget ind én gang, så profilen findes. En administrator kan tilføje dem via bruger-ID fra Min profil. Medlemslisten viser navn og ID, ikke en global liste over alle Supabase-brugere.

Operator-værktøj (køres kun efter separat hosted aktiveringsafklaring): byg API, tilfør BOOTSTRAP_DATABASE_URL med migrationsadministratorens credential via sikker secret-konfiguration, BOOTSTRAP_USER_ID, BOOTSTRAP_COMPANY_NAME og DATABASE_CA_FILE, og kør node scripts/bootstrap-company.cjs --confirm-bootstrap. Værktøjet kræver streng TLS, opretter én virksomhed atomisk og viser kun PASS/FAILED. Det er ikke idempotent: kør ikke igen efter PASS. Credentials må ikke indsættes i chat, SQL-filer eller shellhistorik. Værktøjet er ikke inkluderet i Railway-runtime og er aldrig et offentligt endpoint.

## Test og resterende verifikation

Se phase-2-verification.md for faktiske testresultater. Fixtures indeholder mindst to virksomheder og flere bruger-/sessionstyper, kun i isoleret testdatabase.

Manglende før Fase 2 kan erklæres online-verificeret:
- Hosted migration og kontrol af roller/RLS mod den faktiske Supabase-instans.
- Rigtige Supabase-login, refresh og logout samt Railway readiness efter aktivering.
- Fysisk mobil/tablet-UX og Safari. Den lokale Chromium-kørsel består nu alle 24 cases; login og adgangsadministration er også kontrolleret visuelt.
- Parallelle transaktioner på rigtig PostgreSQL (PGlite-tests beviser ikke samtidighed mellem flere serverforbindelser).
- Mailinvitationer og selvbetjent password-reset er ikke aktiveret eller implementeret i denne leverance. Ingen SMTP-udgift. Nye Auth-brugere/passwordændringer håndteres foreløbigt af administratoren i Supabase. Betalt SMTP kræver særskilt godkendelse.
- Medlemsliste er begrænset til 500 rækker og audit til seneste 100; paginering er en senere forbedring ved konkret behov.
- Ingen Vercel-hosting oprettet. Ingen nye hosted testvirksomheder eller miljøer.

## Fortsættelse fra f0c46e7

De tidligere blokerede browsercases er kørt, sessions-/virksomhedsskiftdækning er udvidet, og et for smalt rollefelt på tablet/mobil er rettet. Se phase-2-verification.md for resultater og afgrænsninger. Applikationens forretningslogik og migrationsstruktur er bevaret.

Næste eksterne trin er kontrolleret aktivering af den eksisterende Fase 2-migration, Auth-konfiguration, første bruger/virksomhed og Railway-deployment, efterfulgt af reelt login/refresh/logout, isolation og readiness. Frontend kan køres lokalt under verifikationen; Vercel er ikke nødvendigt for dette trin.

Den mulige merudgift er forbrug: Railway-build og efterfølgende CPU/RAM/netværk samt Supabase Auth-/database-/trafikforbrug. Ingen planopgradering er nødvendig ud fra koden, men det beviser ikke 0 kr. i merbetaling. Beløbet kan ikke fastsættes uden aktuelle planer, inkluderet forbrug og resterende kvoter. Derfor er online-aktivering ikke udført; den kræver dokumenteret plads inden for eksisterende betaling eller brugerens udtrykkelige godkendelse af et konkret merudgiftsbudget. Ingen Fase 3.
