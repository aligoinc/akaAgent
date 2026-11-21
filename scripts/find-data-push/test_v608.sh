#!/usr/bin/env bash
# Kiểm thử V608 trên Postgres cục bộ (mặc định /usr/lib/postgresql/16/bin; đặt PGBIN để đổi).
# Dựng cụm tạm, nạp fixture + dữ liệu, apply V608, chạy các ca, gỡ bằng rollback, rồi kiểm sổ migration chặn chạy lại.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
work="$(mktemp -d)"
port="${PGPORT_TEST:-55608}"
as_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 755 "$work"; [ "$(id -u)" = "0" ] && chown postgres "$work"
cleanup() { as_pg "LC_ALL=C '$PGBIN/pg_ctl' -D '$work/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
as_pg "LC_ALL=C '$PGBIN/initdb' -D '$work/data' -U postgres -A trust >/dev/null"
as_pg "LC_ALL=C '$PGBIN/pg_ctl' -D '$work/data' -o '-p $port -k $work' -l '$work/log' start -w >/dev/null"
psql_run() { as_pg "'$PGBIN/psql' -X -q -v ON_ERROR_STOP=1 -h '$work' -p $port -U postgres -d postgres $*"; }
cp "$here"/fixture_v608.sql "$here"/seed_v608.sql "$here"/test_v608_cases.sql "$repo/migrations/migration_v608_find_data_push_links.sql" \
   "$repo/migrations/rollback_v608_find_data_push_links.sql" "$repo/migrations/migration_v609_find_data_push_match_key.sql" \
   "$repo/migrations/rollback_v609_find_data_push_match_key.sql" "$work/"
[ "$(id -u)" = "0" ] && chown postgres "$work"/*.sql
psql_run "-f '$work/fixture_v608.sql'"
psql_run "-f '$work/seed_v608.sql'"
psql_run "-f '$work/migration_v608_find_data_push_links.sql'"
echo "== apply V608: ok"
if [ "${WITH_V609:-1}" = "1" ]; then
  # Các ca của V608 phải vẫn đúng sau V609 (khoá DB tính thay khoá app gửi).
  psql_run "-c \"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121072153', 'migration_v608_find_data_push_links')\""
  psql_run "-f '$work/migration_v609_find_data_push_match_key.sql'"
  echo "== apply V609: ok"
fi
psql_run "-f '$work/test_v608_cases.sql'" 2>&1 | sed -n 's/^.*NOTICE:  //p'
echo "== hai nguồn đẩy cùng lúc vào một đích"
cat > "$work/concurrent_a.sql" <<'SQL'
BEGIN;
SELECT set_config('test.staff_id', '1', true);
SET LOCAL ROLE aka_agent_desktop;
SELECT public.aka_agent_find_data_push_v1('{"sourceCampaignId":20,"outputKind":"facebook_group","items":[{"value":"https://facebook.com/groups/race","key":"facebook.com/groups/race"}]}');
RESET ROLE;
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$work/concurrent_b.sql" <<'SQL'
SELECT pg_sleep(0.5);
BEGIN;
SELECT set_config('test.staff_id', '1', true);
SET LOCAL ROLE aka_agent_desktop;
SELECT public.aka_agent_find_data_push_v1('{"sourceCampaignId":22,"outputKind":"facebook_group","items":[{"value":"https://www.facebook.com/groups/race/","key":"facebook.com/groups/race"}]}');
COMMIT;
SQL
[ "$(id -u)" = "0" ] && chown postgres "$work"/concurrent_*.sql
psql_run "-f '$work/concurrent_a.sql'" >/dev/null &
pid_a=$!
psql_run "-f '$work/concurrent_b.sql'" >/dev/null
wait "$pid_a"
race_rows="$(psql_run "-t -A -c \"SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id = 21 AND uid ILIKE '%groups/race%'\"")"
if [ "$race_rows" != "1" ]; then echo "FAIL: hai nguồn đẩy cùng lúc tạo $race_rows dòng"; exit 1; fi
echo "PASS: hai nguồn đẩy cùng lúc: đích chỉ có 1 dòng"
if [ "${WITH_V609:-1}" = "1" ]; then
  echo "== gỡ V609 (về đúng thân V608), apply lại V609 bị sổ chặn"
  psql_run "-f '$work/rollback_v609_find_data_push_match_key.sql'"
  psql_run "-c \"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121090000', 'migration_v609_find_data_push_match_key')\""
  if psql_run "-f '$work/migration_v609_find_data_push_match_key.sql'" >/dev/null 2>&1; then echo "FAIL: có dòng sổ mà V609 vẫn chạy lại"; exit 1; fi
  psql_run "-c \"DELETE FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v60%'\""
  echo "PASS: gỡ V609 về V608; có dòng sổ thì V609 không chạy lại"
fi
echo "== rollback"
psql_run "-f '$work/rollback_v608_find_data_push_links.sql'"
echo "== apply lại sau rollback (chưa có dòng sổ): ok"
psql_run "-f '$work/migration_v608_find_data_push_links.sql'"
psql_run "-c \"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121000000', 'migration_v608_find_data_push_links')\""
psql_run "-f '$work/rollback_v608_find_data_push_links.sql'"
if psql_run "-f '$work/migration_v608_find_data_push_links.sql'" >/dev/null 2>&1; then
  echo "FAIL: có dòng sổ mà V608 vẫn chạy lại"; exit 1
fi
echo "PASS: có dòng sổ thì V608 không chạy lại"
echo "== xong"
