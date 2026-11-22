#!/usr/bin/env bash
# V624 trên cụm PostgreSQL tạm: nền thông báo (pgenv.sh) + V621 + V622 + nền Trợ lý aka chép từ production (fixture_assistant.sql),
# kiểm md5 các hàm sẽ thay = production, áp V624, bộ kiểm hành vi, hai phiên song song, apply lại bị từ chối, gỡ trả đúng bản cũ.
# Dùng: scripts/notification-assistant-inbox/smoke_v624.sh
set -euo pipefail
export NOTIFY_PG_PORT="${NOTIFY_PG_PORT:-55624}"
source "$(dirname "$0")/../notification-daily-reports/pgenv.sh"
trap 'stop_pg; rm -rf "$TMP"' EXIT
DIR="$ROOT/scripts/notification-assistant-inbox"
SIGS="'private.aka_agent_ai_assistant_item(ai_message)','private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb)','private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb)','public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid)','private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb)','public.aka_agent_notification_worker(text,jsonb)'"
fp() { psql_ -At -c "SELECT string_agg(md5(pg_get_functiondef(s::regprocedure)), ',' ORDER BY s) FROM unnest(ARRAY[$SIGS]) s"; }
schema() { psql_ -At -c "SELECT md5(string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, column_name)) FROM information_schema.columns WHERE table_schema = 'public'"; }

fresh
psql_ -f "$ROOT/scripts/notification-daily-reports/v621_fixture.sql" >/dev/null 2>&1
psql_ -f "$ROOT/migrations/migration_v621_notification_daily_reports.sql" >/dev/null
psql_ -c "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261122004939', 'migration_v621_notification_daily_reports', '{}') ON CONFLICT DO NOTHING" >/dev/null
psql_ -f "$ROOT/migrations/migration_v622_notification_morning_totals.sql" >/dev/null
psql_ -f "$DIR/fixture_assistant.sql" >/dev/null
# Danh sách loại thông báo như production 22/11/2026 (có assistant.result của Trợ lý aka, nền thử V520 + V621 thì thiếu).
psql_ >/dev/null <<'SQL'
ALTER TABLE public.auto_notifications DROP CONSTRAINT auto_notifications_event_type_check;
ALTER TABLE public.auto_notifications ADD CONSTRAINT auto_notifications_event_type_check CHECK (event_type = ANY (ARRAY['campaign.status_changed'::text,
  'account.status_changed'::text, 'report.scheduled'::text, 'data_group.membership_changed'::text, 'system.test'::text, 'system.verify_email'::text,
  'package.expiring'::text, 'assistant.result'::text, 'report.morning'::text]));
SQL
BEFORE="$(fp)"
WANT="0ca5dccc4c29ecd06666a68c52ea5750,60eb06ec7d4f83d086b4aebb91e48b35,7239d660fba11a324acd342b59698247,965d14b00e959a935b13e9ba98b05a9d,e2cbd418d0c87926f55479d2da6416fc,f7d421b8977fedf20e6471a9dfa4ada6"
[ "$(psql_ -At -c "SELECT string_agg(m, ',' ORDER BY m) FROM unnest(string_to_array('$BEFORE', ',')) m")" = "$WANT" ] \
  || { echo "FAIL: 6 hàm cục bộ khác production ($BEFORE)"; exit 1; }
echo "ok  - 6 hàm sẽ thay ở nền thử = md5 production"
SCHEMA_BEFORE="$(schema)"

psql_ -f "$ROOT/migrations/migration_v624_notification_assistant_inbox.sql" >/dev/null
echo "ok  - V624 applied"
out="$(psql_ -At -f "$DIR/v624_tests.sql" 2>&1)" || { echo "$out" | tail -8; echo FAIL; exit 1; }
grep -E '^(ok|==)' <<<"$out"
n="$(grep -c '^ok' <<<"$out")"
[ "$n" -ge 30 ] || { echo "FAIL: chỉ $n ca đạt"; echo "$out" | tail -20; exit 1; }

# Hai phiên cùng lúc chép thông báo cho một nhân viên chưa có hội thoại thông báo: một hội thoại, hai mục seq 1, 2.
psql_ -c "INSERT INTO org_staff (id, organization_id, name, username, password, is_active) VALUES (4, 1, 'Lan', 'lan', 'pw4', true)" >/dev/null
psql_ -c "BEGIN; SELECT fixture_notice(4, 'report.morning', 'ready', 'race-a'); SELECT pg_sleep(1.5); COMMIT;" >/dev/null &
A=$!
sleep 0.4
psql_ -c "SELECT fixture_notice(4, 'report.scheduled', 'ready', 'race-b')" >/dev/null
wait $A
r="$(psql_ -At -c "SELECT (SELECT count(*) FROM ai_message_thread WHERE org_staff_id = 4 AND (intake_data ->> 'kind') = 'notices') || '|' ||
                          (SELECT string_agg(seq::text, ',' ORDER BY seq) FROM ai_message WHERE assistant_staff_id = 4 AND notification_id IS NOT NULL)")"
[ "$r" = "1|1,2" ] || { echo "FAIL: song song ra $r"; exit 1; }
echo "ok  - hai phiên song song: một hội thoại thông báo, seq 1 và 2"

if psql_ -f "$ROOT/migrations/migration_v624_notification_assistant_inbox.sql" >/dev/null 2>&1; then echo "FAIL: apply lại không bị từ chối"; exit 1; fi
echo "ok  - apply lại bị từ chối"
psql_ -f "$ROOT/migrations/rollback_v624_notification_assistant_inbox.sql" >/dev/null
[ "$(fp)" = "$BEFORE" ] || { echo "FAIL: gỡ không trả đúng 6 hàm"; exit 1; }
[ "$(schema)" = "$SCHEMA_BEFORE" ] || { echo "FAIL: gỡ không trả đúng cột"; exit 1; }
[ "$(psql_ -At -c "SELECT count(*) FROM ai_message_thread WHERE (intake_data ->> 'kind') = 'notices'")" = 0 ] || { echo "FAIL: còn hội thoại thông báo"; exit 1; }
[ "$(psql_ -At -c "SELECT count(*) FROM pg_proc WHERE proname LIKE 'aka_agent_ai_assistant_notice%'")" = 0 ] || { echo "FAIL: còn hàm mới"; exit 1; }
echo "ok  - gỡ trả đúng 6 hàm, cột, không còn hội thoại / hàm thông báo"
psql_ -f "$ROOT/migrations/migration_v624_notification_assistant_inbox.sql" >/dev/null
echo "ok  - apply lại sau khi gỡ"
# Bản dán SQL Editor: chạy trên nền trước V624, ghi sổ md5 = file, dán lần hai bị từ chối.
psql_ -f "$ROOT/migrations/rollback_v624_notification_assistant_inbox.sql" >/dev/null
PASTE="$ROOT/migrations/tests/migration_v624_notification_assistant_inbox_paste.sql"
res="$(psql_ -At -f "$PASTE")"
grep -q '^applied|.*|migration_v624_notification_assistant_inbox|t$' <<<"$res" || { echo "FAIL: bản dán: $res"; exit 1; }
[ "$(psql_ -At -c "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_aka_agent_ai_assistant_notice'")" = 1 ] || { echo "FAIL: bản dán không tạo trigger"; exit 1; }
echo "ok  - bản dán chạy được, sổ migration md5 = file"
if psql_ -f "$PASTE" >/dev/null 2>&1; then echo "FAIL: dán lần hai không bị từ chối"; exit 1; fi
echo "ok  - dán lần hai bị từ chối"
echo PASS
