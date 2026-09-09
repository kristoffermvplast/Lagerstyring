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
