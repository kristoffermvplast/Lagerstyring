# Lagerstyring

Webbaseret lager- og produktionssystem. **Fase 1 er afsluttet. Fase 2 er implementeret lokalt og afventer online-verifikation.**

**Fase 1 er afsluttet og godkendt.** Se [det endelige Railway/Supabase-resultat](docs/phase-1-completion.md).

React + TypeScript + Vite → NestJS → Supabase PostgreSQL. Supabase Auth anvendes i Fase 2; Storage-funktioner tilføjes i senere faser.

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

For en faktisk databaseforbindelse: følg [miljø- og databasevejledningen](docs/environments.md). Se [Fase 2](docs/phase-2.md) for login, rettigheder, konfiguration og afgrænsninger. Lager-/produktionsfunktioner er ikke implementeret.

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
- [Fase 1-verifikation](docs/verification.md)
- [Fase 2: authentication og adgang](docs/phase-2.md)
- [Fase 2-testresultater](docs/phase-2-verification.md)

Fase 2 er godkendt til udvikling under 0 kr.-reglen. Hosted ændringer med mulig merudgift kræver særskilt godkendelse. Fase 3 er ikke startet.
