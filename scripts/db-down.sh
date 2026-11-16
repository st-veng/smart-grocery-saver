#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if docker info >/dev/null 2>&1; then docker compose down; exit 0; fi
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDATA_DIR="${SGS_PGDATA:-/var/tmp/sgs-pgdata}"
if [[ "$(id -u)" == "0" ]]; then su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $PGDATA_DIR stop -m fast"; else "$PGBIN/pg_ctl" -D "$PGDATA_DIR" stop -m fast; fi
