# Afsluttende Fase 1: hosted databaseforbindelse

## Aktuel status

**Verificeret i Railway og afsluttet.** Se [det endelige resultat](phase-1-completion.md). Der er ingen yderligere credential-provisionering nødvendig for den verificerede forbindelse.

## Historisk status før Railway

Forbindelsen er **ikke verificeret fra NestJS til hosted Supabase**. En netværksprøve fra Work-miljøet mod `db.puwyontrchonoepisgun.supabase.co` fejlede ved DNS-opslag med EAI_AGAIN. Der findes heller ingen tilført DATABASE_URL eller tilsluttet secret manager i miljøet.

Der er derfor ikke oprettet eller ændret en databaseadgangskode. En credential må ikke efterlades som en midlertidig hemmelighed uden en aftalt, sikker opbevaring. Dette er en klargjort test, ikke en gennemført forbindelsesopsætning.

Supabase blev genkontrolleret via den administrative MCP-forbindelse: app_backend har LOGIN, connection limit 10, er kun medlem af app_runtime og har ingen SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE eller REPLICATION. Det er en katalogkontrol, ikke bevis på et runtime-login.

## Sikker konfiguration ved ny provisioning eller rotation

Dette er referencevejledning, ikke en instruktion om at ændre den fungerende forbindelse.

1. Vælg et backendmiljø med netværksadgang til Supabases direkte PostgreSQL-adresse eller projektets officielle session-pooler. Bekræft den konkrete adresse i Supabases Connect-panel; gæt ikke pooleradresse.
2. Provisionér en unik, tilfældig adgangskode for app_backend gennem en administrativ forbindelse. Brug fx psqls interaktive `\password app_backend`, så password ikke ligger i SQL-filer eller shellhistorik. postgres anvendes alene til administration, aldrig som applikationsbruger.
3. Gem adgangskoden/DATABASE_URL i driftsplatformens secret manager. Del ikke URL'en i chat, GitHub-filer, issues eller logs. Ved lokal udvikling kan apps/api/.env bruges med ejeradgang alene (chmod 600), uden synkronisering til Git.
4. Sæt DATABASE_SSL_MODE=require. Certifikatverificering forbliver aktiveret. DATABASE_CA_FILE kan pege på en betroet Supabase-CA hentet fra projektet. Brug aldrig rejectUnauthorized=false.
5. Direkte forbindelse bruger app_backend; Supavisor bruger app_backend.<project-ref>. Backendens config afviser postgres som bruger og afviser URL-parametre, der kunne ændre TLS-indstillinger.
6. Genstart backend efter secret-rotation. Fjern gamle credentials fra secret manager og lokale miljøfiler. Ingen credentials indgår i migrationshistorik eller frontend.

Supabase Auth-/service_role-nøgler er ikke PostgreSQL-adgangskoder og erstatter ikke dette login.

## Verifikation

Fra repositoryets rod, med DATABASE_URL sikkert tilført til processen eller apps/api/.env:

```bash
npm run verify:database
```

Kommandoen bygger API'et og foretager kun læsninger i Supabase. Den kontrollerer:

- Faktisk current_user = app_backend.
- Klient-TLS, certifikat og hostname er verificeret. pg_stat_ssl rapporteres særskilt som information om PostgreSQL-siden.
- Ingen administrative rolleflag eller app_owner-medlemskab.
- Kun forventet direkte medlemskab i app_runtime.
- USAGE, men ikke CREATE, på app; ingen adgang til app_private.
- Den faktiske NestJS-processes /api/health/live og /api/health/ready returnerer HTTP 200 med forventet indhold.

Output indeholder kun faste testnavne og PASS/FAIL, aldrig credentials eller rå driverfejl. Kommandoen afslutter med fejlstatus ved manglende konfiguration, netværksfejl, forkerte rettigheder eller readiness-fejl. En manglende secret er ikke en bestået test.

Brugeren har gennemført node /app/scripts/verify-database.cjs i Railway med alle obligatoriske kontroller bestået. Fase 1 er afsluttet; Fase 2 er ikke autoriseret.
