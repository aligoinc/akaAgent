#!/usr/bin/env bash
# V458 local smoke on a disposable PostgreSQL 17 cluster (no customer data, no pg_net).
# Order: V457 fixture + migration, dynamic filter fixture, live core body (md5 checked), parity run on the old body,
# V458, parity runs with switches off/on, behaviour tests, rollback guards, rollback, parity again, re-apply.
# Usage: NOTIFY_PG_BIN=/usr/lib/postgresql/17/bin scripts/data-group-member-events/smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${NOTIFY_PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${NOTIFY_PG_PORT:-55498}"
TMP="$(mktemp -d)"
cleanup() { "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
"${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
fail() { echo "FAIL: $*"; exit 1; }
SNAP="$ROOT/migrations/snapshots/data-group-member-events-v458"
MIGRATION="$ROOT/migrations/migration_v458_data_group_member_events.sql"
ROLLBACK="$ROOT/migrations/rollback_v458_data_group_member_events.sql"
CORE="public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)"
core_md5() { psql_ -Atc "SELECT md5(pg_get_functiondef('$CORE'::regprocedure))"; }
parity() { psql_ -Atc "DELETE FROM public.auto_account_contact_dynamic_filter_queue WHERE contact_id NOT BETWEEN 2001 AND 2005; SELECT private.fixture_parity_scenario()"; }

psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
psql_ -f "$ROOT/migrations/migration_v457_notification_center.sql" >/dev/null
psql_ -f "$ROOT/scripts/data-group-member-events/setup.sql" >/dev/null
psql_ -f "$SNAP/core_live.sql" >/dev/null
psql_ -c "REVOKE ALL ON FUNCTION $CORE FROM PUBLIC" >/dev/null
[ "$(core_md5)" = "d40d1a23943ae1a4a66339504382526f" ] || fail "fixture core differs from the live body"
echo "ok  - fixture core matches the live checksum"
BEFORE="$(parity)"

psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V458 applied (preflight + postcheck)"
[ "$(parity)" = "$BEFORE" ] || fail "membership differs with switches off"
echo "ok  - parity with the old body, switches off (no events)"
[ "$(psql_ -Atc "SELECT count(*) FROM public.auto_data_group_member_events")" = "0" ] || fail "events written while off"
psql_ -c "UPDATE public.auto_system_settings SET value = 'true' WHERE key IN ('notifications.enabled', 'notifications.member_events.enabled')" >/dev/null
[ "$(parity)" = "$BEFORE" ] || fail "membership differs with switches on"
echo "ok  - parity with the old body, switches on"
[ "$(psql_ -Atc "SELECT count(*) FILTER (WHERE action = 'added') || '/' || count(*) FILTER (WHERE action = 'removed') FROM public.auto_data_group_member_events")" = "5/2" ] \
  || fail "parity scenario should record 5 added / 2 removed"
echo "ok  - parity scenario records 5 entries and 2 exits; staying via another source is not an exit"
psql_ -c "DELETE FROM public.auto_data_group_member_events; DELETE FROM public.auto_notifications WHERE event_type = 'data_group.membership_changed';
          UPDATE public.auto_system_settings SET value = 'false' WHERE key IN ('notifications.enabled', 'notifications.member_events.enabled')" >/dev/null

psql_ -f "$ROOT/scripts/data-group-member-events/tests.sql" | grep -E '^(ok|==|PASS)'
if psql_ -f "$MIGRATION" >/dev/null 2>&1; then fail "re-apply was not refused"; fi
echo "ok  - re-apply refused by preflight"
if psql_ -f "$ROOT/migrations/rollback_v457_notification_center.sql" >/dev/null 2>&1; then fail "V457 rollback ran while V458 is applied"; fi
echo "ok  - V457 rollback refused while V458 is applied"
psql_ -f "$ROLLBACK" >/dev/null
[ "$(core_md5)" = "d40d1a23943ae1a4a66339504382526f" ] || fail "core not restored"
[ "$(psql_ -Atc "SELECT to_regprocedure('private.aka_agent_data_group_finish_member_events(uuid)') IS NULL
                   AND NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'notifications.member_events.enabled')")" = "t" ] \
  || fail "rollback left helpers or settings"
[ "$(parity)" = "$BEFORE" ] || fail "membership differs after rollback"
echo "ok  - rollback restores the live body (checksum) and behaviour"
psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V458 applies again after rollback"
echo "PASS"
