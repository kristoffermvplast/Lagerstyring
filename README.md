# Lagerstyring

Webbaseret lager- og produktionssystem. **Kun Fase 1 – Fundament er implementeret.**

**Fase 1 er afsluttet og godkendt.** Se [det endelige Railway/Supabase-resultat](docs/phase-1-completion.md).

React + TypeScript + Vite → NestJS → Supabase PostgreSQL. Supabase Auth og Storage anvendes i de relevante senere faser.

## Åbn lokalt

Installér Git og Node.js 24 med npm 11. Kør i en terminal:

```bash
git clone https://github.com/kristoffermvplast/Lagerstyring.git
cd Lagerstyring
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run dev
```

Åbn **http://localhost:5173**. API: http://localhost:3001/api/health/live. Teknisk API-dokumentation: http://localhost:3001/api/docs.

Grundlayoutet kan åbnes uden databasehemmeligheder. API-liveness svarer da 200, mens database-readiness på `/api/health/ready` korrekt svarer 503. Det er ikke bevis for en fungerende hosted databaseforbindelse.

For en faktisk databaseforbindelse: følg [miljø- og databasevejledningen](docs/environments.md). Der er ingen loginfunktion eller forretningsfunktionalitet i Fase 1.

## Test og build

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm test` bygger API'et og tester konfiguration, HTTP-grænser og migrationens rettigheder i en isoleret PostgreSQL-motor (PGlite). Browser-tests dækker desktop, tablet og mobil. Fuld lokal Supabase kræver Docker; `npm run db:start` starter den.

## Dokumentation

- [Arkitektur og faste principper](docs/architecture.md)
- [Miljøer, Supabase-forbindelse og drift](docs/environments.md)
- [Fase 1: leverance, filer og begrænsninger](docs/phase-1.md)
- [Verifikation](docs/verification.md)

Fase 2 kræver udtrykkelig godkendelse.
