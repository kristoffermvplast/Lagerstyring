# Fase 1 – leverance

## Implementeret

- npm-workspace med adskilt frontend og backend; eksakte dependencies og lockfile.
- React/Vite/Tailwind-grundlayout med desktopnavigation, mobilmenu og tomme arbejdsområder. Ingen fiktive kunder, varer, materialer eller lagerantal.
- NestJS-processen, OpenAPI i development/test, liveness og database-readiness.
- Konfigurationsvalidering, TLS, begrænset databasepool, sikkerhedsheaders, eksplicit CORS, inputstørrelsesgrænse og sikre fejlbeskeder.
- Standardafvisende API-guard. Ingen login- eller forretningsendpoints.
- Supabase SQL-migration: schemas app/app_private, roller app_owner/app_runtime/app_backend og lukkede objektstandardrettigheder.
- Miljøeksempler, lokal Supabase-konfiguration, backend-Dockerfile og CI-workflow.
- Automatisk test af API, konfiguration og databasegrænser. Browser-tests til desktop, tablet og mobil.
- Teknisk arkitektur og kørsels-/miljøvejledning.

## Filer

| Placering | Indhold |
| --- | --- |
| package.json, package-lock.json, .nvmrc | Workspace, scripts og fastlåste afhængigheder |
| apps/web/src | Grundlayout, styling, NestJS-klient og entrypoint |
| apps/web/vite.config.ts, index.html, tsconfig.json | Frontend-build, lokal proxy og TypeScript |
| apps/api/src | App-modul, health, sikkerhedsgrænser, miljøvalidering og databaseadapter |
| apps/api/tsconfig.json, Dockerfile | Backend-build og containeropskrift |
| apps/api/.env.example, apps/web/.env.example | Miljøskabeloner uden hemmeligheder |
| supabase/config.toml | Lokal Supabase-konfiguration |
| supabase/migrations/20260908175849_phase_1_foundation.sql | Første migration, afstemt med hosted migrationshistorik |
| tests, playwright.config.ts, vitest.config.mts | Automatiske test |
| .github/workflows/ci.yml | CI for build, test og browserkontrol |
| docs, README.md, AGENTS.md | Arkitektur, drift, faseafgrænsning og verifikation |

## Faktiske databaseændringer

Projekt: Produktionssystem / puwyontrchonoepisgun.
Migration: 20260908175849_phase_1_foundation.

Oprettet: schemas app og app_private; roller app_owner (NOLOGIN), app_runtime (NOLOGIN) og app_backend (LOGIN uden password). app_owner er schemaejer. app_backend arver app_runtime, som kun har USAGE på app. Browserroller har ingen schemaadgang. Fremtidige objekter ejet af app_owner er lukkede som standard.

Der er **nul forretningstabeller og nul forretningsdata**. Supabases Auth-/Storage-schemaer er ikke ændret. Der er ingen nye buckets, brugere eller integrationer.

## Begrænsninger

- Hosted NestJS-databaseforbindelse kræver stadig sikker provisioning af app_backend-password og DATABASE_URL. MCP-administration giver ikke Node-processen denne hemmelighed.
- Ingen online deployment. Lokal kørsel er beskrevet i README.
- Login, tenants/permissions, RLS på forretningstabeller og alle forretningsfunktioner hører til senere faser.
- Docker-image og fuld lokal Supabase-stak er ikke kørt i Work-miljøet, hvor Docker mangler.
- Separate hosted development/test/production-projekter og driftsplatform er ikke oprettet.
- Supabase-backup og Storage-gendannelse er ikke afprøvet.
- Se docs/verification.md for præcis status på tests og eventuelle miljøbegrænsninger.

Fase 2 er ikke påbegyndt.
