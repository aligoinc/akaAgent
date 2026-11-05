#!/usr/bin/env bash
# V465 local smoke on disposable PostgreSQL 17 clusters (no customer data, no pg_net).
# 1) V457 behaviour suite still passes with V465 on top; 2) V465 suite; 3) re-apply refused, rollback restores V457, re-apply works.
# Usage: NOTIFY_PG_BIN=/usr/lib/postgresql/17/bin scripts/notification-center/smoke_v465.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${NOTIFY_PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${NOTIFY_PG_PORT:-55496}"
TMP="$(mktemp -d)"
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
fresh() {
  "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$TMP/db"
  "${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
  "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
  psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
  psql_ -f "$ROOT/migrations/migration_v457_notification_center.sql" >/dev/null
  psql_ -f "$ROOT/migrations/migration_v465_notification_quality.sql" >/dev/null
}
fresh
echo "ok  - V457 + V465 applied (preflight + postcheck)"
psql_ -f "$ROOT/scripts/notification-center/tests.sql" | grep -E '^(ok|PASS)' | grep -c '^ok' | xargs -I{} echo "ok  - V457 suite on V465: {} checks"
fresh
psql_ -f "$ROOT/scripts/notification-center/v465_tests.sql" | grep -E '^(ok|==|PASS)'
if psql_ -f "$ROOT/migrations/migration_v465_notification_quality.sql" >/dev/null 2>&1; then echo "FAIL: re-apply was not refused"; exit 1; fi
echo "ok  - re-apply refused by preflight"
psql_ -f "$ROOT/migrations/rollback_v465_notification_quality.sql" >/dev/null
echo "ok  - rollback restores the five V457 functions (checksums checked in file)"
psql_ -f "$ROOT/migrations/migration_v465_notification_quality.sql" >/dev/null
echo "ok  - V465 applies again after rollback"
echo "PASS"
