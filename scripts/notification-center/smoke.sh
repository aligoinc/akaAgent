#!/usr/bin/env bash
# V457 local smoke on a disposable PostgreSQL 17 cluster built from live metadata (no customer data, no pg_net).
# Usage: NOTIFY_PG_BIN=/usr/lib/postgresql/17/bin scripts/notification-center/smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${NOTIFY_PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${NOTIFY_PG_PORT:-55499}"
TMP="$(mktemp -d)"
cleanup() { "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
"${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
MIGRATION="$ROOT/migrations/migration_v457_notification_center.sql"
ROLLBACK="$ROOT/migrations/rollback_v457_notification_center.sql"

psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V457 applied (preflight + postcheck)"
psql_ -f "$ROOT/scripts/notification-center/tests.sql" | grep -E '^(ok|==|PASS)'
if psql_ -f "$MIGRATION" >/dev/null 2>&1; then echo "FAIL: re-apply was not refused"; exit 1; fi
echo "ok  - re-apply refused by preflight"
psql_ -c "DROP FUNCTION public.fixture_assert(boolean, text); DROP FUNCTION public.fixture_error(text);"
psql_ -f "$ROLLBACK" >/dev/null
[ "$(psql_ -Atc "SELECT md5(pg_get_functiondef('public.aka_agent_data_group_background_tick()'::regprocedure))")" = "873b2939cc09a51e0e9d71f685dfd0e0" ] \
  || { echo "FAIL: tick not restored"; exit 1; }
[ "$(psql_ -Atc "SELECT to_regclass('public.auto_notifications') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_email_notification_settings'::regclass AND attname = 'revision' AND NOT attisdropped)")" = "t" ] \
  || { echo "FAIL: rollback left objects"; exit 1; }
echo "ok  - rollback restores tick and removes V457 objects"
psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V457 applies again after rollback"
echo "PASS"
