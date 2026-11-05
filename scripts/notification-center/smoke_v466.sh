#!/usr/bin/env bash
# V466 local smoke on disposable PostgreSQL 17 clusters (no customer data, no pg_net).
# 1) V457 suite still passes with V466 on top (default pg_net); 2) V466 suite; 3) re-apply refused, rollback restores
# the V457 dispatch, re-apply works; 4) when V465 is present, V457 + V465 + V466 apply together and the V465 suite passes.
# Usage: NOTIFY_PG_BIN=/usr/lib/postgresql/17/bin scripts/notification-center/smoke_v466.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${NOTIFY_PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${NOTIFY_PG_PORT:-55497}"
TMP="$(mktemp -d)"
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
V465="$ROOT/migrations/migration_v465_notification_quality.sql"
V466="$ROOT/migrations/migration_v466_notification_fly_scheduler.sql"
fresh() {
  "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$TMP/db"
  "${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
  "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
  psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
  psql_ -f "$ROOT/migrations/migration_v457_notification_center.sql" >/dev/null
  for extra in "$@"; do psql_ -f "$extra" >/dev/null; done
}
fresh "$V466"
echo "ok  - V457 + V466 applied (preflight + postcheck)"
psql_ -f "$ROOT/scripts/notification-center/tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V457 suite on V466: {} checks"
fresh "$V466"
psql_ -f "$ROOT/scripts/notification-center/v466_tests.sql" | grep -E '^(ok|==|PASS)'
if psql_ -f "$V466" >/dev/null 2>&1; then echo "FAIL: re-apply was not refused"; exit 1; fi
echo "ok  - re-apply refused by preflight"
psql_ -f "$ROOT/migrations/rollback_v466_notification_fly_scheduler.sql" >/dev/null
echo "ok  - rollback restores the V457 dispatch (checksum checked in file)"
psql_ -f "$V466" >/dev/null
echo "ok  - V466 applies again after rollback"
if [ -f "$V465" ] && [ -f "$ROOT/scripts/notification-center/v465_tests.sql" ]; then
  fresh "$V465" "$V466"
  psql_ -f "$ROOT/scripts/notification-center/v465_tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V465 + V466 together, V465 suite: {} checks"
  fresh "$V466" "$V465"
  echo "ok  - V466 then V465 also applies"
fi
echo "PASS"
