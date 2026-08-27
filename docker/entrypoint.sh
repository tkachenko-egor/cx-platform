#!/usr/bin/env bash
# All-in-one container entrypoint: bring up local Postgres, migrate + seed,
# then run the Next server. Postgres listens on 127.0.0.1 only — it is never
# exposed outside the container.
set -euo pipefail

PGBIN="$(dirname "$(command -v postgres)")"
export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
APP_PORT="${PORT:-3000}"

log() { echo "[entrypoint] $*"; }

# ── 1. first-run cluster init ───────────────────────────────────────────────
mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initializing Postgres cluster in $PGDATA"
  gosu postgres "$PGBIN/initdb" --username=postgres --auth=trust --encoding=UTF8 -D "$PGDATA" >/dev/null
  # container-internal only; trust auth on loopback is fine and keeps the
  # image zero-config
  echo "host all all 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
  echo "host all all ::1/128 trust"       >> "$PGDATA/pg_hba.conf"
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "fsync = off"
    echo "synchronous_commit = off"
    echo "full_page_writes = off"
    echo "max_connections = 300"
  } >> "$PGDATA/postgresql.conf"
fi

# ── 2. start Postgres ──────────────────────────────────────────────────────
log "starting Postgres"
gosu postgres "$PGBIN/pg_ctl" -D "$PGDATA" -w -t 60 start

stop_pg() {
  log "stopping Postgres"
  gosu postgres "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop || true
}
trap 'stop_pg; exit 0' TERM INT

# ── 3. role + database (idempotent) ───────────────────────────────────────
log "ensuring role + database"
gosu postgres psql -v ON_ERROR_STOP=1 --username postgres <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cx') THEN
    CREATE ROLE cx LOGIN SUPERUSER PASSWORD 'cx';
  END IF;
END $$;
SQL
if ! gosu postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'cx_platform'" | grep -q 1; then
  gosu postgres createdb -O cx cx_platform
fi

# ── 4. migrate + seed (both idempotent) ───────────────────────────────────
cd /app
log "running migrations + seed"
node --import tsx scripts/seed.ts || log "seed step reported an issue — continuing to start the app"

# ── 5. run the app in the foreground ──────────────────────────────────────
log "starting Next server on 0.0.0.0:${APP_PORT}"
node node_modules/next/dist/bin/next start -p "${APP_PORT}" &
APP_PID=$!
wait "$APP_PID"
stop_pg
