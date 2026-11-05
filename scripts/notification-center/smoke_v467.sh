#!/usr/bin/env bash
# V467 local smoke on disposable PostgreSQL 17 clusters (no customer data).
# Desktop grants on auto_accounts are first made live-like (table SELECT, column UPDATE), as on akachat.
# 1) V457 suite still passes with V467; 2) V467 suite; 3) re-apply refused, rollback, re-apply;
# 4) V466 (+ V465 when present) apply together with V467.
# Usage: NOTIFY_PG_BIN=/usr/lib/postgresql/17/bin scripts/notification-center/smoke_v467.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${NOTIFY_PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${NOTIFY_PG_PORT:-55498}"
TMP="$(mktemp -d)"
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
V465="$ROOT/migrations/migration_v465_notification_quality.sql"
V466="$ROOT/migrations/migration_v466_notification_fly_scheduler.sql"
V467="$ROOT/migrations/migration_v467_notification_sender_flag.sql"
fresh() {
  "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$TMP/db"
  "${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
  "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
  psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
  psql_ -c "REVOKE UPDATE ON public.auto_accounts FROM aka_agent_desktop;
            GRANT UPDATE (name, login_status, status, mobile_device_id, updated_at) ON public.auto_accounts TO aka_agent_desktop;" >/dev/null
  psql_ -f "$ROOT/migrations/migration_v457_notification_center.sql" >/dev/null
  for extra in "$@"; do psql_ -f "$extra" >/dev/null; done
}
fresh "$V467"
echo "ok  - V457 + V467 applied (preflight + postcheck)"
psql_ -f "$ROOT/scripts/notification-center/tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V457 suite on V467: {} checks"
fresh "$V467"
psql_ -f "$ROOT/scripts/notification-center/v467_tests.sql" | grep -E '^(ok|==|PASS)'
if psql_ -f "$V467" >/dev/null 2>&1; then echo "FAIL: re-apply was not refused"; exit 1; fi
echo "ok  - re-apply refused by preflight"
psql_ -f "$ROOT/migrations/rollback_v467_notification_sender_flag.sql" >/dev/null
echo "ok  - rollback removes the flag, trigger and RPC"
psql_ -f "$V467" >/dev/null
echo "ok  - V467 applies again after rollback"
fresh "$V466" "$V467"
psql_ -f "$ROOT/scripts/notification-center/v466_tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V466 + V467 together, V466 suite: {} checks"
if [ -f "$V465" ] && [ -f "$ROOT/scripts/notification-center/v465_tests.sql" ]; then
  fresh "$V465" "$V466" "$V467"
  psql_ -f "$ROOT/scripts/notification-center/v465_tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V465 + V466 + V467 together, V465 suite: {} checks"
fi
echo "PASS"
