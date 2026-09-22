#!/usr/bin/env bash
# Disposable synthetic databases only. Never accepts a hosted URL or restores in place.
set -euo pipefail
cd "$(dirname "$0")/.."
for name in phase26-postgres phase26-restore; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo "Refusing existing container: $name" >&2
    exit 1
  fi
done
created_source=false
created_restore=false
cleanup() {
  if "$created_source"; then docker rm -fv phase26-postgres >/dev/null; fi
  if "$created_restore"; then docker rm -fv phase26-restore >/dev/null; fi
}
trap cleanup EXIT
docker run -d --name phase26-postgres -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=phase26_source -p 127.0.0.1:55433:5432 postgres:17 >/dev/null
created_source=true
docker run -d --name phase26-restore -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=phase26_restored -p 127.0.0.1:55434:5432 postgres:17 >/dev/null
created_restore=true
for name in phase26-postgres phase26-restore; do
  ready=false
  for attempt in $(seq 1 30); do
    if docker exec "$name" pg_isready -q; then ready=true; break; fi
    sleep 1
  done
  "$ready" || { echo "Local PostgreSQL not ready" >&2; exit 1; }
done
PHASE26_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/phase26_source npx vitest run tests/operations.test.ts
