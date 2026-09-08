# Miljøer og kørsel

## Miljøgrænser

| Miljø | Frontend/API | Database | Data |
| --- | --- | --- | --- |
| Development | Vite 5173 + NestJS 3001 | Lokal Supabase eller særskilt udviklingsprojekt | Kun udviklingsdata |
| Test/CI | Isolerede processer | PGlite til migrationstest; lokal Supabase ved fuld integrationstest | Testfixtures |
| Production | Bygget frontend + Node 24 NestJS bag HTTPS | Dedikeret Supabase-projekt | Driftsdata |

Det tilgængelige hosted projekt er `Produktionssystem`, ref `puwyontrchonoepisgun`, eu-west-1, PostgreSQL 17. Det er det eneste tilknyttede projekt, og miljøformålet er ikke fastsat som produktion. Fase 1 opretter alene tomme schemas og tekniske roller. Der er ikke oprettet ekstra betalte projekter eller branches.

`supabase/config.toml` er lokal konfiguration. Den ændrer ikke i sig selv hosted Auth-, Storage- eller Data API-indstillinger. `app` og `app_private` skal forblive ueksponerede. Hosted rolle-/schemagrants blokerer browseradgang uafhængigt af den lokale config.

## Lokal preview uden database

Følg README. `.env.example` indeholder ingen hemmeligheder. Med tom DATABASE_URL starter API og UI, men readiness er 503. Dette er en bevidst tilstand, ikke en falsk vellykket databaseforbindelse.

## Lokal Supabase med Docker

```bash
npm run db:start
npm run db:reset:local
```

`db:reset:local` sletter kun den lokale database. Kør aldrig reset mod hosted miljøer. Migrationen opretter rollerne uden password. Provisionér en lokal adgangskode til app_backend med PostgreSQLs interaktive `\password app_backend` fra en administrativ psql-session. Sæt derefter i `apps/api/.env`:

```dotenv
DATABASE_URL=postgresql://app_backend:<URL-encoded-password>@127.0.0.1:54322/postgres
DATABASE_SSL_MODE=disable
SUPABASE_URL=http://127.0.0.1:54321
```

Genstart API'et. `/api/health/ready` skal returnere 200. Hele Docker/Supabase-stakken kræver Docker på den maskine, hvor kommandoen køres; PGlite-testen erstatter ikke en fuld Auth-/Storage-integrationstest.

## Hosted databaseforbindelse

1. Opret en unik adgangskode for den allerede oprettede `app_backend`-rolle gennem en sikker administrativ databaseforbindelse, fx psql `\password app_backend`. Brug en password manager; gem ikke hemmeligheden i SQL-filer, chat eller Git.
2. Hent forbindelsesoplysninger fra Supabases Connect-panel. Brug direkte PostgreSQL-forbindelse, hvis hosten har den nødvendige IPv6-adgang, ellers den dokumenterede session-pooler.
3. Erstat standardbrugeren med `app_backend` ved direkte forbindelse eller `app_backend.<project-ref>` ved Supavisor. Brug app_backend-rolleadgangskoden, ikke postgres-adgangskoden.
4. Sæt DATABASE_URL i backend-hostens secret/environment-indstillinger. Sæt DATABASE_SSL_MODE=require. Brug om nødvendigt DATABASE_CA_FILE med projektets CA-certifikat. TLS-verificering må ikke slås fra.
5. Sæt NODE_ENV=production, HOST=0.0.0.0, PORT=3001, SUPABASE_URL og præcise HTTPS CORS_ORIGINS.
6. Start API og kontrollér readiness. 503 betyder, at forbindelsen, schemas eller rollegrænser ikke er klar. API'et returnerer aldrig rå forbindelsesfejl eller credentials.

Den aktuelle Work-forbindelse kan administrere Supabase gennem MCP, men det giver ikke den selvstændige NestJS-proces en databaseadgangskode. Denne runtime-hemmelighed er endnu ikke konfigureret. Hosted TCP/TLS-login fra NestJS er derfor ikke verificeret.

## Produktion og hosting

Frontend og backend er ikke publiceret. Vite-devserveren er kun til udvikling. Byg med `npm run build`. Backend startes med `npm run start -w @lager/api`. Frontend-output ligger i `apps/web/dist`.

Anbefalet routing: samme HTTPS-origin serverer frontend og videresender `/api/` til NestJS. Alternativt bygges frontend med VITE_API_BASE_URL sat til backendens HTTPS-origin og CORS_ORIGINS sat til frontendens origin. VITE-værdier bliver offentlige i bundle.

En API-Dockerfile følger med. Den bygger den fastlåste dependencygraf og kører som ikke-root. Eksempel:

```bash
docker build -f apps/api/Dockerfile -t lagerstyring-api .
docker run --env-file apps/api/.env -p 3001:3001 lagerstyring-api
```

For containerdrift skal `.env` angive HOST=0.0.0.0. Hosted secrets tilføres gennem driftsplatformen; image og build får dem ikke. HTTPS, firewall, rate limiting, frontend-hosting og secret provisioning skal konfigureres ved valg af driftsplatform. Intet driftsmiljø er oprettet automatisk.

## Migrationer

CLI-versionen er fastlåst i package-lock. Brug `npx supabase migration new <navn>` til nye filer. Migrér som administrator og opret fremtidige app-objekter som app_owner i en transaktion. Test på isoleret database, gennemgå SQL og anvend gennem den autoriserede migrationsvej. Ingen automatisk produktionsmigration fra CI.

Første hosted migration er anvendt gennem Supabase MCP. Filens versionsnummer afstemmes mod Supabases migrationshistorik, så CLI ikke forsøger at anvende den igen. Se docs/verification.md.

## Backup

Før første drift skal databasebackup og separat filbackup/gendannelse verificeres for den valgte Supabase-plan. Ingen filer er uploadet i Fase 1, og backup/gendannelse er endnu ikke testet.
