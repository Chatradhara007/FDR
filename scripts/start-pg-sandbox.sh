#!/usr/bin/env bash
# Start a local PostgreSQL 16 for cloud sandboxes without Docker (dev/test only).
# Idempotent: safe to run repeatedly. Uses port 5432 (local Docker setups use 55432
# via docker-compose.yml / .env.example; this script does not touch those).
set -euo pipefail

PG_VERSION=16
PG_PORT=5432
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -x "${PG_BIN}/postgres" ]; then
  echo "PostgreSQL ${PG_VERSION} not found; installing..."
  apt-get update -qq && apt-get install -y -qq "postgresql-${PG_VERSION}"
fi

# Use the Debian-managed cluster; create it if missing.
if ! pg_lsclusters -h 2>/dev/null | awk '{print $1" "$2}' | grep -qx "${PG_VERSION} main"; then
  pg_createcluster "${PG_VERSION}" main --port "${PG_PORT}"
fi
if ! pg_lsclusters -h | awk -v v="${PG_VERSION}" '$1==v && $2=="main" {print $4}' | grep -qx online; then
  pg_ctlcluster "${PG_VERSION}" main start
fi

for _ in $(seq 1 30); do
  "${PG_BIN}/pg_isready" -q -h localhost -p "${PG_PORT}" && break
  sleep 1
done
"${PG_BIN}/pg_isready" -h localhost -p "${PG_PORT}"

psql_admin() { su postgres -c "psql -p ${PG_PORT} -v ON_ERROR_STOP=1 -tAq $*"; }

if [ "$(psql_admin "-c \"SELECT 1 FROM pg_roles WHERE rolname='fdr'\"")" != "1" ]; then
  psql_admin "-c \"CREATE ROLE fdr LOGIN PASSWORD 'fdr' CREATEDB\""
fi
for db in fdr fdr_test; do
  if [ "$(psql_admin "-c \"SELECT 1 FROM pg_database WHERE datname='${db}'\"")" != "1" ]; then
    psql_admin "-c \"CREATE DATABASE ${db} OWNER fdr\""
  fi
done

ENV_FILE="${REPO_ROOT}/.env"
if [ ! -f "${ENV_FILE}" ]; then
  # Same values as .env.example, but pointed at this sandbox's port.
  if [ -f "${REPO_ROOT}/.env.example" ]; then
    sed "s#@localhost:55432/#@localhost:${PG_PORT}/#g" "${REPO_ROOT}/.env.example" > "${ENV_FILE}"
  else
    printf 'DATABASE_URL=postgres://fdr:fdr@localhost:%s/fdr\nTEST_DATABASE_URL=postgres://fdr:fdr@localhost:%s/fdr_test\n' \
      "${PG_PORT}" "${PG_PORT}" > "${ENV_FILE}"
  fi
  echo "Wrote ${ENV_FILE}"
fi

echo "Postgres ready on localhost:${PG_PORT} (databases: fdr, fdr_test; user fdr)"
