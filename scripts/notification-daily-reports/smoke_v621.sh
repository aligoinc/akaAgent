#!/usr/bin/env bash
# V621 trên cụm PostgreSQL tạm (không dữ liệu khách): bộ kiểm V457/V465/V466 cũ vẫn đạt trên nền V621, bộ kiểm V621,
# apply lại bị từ chối, gỡ trả đúng hàm cũ, apply lại sau khi gỡ, p2 (VALIDATE + chỉ mục) chạy được.
# Dùng: scripts/notification-daily-reports/smoke_v621.sh   (NOTIFY_PG_BIN=/usr/lib/postgresql/17/bin nếu có)
set -euo pipefail
source "$(dirname "$0")/pgenv.sh"
trap 'stop_pg; rm -rf "$TMP"' EXIT
V621="$ROOT/migrations/migration_v621_notification_daily_reports.sql"
setup621() { fresh; psql_ -f "$ROOT/scripts/notification-daily-reports/v621_fixture.sql" >/dev/null 2>&1; psql_ -f "$V621" >/dev/null; }
md5s() { psql_ -At -c "SELECT string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), ' ' ORDER BY 1)
                          FROM pg_proc p WHERE p.proname LIKE 'aka_agent_notification%'"; }
declare -A EXPECT=([tests]=103 [v465_tests]=20 [v466_tests]=27)   # số ca đạt trên cùng nền khi chưa có V621
cons() { psql_ -At -c "SELECT string_agg(conname || '=' || replace(pg_get_constraintdef(oid), ' NOT VALID', ''), ' ' ORDER BY conname)
                         FROM pg_constraint WHERE conname IN ('auto_notifications_event_type_check',
                           'auto_notification_subscriptions_event_type_check', 'auto_email_notification_settings_client_check')"; }
fresh; psql_ -f "$ROOT/scripts/notification-daily-reports/v621_fixture.sql" >/dev/null 2>&1
BEFORE="$(md5s)"; BEFORE_CONS="$(cons)"
psql_ -f "$V621" >/dev/null
echo "ok  - V621 applied (preflight md5 + postflight md5/ACL)"
for suite in tests v465_tests v466_tests; do
  setup621
  # Bộ kiểm cũ chờ báo cáo dựng ngay; V621 rải theo nhân viên (cài đặt), đặt 0 để chạy y như trước.
  psql_ -c "UPDATE auto_system_settings SET value = '0' WHERE key = 'notifications.report_spread_seconds'" >/dev/null
  n=$(psql_ -f "$ROOT/scripts/notification-center/$suite.sql" 2>&1 | grep -c '^ok' || true)
  [ "$n" = "${EXPECT[$suite]}" ] || { echo "FAIL: bộ kiểm cũ $suite trên V621: $n/${EXPECT[$suite]}"; exit 1; }
  echo "ok  - bộ kiểm cũ $suite trên V621: $n/${EXPECT[$suite]} checks"
done
setup621
out="$(psql_ -f "$ROOT/scripts/notification-daily-reports/v621_tests.sql" 2>&1)" || { echo "$out" | tail -5; echo FAIL; exit 1; }
grep -E '^(ok|==|PASS)' <<<"$out"
if psql_ -f "$V621" >/dev/null 2>&1; then echo "FAIL: apply lại không bị từ chối"; exit 1; fi
echo "ok  - apply lại bị từ chối"
psql_ -f "$ROOT/migrations/rollback_v621_notification_daily_reports.sql" >/dev/null
AFTER="$(md5s)"
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: gỡ không trả đúng hàm cũ"; diff <(tr ' ' '\n' <<<"$BEFORE") <(tr ' ' '\n' <<<"$AFTER"); exit 1; }
[ "$BEFORE_CONS" = "$(cons)" ] || { echo "FAIL: gỡ không trả đúng ràng buộc"; echo "$BEFORE_CONS"; cons; exit 1; }
echo "ok  - gỡ trả đúng mọi hàm aka_agent_notification* về md5 cũ, xoá dòng report.morning / default_seed"
psql_ -f "$V621" >/dev/null
echo "ok  - apply lại sau khi gỡ"
grep -v '^--' "$ROOT/migrations/migration_v621_notification_daily_reports_p2.sql" | tr '\n' ' ' | tr ';' '\n' | while read -r stmt; do
  [ -n "${stmt// /}" ] && psql_ -c "$stmt" >/dev/null
done
psql_ -At -c "SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_auto_notification_subscriptions_reports_due'" | grep -qx 1
echo "ok  - p2: VALIDATE + chỉ mục mới"
echo PASS
