# Railway: Fase 1 databaseverifikation

Backend: https://lagerstyring-production-9671.up.railway.app

Brugeren rapporterer live=200 og ready=503. Det bekræfter ikke i sig selv TLS eller databaseadgang. Railway-værktøjerne er endnu ikke tilgængelige i denne Work-samtale; aktiv deployment og miljøvariabler kan derfor ikke inspiceres her.

## Runtime-rettelse

apps/api/Dockerfile kopierer nu scripts/verify-database.cjs og scripts/database-diagnostics.cjs til /app/scripts. Backendens dependencies og kompilerede NestJS-moduler findes allerede i runtime. Ingen secrets, migrationscredentials eller miljøfiler kopieres ind i imaget. Startkommando og offentlige health-svar er uændrede.

CI bygger det faktiske Docker-image og kontrollerer, at scriptet kan indlæses og afviser manglende DATABASE_URL med præcis den sikre fejlbesked og exit code 1. Denne test bruger ingen databasecredentials og erstatter ikke hosted databaseverifikation.

## Deployment og kørsel

1. Brug main som Railway-kilde og repositoryets rod som build context; Dockerfile er apps/api/Dockerfile.
2. Kontrollér at Railway har deployet committen med runtime-rettelsen. Hvis automatisk deployment ikke er aktiveret, deploy seneste main gennem Railway.
3. Åbn en shell i den aktive Railway-container (fx Railway SSH). Kør fra /app:

   node scripts/verify-database.cjs

   Brug ikke npm run verify:database i runtime: den kommando forsøger at bygge med development-afhængigheder, der er fjernet fra produktionsimaget.
4. Scriptet læser containerens eksisterende environment. Kopiér ikke DATABASE_URL til terminalkommandoer eller chat. Brug ikke printenv, env eller udskrift af driver-fejl. Sealed variables skal blive inde i Railway.
5. Gem kun PASS/FAIL, faste fejlkategorier og exit code som evidens. Test også de offentlige /api/health/live og /api/health/ready; begge skal svare HTTP 200.

## Fejltolkning

- AUTHENTICATION_FAILED: serveren afviste credentials. Kan ikke alene bevise om password, brugernavn eller valgt endpoint er forkert. Kontrollér app_backend-secret og direkte/pooler-brugernavn sikkert i Railway.
- AUTHORIZATION_FAILED: login/rolle afvist af database eller pooler.
- TLS_CERTIFICATE_FAILED: kontrollér CA, hostname og certifikatets gyldighed. Slå aldrig certifikatverifikation fra.
- DNS/NETWORK/CONNECTION-fejl: kontrollér det officielle endpoint og Railway-netværk. Brug om nødvendigt Supabases session-pooler til IPv4.
- PERMISSION_DENIED eller OBJECT/SCHEMA_NOT_FOUND: kontrollér den eksisterende migration og grants. Brug ikke postgres som applikationsbruger.
- ROLE_CHECK_FAILED: de navngivne PASS/FAIL-felter angiver hvilke identitets-, medlemskabs- eller schemakrav der fejler.
- CONFIGURATION_INVALID: kontrollér miljøkonfiguration, URL-encoding, app_backend-brugernavn og at URL ikke har queryparametre.
- UNCLASSIFIED_DATABASE_FAILURE: ukendt fejl; scriptet tilbageholder bevidst rå fejldata. En ny sikker klassifikation kan blive nødvendig.

Kun faste tilladte fejltekster udskrives; vilkårlige code/message/detail/stack-felter udskrives aldrig. Scriptet foretager kun læsninger. Der ændres ingen passwords, roller, grants eller data.

Fase 1 forbliver åben, indtil den faktiske Railway-container består database- og readiness-kontrollen. Fase 2 er ikke startet.

## CI-opfølgning 2026-09-09

Run 34281163420 på f4fed22 bestod build og 20 tests, men én browser-test startede før API'et svarede. Docker-trinene blev derfor ikke kørt. Playwright venter nu særskilt på API-liveness og frontend før browser-tests. Ingen health-assertions er fjernet, og der bruges fortsat den rigtige lokale NestJS-proces. Den efterfølgende CI-kørsel skal verificere både browser-tests og runtime-image.

### Bekræftet resultat

CI-run https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34353473651 på aac1b855ca354ecb63705c40695f7abf8509e30b bestod 2026-09-09: typecheck, 20 tests, begge builds, browser-tests, Docker-build og runtime-scriptets test uden secrets. Runtime-scriptet er dermed til stede og kan indlæses i det byggede image.

Offentlig kontrol fra Work samme dag: /api/health/live HTTP 200 med status ok; /api/health/ready HTTP 503. Den deployede Railway-commit er ikke verificeret. Scriptet er endnu ikke kørt med Railways DATABASE_URL, og hosted TLS/rolle/schema-rettigheder er derfor ikke godkendt. Ingen database- eller secret-ændringer udført.

## CA-konfiguration efter TLS_CERTIFICATE_FAILED

Brugeren har nu kørt scriptet i Railway: configuration PASS, TLS_CERTIFICATE_FAILED. Scriptets tilstedeværelse er dermed bekræftet af brugeren; login og databaseprivilegier er endnu ikke verificeret. Fejlkategorien kan skyldes CA, hostname eller gyldighed, så tilføjelse af CA er ikke i sig selv bevis for løst TLS-problem.

Supabase anviser download af CA fra projektets Database Settings → SSL Configuration:
https://supabase.com/docs/guides/platform/ssl-enforcement

Railway Variables på backend-servicen:

- DATABASE_CA_PEM: hele indholdet af det offentlige CA-certifikat hentet fra Supabase-projektet, med rigtige linjeskift og BEGIN/END CERTIFICATE-linjerne. Ingen citationstegn omkring og ingen private keys. Brug ikke et certifikat opsamlet fra en uverificeret forbindelse.
- DATABASE_CA_FILE: /app/certs/supabase-ca.crt
- DATABASE_SSL_MODE: require (vores applikationsindstilling beholder rejectUnauthorized=true; den er ikke libpq's sslmode=require).

Docker opretter /app/certs ejet af node med mode 0700. Backend og verifier bruger samme databaseTls-funktion: validerer PEM-format, CA-markering og gyldighed; skriver til den faste sti med mode 0600; læser filen via DATABASE_CA_FILE. Andre skrivestier afvises. Ved genstart dannes filen igen fra runtime-variablen. Hvis DATABASE_CA_PEM er tom, kan DATABASE_CA_FILE stadig pege på et på forhånd monteret CA-certifikat. Der downloades intet ved opstart, og intet CA-indhold logges.

Certifikatet er offentligt, men skal komme fra en betroet kilde. PEM-validering beviser ikke certifikatets oprindelse. Det konkrete Supabase CA-certifikat er endnu ikke leveret til Work eller indsat i Railway af agenten. Ingen passwords/connection strings ændres. Der tilføjes ingen globale TLS-overrides, ingen rejectUnauthorized=false og ingen ændringer i Supabase SSL enforcement.

Når variablerne er gemt og Railway har deployet den nye kode, åbn en ny shell i den aktive container og kør fra /app: node scripts/verify-database.cjs. Ved fortsat certifikatfejl kontrolleres det officielle hostname og certifikatets gyldighed frem for at slække på TLS. Railway-deployment kan fortsat ikke inspiceres direkte fra denne samtale.
