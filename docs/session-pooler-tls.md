# Phase 1: Session Pooler TLS verification

## Final status

The operator has now run the full verifier in Railway. All mandatory client TLS, role/schema and NestJS health checks passed. PostgreSQL-side SSL remains informational false. Phase 1 is closed; see [final evidence](phase-1-completion.md). Phase 2 has not started.

## Finding (2026-09-09)

The operator reported successful configuration, login as app_backend, restricted
role, connection limit, membership and schema checks after correcting only the
Railway DATABASE_URL password. The previous pg_stat_ssl-based tls_active check
reported false. These are operator-provided runtime results, not independently
executed Railway checks.

pg_stat_ssl describes the connection accepted by the PostgreSQL backend. With
Supavisor, the client-side TLS connection is distinct from the pooler-to-database
connection. A false PostgreSQL-side value cannot establish that the Railway
client connection is plaintext. It also must not be presented as evidence that
the internal pooler-to-database hop is encrypted.

Sources:
- https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-SSL-VIEW
- https://github.com/supabase/supavisor/blob/main/lib/supavisor/client_handler.ex
  (client SSLRequest is followed by ssl.handshake and an SSL client socket)
- https://nodejs.org/api/tls.html#tlssocketauthorized
- https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert

## Corrected check

The verifier checks the connected pg client's actual TLSSocket, requiring:
- encrypted transport using TLS 1.2 or 1.3;
- authorized peer certificate;
- Node's checkServerIdentity against the configured pg host.

DATABASE_SSL_MODE=require and rejectUnauthorized=true remain mandatory. The
existing CA configuration is preserved. No password, URL, certificate contents,
raw errors or hostname are printed. The pinned pg driver's connection.stream is
an internal interface; missing or changed transport evidence fails closed.

The same checked-out client reads pg_stat_ssl. Its value is printed as
postgres_backend_ssl: INFO (true/false/unknown), independently of the three
mandatory client TLS checks. Role checks remain mandatory in the full verifier.

## Read-only runtime comparison

In the deployed Railway container:

```bash
node /app/scripts/verify-database.cjs --tls-only
```

This mode reads the existing CA file (it does not regenerate it), performs TLS
and login, and runs only a SELECT against pg_stat_ssl. It skips starting NestJS
and does not alter database data, permissions, passwords or runtime files.

Three client TLS PASS results alongside postgres_backend_ssl false establish
that the client and PostgreSQL report different transport legs. They verify
Railway-to-pooler TLS; they do not certify the internal network's protection.
A missing pg_stat_ssl row is reported unknown, not silently converted to false.

Then run the full role and NestJS connectivity/readiness verification:

```bash
node /app/scripts/verify-database.cjs
```

Check the active deployment's commit in Railway before running. The operator has completed this hosted check successfully. The agent has
not independently verified deployment activation or executed the container command.
Do not change TLS, role grants or credentials to address the old false negative.

## Validation

Local npm run check passed: 24 tests, typechecking and both production builds.
Transport regression tests cover missing/plaintext sockets, certificate
non-authorization, hostname mismatch and outdated protocol rejection. Hosted
TLS handshake and updated readiness have now passed in the operator's Railway run.
Local npm run test:e2e was attempted; all six cases were blocked at browser
launch because the Playwright Chromium executable is absent. GitHub CI installs
the browser and runs these tests plus Docker runtime smoke checks.
Phase 2 has not started.
