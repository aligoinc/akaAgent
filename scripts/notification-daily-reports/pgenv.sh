#!/usr/bin/env bash
# Dựng cụm PostgreSQL tạm có nền thông báo như production (setup + V457/V458?/V465/V466/V467/V520; V475 cần V473 nên bỏ) cho bài kiểm V621.
# Dùng: source scripts/notification-daily-reports/pgenv.sh; fresh; psql_ -c '...'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${NOTIFY_PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
PORT="${NOTIFY_PG_PORT:-55621}"
TMP="${NOTIFY_PG_TMP:-$(mktemp -d)}"
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
stop_pg() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; }
fresh() {
  stop_pg; rm -rf "$TMP/db"
  "${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
  "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
  psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
  psql_ -c "REVOKE UPDATE, INSERT ON public.auto_accounts FROM aka_agent_desktop;" >/dev/null 2>&1 || true
  for m in v457_notification_center v465_notification_quality v466_notification_fly_scheduler v467_notification_sender_flag \
           v520_notification_package_expiring; do
    psql_ -f "$ROOT/migrations/migration_$m.sql" >/dev/null
  done
}
