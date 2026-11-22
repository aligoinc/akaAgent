#!/usr/bin/env bash
# V622 trên cụm PostgreSQL tạm: V621 + bộ kiểm V621 rồi V622, kiểm tổng Chào ngày mới, apply lại bị từ chối, gỡ trả đúng bản V621.
# Dùng: scripts/notification-daily-reports/smoke_v622.sh
set -euo pipefail
source "$(dirname "$0")/pgenv.sh"
trap 'stop_pg; rm -rf "$TMP"' EXIT
SIG="private.aka_agent_notification_morning(bigint,text,timestamp with time zone)"
m() { psql_ -At -c "SELECT md5(pg_get_functiondef('$SIG'::regprocedure))"; }
fresh; psql_ -f "$ROOT/scripts/notification-daily-reports/v621_fixture.sql" >/dev/null 2>&1
psql_ -f "$ROOT/migrations/migration_v621_notification_daily_reports.sql" >/dev/null
psql_ -c "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261122004939', 'migration_v621_notification_daily_reports', '{}') ON CONFLICT DO NOTHING" >/dev/null
[ "$(m)" = 94392489bb0b5f3c25bd281c2fe1eb06 ] || { echo "FAIL: hàm V621 cục bộ khác production ($(m))"; exit 1; }
echo "ok  - hàm morning sau V621 cục bộ = md5 production"
psql_ -f "$ROOT/scripts/notification-daily-reports/v621_tests.sql" >/dev/null 2>&1
psql_ -f "$ROOT/migrations/migration_v622_notification_morning_totals.sql" >/dev/null
echo "ok  - V622 applied ($(m))"
out="$(psql_ -At -f "$ROOT/scripts/notification-daily-reports/v622_tests.sql" 2>&1)" || { echo "$out" | tail -5; echo FAIL; exit 1; }
grep -E '^(ok|==|PASS)' <<<"$out"
[ "$(grep -c '^ok' <<<"$out")" = 5 ] || { echo "FAIL: cần 5 ca đạt"; echo "$out"; exit 1; }
if psql_ -f "$ROOT/migrations/migration_v622_notification_morning_totals.sql" >/dev/null 2>&1; then echo "FAIL: apply lại không bị từ chối"; exit 1; fi
echo "ok  - apply lại bị từ chối"
psql_ -f "$ROOT/migrations/rollback_v622_notification_morning_totals.sql" >/dev/null
[ "$(m)" = 94392489bb0b5f3c25bd281c2fe1eb06 ] || { echo "FAIL: gỡ không trả đúng bản V621"; exit 1; }
echo "ok  - gỡ trả đúng bản V621"
psql_ -f "$ROOT/migrations/migration_v622_notification_morning_totals.sql" >/dev/null
echo "ok  - apply lại sau khi gỡ"
# Bản dán SQL Editor: chạy trên nền V621, ghi sổ md5 = file, dán lần hai bị từ chối.
psql_ -f "$ROOT/migrations/rollback_v622_notification_morning_totals.sql" >/dev/null
PASTE="$ROOT/migrations/tests/migration_v622_notification_morning_totals_paste.sql"
res="$(psql_ -At -f "$PASTE")"
grep -q '^applied|.*|migration_v622_notification_morning_totals|t$' <<<"$res" || { echo "FAIL: bản dán: $res"; exit 1; }
[ "$(m)" = a3ff4875140d65498f0e10327d5f8952 ] || { echo "FAIL: bản dán không ra đúng hàm V622"; exit 1; }
echo "ok  - bản dán chạy được, sổ migration md5 = file"
if psql_ -f "$PASTE" >/dev/null 2>&1; then echo "FAIL: dán lần hai không bị từ chối"; exit 1; fi
echo "ok  - dán lần hai bị từ chối"
