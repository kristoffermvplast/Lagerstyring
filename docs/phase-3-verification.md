# Fase 3 — Verifikation

## Lokalt

- TypeScript-typekontrol: API og frontend PASS.
- Produktionsbuild: NestJS og Vite PASS.
- Applikationstests: 56 cases. Første samlede kørsel gav 55 PASS og én forventningsfejl i den tidligere test af tabelantal. Den test forventede fortsat otte tabeller; den nye model har 17. Efter opdateringen bestod alle fire tests i den berørte fil. De øvrige 55 blev ikke gentaget uden grund.
- Syv nye PostgreSQL/PGlite-cases: snapshots, audit, virksomhedsskel, kodeunikhed, særskilte permissions, afviste sletninger, versionskrav, maskintype-FK, inaktive data, enhedsdimension og browsergrænser.
- Fem nye tests mod rigtig lokal NestJS med PGlite og en lokal Auth-stub: CRUD/deaktivering, historik, versionskonflikt, validering, alle kartoteker, fremmed/inaktiv maskintype, permissiontildeling og læsebrugerafvisning. Ingen hosted credentials.
- 12 nye Playwright-cases PASS: fire flows på desktop/tablet/mobil. Kundens oprettelse/redigering/deaktivering/søgning/historik, læseadgang uden mutationsknapper, virksomhedsskift uden datalæk samt oprettelse af maskintype inde fra maskinformularen.
- 24 eksisterende browsercases PASS efter ændringer i fælles navigation og permission-UI. De 12 nye og 24 eksisterende cases er kørt i separate afsluttende kørsler, i alt 36 beståede browsercases.
- Browser: midlertidig Chromium 143 fra den offentlige @sparticuz/chromium-pakke, fordi Playwright-CDN-download fejlede. Projektets dependencies og lockfil er uændrede. Browserpakke og binær er ikke del af repositoryet. Ingen påstand om fysisk Safari/iOS-test.

## Rettede fejl under arbejdet

Audit bruger wall-clock-tid frem for fælles transaktionsstart; snapshottesten identificerer INSERT/UPDATE frem for at antage rækkefølge ved identiske tidsstempler. API-testadapteren håndterer SELECT-rowCount korrekt. Browserfixturen har eksplicit sessionudløbstid og afventer Auth-initialisering; inline-testen afventer lukning af underformularen. Maskintypevælgeren har et entydigt tilgængeligt navn.

## Hosted database

Supabase-organisationen er bekræftet på Free-planen. Database før migration: 11.349.139 bytes. Migration `20260911171505_phase_3_masterdata` er anvendt én gang og bekræftet i migrationshistorikken. Ingen tidligere migration er genkørt.

Alle ni nye tabeller: RLS aktiv, ejer `app_owner`, runtime SELECT tilladt, runtime DELETE afvist, `anon` og `authenticated` uden SELECT. Dette er katalogkontrol, ikke en ægte hosted app_backend-sessionstest. Runtime-isolation og mutationer er testet lokalt som beskrevet ovenfor.

Security Advisor gav ingen tabel-/RLS-advarsler. Den rapporterede, at Auth-funktionen “Leaked Password Protection” er deaktiveret. Auth-konfigurationen er ikke ændret; ingen betalt feature eller planopgradering er aktiveret. Se [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Økonomi og næste grænse

Ingen nye betalte services, compute, replicas, miljøer, credits, limits eller secrets. Lokal udvikling bruger eksisterende afhængigheder og offentligt gratis browserdownload. Hosted ændringer er tomme tabeller og to tekniske permissions i det eksisterende Free-projekt, uden nye testvirksomheder eller forretningsdata.

Push til main og mulig normal Railway-build/deployment er ikke udført. Fase 2's konkrete deploymentgodkendelser betragtes ikke som ubegrænset godkendelse til fremtidige deployments. En Fase 3-deployment kan bruge betalt Railway-build/compute; den præcise merpris er ikke verificeret. Dette trin kræver brugerens godkendelse før publicering. Fase 3's hosted API-/UI-verifikation afventer denne grænse. Fase 4 er ikke startet.
