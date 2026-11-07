#!/usr/bin/env bash
# V475 local smoke on disposable PostgreSQL clusters (no customer data, no pg_net).
# Order as production: setup → V457 → V466 → V467 → V465 → journey tables (V473 DDL) → V475.
# Usage: NOTIFY_PG_BIN=/usr/lib/postgresql/16/bin scripts/notification-center/smoke_v475.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${NOTIFY_PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${NOTIFY_PG_PORT:-55497}"
NC="$ROOT/scripts/notification-center"
V465="$ROOT/migrations/migration_v465_notification_quality.sql"
V466="$ROOT/migrations/migration_v466_notification_fly_scheduler.sql"
V467="$ROOT/migrations/migration_v467_notification_sender_flag.sql"
V475="$ROOT/migrations/migration_v475_journey_campaign_notifications.sql"
RB475="$ROOT/migrations/rollback_v475_journey_campaign_notifications.sql"
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
  psql_ -f "$NC/setup.sql" >/dev/null
  psql_ -c "REVOKE UPDATE ON public.auto_accounts FROM aka_agent_desktop;
            GRANT UPDATE (name, login_status, status, mobile_device_id, updated_at) ON public.auto_accounts TO aka_agent_desktop;" >/dev/null
  psql_ -f "$ROOT/migrations/migration_v457_notification_center.sql" >/dev/null
  for extra in "$@"; do psql_ -f "$extra" >/dev/null; done
}
fingerprint() {
  psql_ -At -c "SELECT p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '-')
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
                 ORDER BY p.oid::regprocedure::text COLLATE \"C\";
                SELECT 'trigger ' || t.tgname || ' ' || t.tgenabled::text || ' ' || md5(pg_get_triggerdef(t.oid))
                  FROM pg_trigger t WHERE t.tgrelid = 'public.auto_campaigns'::regclass AND NOT t.tgisinternal ORDER BY 1;"
}
capture_md5() { psql_ -At -c "SELECT md5(pg_get_functiondef('private.aka_agent_notification_capture_campaign()'::regprocedure))"; }

fresh "$V466" "$V467" "$V465" "$NC/v475_fixture.sql"
[ "$(capture_md5)" = 4a5e881eb85efc1cc2280e8cf0c10721 ] || { echo "FAIL: fixture capture is not the V465 definition"; exit 1; }
fingerprint > "$TMP/before.txt"
psql_ -f "$V475" >/dev/null
echo "ok  - V475 applied on V457 + V466 + V467 + V465 (preflight + postcheck)"
fingerprint > "$TMP/after.txt"
changed="$({ diff "$TMP/before.txt" "$TMP/after.txt" || true; } | grep -E '^[<>]' | sed -E 's/^[<>] ([^ ]+).*/\1/' | sort -u | tr '\n' ' ')"
[ "$changed" = "private.aka_agent_notification_capture_campaign() " ] || { echo "FAIL: unexpected changes: $changed"; exit 1; }
echo "ok  - only private.aka_agent_notification_capture_campaign() changed; ACL, other functions and triggers identical"
[ "$(capture_md5)" = 71cdeb0842f00fafaf8492366bf9e8dc ] && echo "ok  - capture checksum 71cdeb0842f00fafaf8492366bf9e8dc"
psql_ -f "$NC/tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V457 suite on V475: {} checks"

fresh "$V466" "$V467" "$V465" "$NC/v475_fixture.sql" "$V475"
psql_ -f "$NC/v465_tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V465 suite on V475: {} checks"
fresh "$V466" "$V467" "$V465" "$NC/v475_fixture.sql" "$V475"
psql_ -f "$NC/v466_tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V466 suite on V475: {} checks"
fresh "$V466" "$V467" "$V465" "$NC/v475_fixture.sql" "$V475"
psql_ -f "$NC/v467_tests.sql" | grep -c '^ok' | xargs -I{} echo "ok  - V467 suite on V475: {} checks"

fresh "$V466" "$V467" "$V465" "$NC/v475_fixture.sql" "$V475"
psql_ -f "$NC/v475_tests.sql" | grep -E '^(ok|==|PASS)'
if psql_ -f "$V475" >/dev/null 2>&1; then echo "FAIL: re-apply was not refused"; exit 1; fi
echo "ok  - re-apply refused by preflight"
psql_ -f "$RB475" >/dev/null
[ "$(capture_md5)" = 4a5e881eb85efc1cc2280e8cf0c10721 ] && echo "ok  - rollback restores the V465 definition"
psql_ -At -c "UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 34" >/dev/null
psql_ -At -c "UPDATE auto_journeys SET status = 'active' WHERE name = 'QT nháp'" >/dev/null
psql_ -At -c "UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 34" >/dev/null
[ "$(psql_ -At -c "SELECT count(*) FROM auto_notifications WHERE campaign_id = 34 AND payload ->> 'toStatus' = 'hoàn thành'")" = 2 ] \
  && echo "ok  - after rollback a managed campaign's completion is notified again (old behaviour)"
if psql_ -f "$RB475" >/dev/null 2>&1; then echo "FAIL: second rollback was not refused"; exit 1; fi
echo "ok  - second rollback refused by preflight"
psql_ -f "$V475" >/dev/null
echo "ok  - V475 applies again after rollback"

fresh "$V466" "$V467" "$V465"
if psql_ -f "$V475" >/dev/null 2>&1; then echo "FAIL: applied without the journey tables"; exit 1; fi
[ "$(capture_md5)" = 4a5e881eb85efc1cc2280e8cf0c10721 ] && echo "ok  - refused without V473 tables, nothing changed"
psql_ -f "$NC/v475_fixture.sql" >/dev/null
psql_ -c "ALTER TABLE public.auto_campaigns DISABLE TRIGGER trg_aka_agent_notify_campaign_status" >/dev/null
if psql_ -f "$V475" >/dev/null 2>&1; then echo "FAIL: applied while the capture trigger is disabled"; exit 1; fi
echo "ok  - refused while the capture trigger is disabled"
echo "PASS"
