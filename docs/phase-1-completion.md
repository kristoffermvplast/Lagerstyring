# Fase 1 – afsluttet 2026-09-09

Fase 1 er afsluttet og godkendt af brugeren. Fase 2 er ikke startet og kræver ny, udtrykkelig godkendelse.

## Miljø og evidens

- Repository: kristoffermvplast/Lagerstyring, main.
- Verifikationskode: 299c60df08e9f1c13337400b6b8775da3da92948.
- Backend: https://lagerstyring-production-9671.up.railway.app
- Supabase: Produktionssystem, puwyontrchonoepisgun.
- Forbindelse: Session Pooler, databaseidentitet app_backend.

Brugeren har kørt `node /app/scripts/verify-database.cjs` i Railway-containeren og indsendt dette fulde resultat. Agenten har ikke selv haft Railway-værktøjer til at inspicere aktiv deployment, miljøvariabler eller eksekvere kommandoen.

```text
configuration: PASS
client_tls_encrypted: PASS
client_tls_authorized: PASS
client_tls_hostname: PASS
postgres_backend_ssl: INFO (false; PostgreSQL-side connection only)
identity_ok: PASS
restricted_role: PASS
login_limits_ok: PASS
app_usage: PASS
no_app_create: PASS
no_private_access: PASS
memberships_ok: PASS
no_owner_membership: PASS
NestJS live: PASS (HTTP 200)
NestJS ready: PASS (HTTP 200)
```

Scriptets NestJS-kontrol starter den faktiske applikation på en lokal, midlertidig port i containeren med dens databasekonfiguration. HTTP 200 ovenfor dokumenterer denne kontrol; det er ikke en ny, uafhængig måling af Railways offentlige ingress.

## Bekræftede grænser

Klientforbindelsen bruger TLS 1.2/1.3, et godkendt certifikat og korrekt hostname.
Login sker som app_backend, aldrig postgres. Rollen har LOGIN, connection limit 10, ingen administrative rolleflag, kun forventet direkte medlemskab i app_runtime og intet app_owner-medlemskab. Den har USAGE, men ikke CREATE, på app og ingen USAGE på app_private.

pg_stat_ssl måler PostgreSQL-sidens forbindelse. Værdien false er ikke et fejlsignal for klientens separat verificerede TLS til pooleren. Resultatet certificerer ikke kryptering af det interne pooler-til-PostgreSQL-hop. Se [TLS-forklaringen](session-pooler-tls.md).

## Løste fejl og sikker konfiguration

- Verifikationsscriptet og hjælpefiler er inkluderet i runtime-imaget.
- Det betroede Supabase CA-certifikat tilføres med DATABASE_CA_PEM og DATABASE_CA_FILE=/app/certs/supabase-ca.crt.
- Brugeren rettede kun password-delen af Railways DATABASE_URL, efter at det kendte password var verificeret direkte som app_backend. Det originale password blev URL-encoded én gang; Supabase-rollens password behøvede ikke at blive ændret.
- Klient-TLS verificeres på den aktive Node.js TLSSocket. pg_stat_ssl rapporteres særskilt som information.

DATABASE_URL håndteres som backend-secret i Railway. Ingen credentials gemmes i Git, frontend, migrationsfiler eller denne rapport. Diagnoseoutput indeholder faste statusfelter og sikre fejlkategorier. DATABASE_SSL_MODE forbliver require med rejectUnauthorized=true. CA-filen dannes ved opstart i en node-ejet mappe med mode 0700; filen har mode 0600.

## Testevidens

GitHub Actions på kodecommit 299c60df08e9f1c13337400b6b8775da3da92948 er uafhængigt kontrolleret som success:
https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34389352820

Lokalt bestod npm run check: 24 tests, typekontrol og begge builds. Lokale Playwright-tests kunne ikke starte, fordi browserbinæren manglede. Det er en lokal miljøbegrænsning; CI-kørslen er bestået.

## Afgrænsning

Afslutningscommitten ændrer kun dokumentation. Ingen database-, secret- eller applikationskodeændringer.

Fase 1 leverer fundamentet, ikke det færdige driftssystem. Auth, forretningsfunktioner, tenant-RLS på fremtidige forretningstabeller og Storage-funktioner hører til senere godkendte faser. Frontend-hosting på Vercel, separate hosted development/test-miljøer og backup-/gendannelsesøvelser er ikke verificeret som en del af afslutningen.
