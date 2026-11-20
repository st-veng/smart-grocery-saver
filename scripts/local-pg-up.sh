#!/usr/bin/env bash
# Fallback for `pnpm db:up` (scripts/db.mjs) when Docker is not running, on Linux/macOS:
# start a local PostgreSQL install (pg_ctl) on port 5433.
set -euo pipefail
cd "$(dirname "$0")/.."

if docker info >/dev/null 2>&1; then
  docker compose up -d --wait db
  echo "Postgres (docker) ready on :5433"
  exit 0
fi

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PGBIN" || ! -x "$PGBIN/pg_ctl" ]]; then
  echo "No Docker daemon and no local PostgreSQL found. Install Docker or PostgreSQL 16+." >&2
  exit 1
fi

PGDATA_DIR="${SGS_PGDATA:-/var/tmp/sgs-pgdata}"
RUN=()
if [[ "$(id -u)" == "0" ]]; then RUN=(su postgres -s /bin/bash -c); fi
run() { if [[ ${#RUN[@]} -gt 0 ]]; then "${RUN[@]}" "$*"; else bash -c "$*"; fi; }

mkdir -p "$PGDATA_DIR"
[[ "$(id -u)" == "0" ]] && chown postgres "$PGDATA_DIR"
if [[ ! -f "$PGDATA_DIR/PG_VERSION" ]]; then
  echo sgs > "$PGDATA_DIR.pw"; [[ "$(id -u)" == "0" ]] && chown postgres "$PGDATA_DIR.pw"
  run "$PGBIN/initdb -D $PGDATA_DIR -U sgs --pwfile=$PGDATA_DIR.pw -A scram-sha-256 >/dev/null"
  rm -f "$PGDATA_DIR.pw"
fi
if ! run "$PGBIN/pg_ctl -D $PGDATA_DIR status" >/dev/null 2>&1; then
  run "$PGBIN/pg_ctl -D $PGDATA_DIR -o '-p 5433 -k /tmp -c timezone=America/Chicago' -l $PGDATA_DIR/server.log -w start" >/dev/null
fi
for db in sgs_dev sgs_e2e; do
  PGPASSWORD=sgs psql -h localhost -p 5433 -U sgs -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || PGPASSWORD=sgs psql -h localhost -p 5433 -U sgs -d postgres -qc "CREATE DATABASE $db"
done
echo "Postgres (local $("$PGBIN/postgres" --version | awk '{print $3}')) ready on :5433"
