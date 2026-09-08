# Verifikation af Fase 1

## Bekræftet lokalt

- TypeScript-kontrol: API og frontend bestået.
- Produktionsbuild: API og frontend bestået.
- Vitest: 18 tests bestået (8 konfiguration, 6 HTTP/API, 4 databasemigration).
- Databaseprøven bruger PGlite, en isoleret PostgreSQL-motor. Den kontrollerer schemas, fravær af forretningstabeller, rolleprivilegier og at nye tabeller/funktioner ikke får utilsigtet adgang.
- HTTP-test starter den kompilerede NestJS-proces. Liveness=200 og readiness=503 uden credentials. CORS, sikkerhedsheaders, request-ID, fravær af business-endpoints og OpenAPI kontrolleres.
- Development-start blev rettet fra tsx IPC-watch til TypeScript compiler-watch + Node watch, fordi Work-miljøet ikke understøtter den krævede IPC-socket. Vite bindes til loopback frem for alle interfaces. Begge processer kan derefter startes af Playwrights webServer.

## Bekræftet på Supabase

- Migration 20260908175849_phase_1_foundation anvendt.
- app_backend: LOGIN, ingen SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE.
- app_owner og app_runtime: NOLOGIN og ingen administrative rolleflag.
- app_backend: USAGE på app, ingen CREATE på app, ingen USAGE på app_private.
- anon/authenticated: ingen USAGE på app.
- Forretningstabeller i app/app_private: 0.
- Supabase security advisor: ingen fund efter migrationen.

Kontrollen er udført gennem den administrative MCP-forbindelse med læseforespørgsler. Den verificerer ikke et selvstændigt TCP/TLS-login fra NestJS. Et forsøg på SET ROLE app_backend fra administrationsforbindelsen blev afvist, da administratoren ikke er medlem af runtime-rollen; ingen ekstra rettigheder blev givet for at omgå dette.

## Browserkontrol

Seks Playwright-tests er defineret: layout/navigation og API-fejlvisning på desktop, tablet og mobil (Chromium-enhedsemulering, ikke en fysisk iPhone/iPad).

Lokal browserkørsel er blokeret af miljøet: standardbrowserens download fejlede, og en alternativ Chromium-binær kunne ikke eksekveres (EACCES). Ingen af de seks tests nåede ind i selve browserkontrollen. De må derfor ikke rapporteres som bestået lokalt. CI-workflowet installerer browseren på GitHub-runneren og kører samme testpakke.

## Ikke verificeret

- Hosted databaseforbindelse fra den selvstændige backend (runtime-hemmelighed mangler).
- Docker-image, fuld Docker/Supabase-stak, Auth og Storage.
- Produktionshosting, TLS-terminering, secret manager og backup/gendannelse.

Disse begrænsninger skal håndteres før et egentligt driftsmiljø kan erklæres klar.
