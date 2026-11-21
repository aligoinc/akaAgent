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
   "$repo/migrations/rollback_v608_find_data_push_links.sql" "$repo/migrations/migration_v610_find_data_push_match_key.sql" \
   "$repo/migrations/rollback_v610_find_data_push_match_key.sql" "$work/"
[ "$(id -u)" = "0" ] && chown postgres "$work"/*.sql
psql_run "-f '$work/fixture_v608.sql'"
psql_run "-f '$work/seed_v608.sql'"
psql_run "-f '$work/migration_v608_find_data_push_links.sql'"
echo "== apply V608: ok"
if [ "${WITH_V610:-1}" = "1" ]; then
  # Các ca của V608 phải vẫn đúng sau V610 (khoá DB tính thay khoá app gửi).
  psql_run "-c \"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121072153', 'migration_v608_find_data_push_links')\""
  psql_run "-f '$work/migration_v610_find_data_push_match_key.sql'"
  echo "== apply V610: ok"
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
if [ "${WITH_V610:-1}" = "1" ]; then
  echo "== câu đối chiếu A↔B (reconcile-prod.sql): dữ liệu đúng ra 0 dòng, làm sai từng loại thì bắt được"
  body="$(sed -n '/^WITH params/,/^LIMIT 500;/p' "$here/reconcile-prod.sql" | sed "s/timestamptz '2026-11-21 00:00:00+00'/timestamptz '-infinity'/; s/^LIMIT 500;/LIMIT 500/")"
  cat > "$work/reconcile_test.sql" <<SQL
BEGIN;
CREATE TABLE IF NOT EXISTS public.auto_campaign_details (id bigint PRIMARY KEY, campaign_id bigint);
CREATE TABLE IF NOT EXISTS public.auto_data_ingest_batches (id bigserial PRIMARY KEY, request_id text, status text, created_at timestamptz DEFAULT now());
INSERT INTO public.auto_campaign_details (id, campaign_id)
  SELECT DISTINCT source_detail_id, source_campaign_id FROM public.auto_campaign_data_link_deliveries WHERE source_detail_id IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO public.auto_data_ingest_batches (request_id, status) VALUES ('find-data:20:1:1:9:facebook_group:0:x:v1', 'completed');
CREATE TEMP VIEW recon AS $body;
SELECT 'CLEAN ' || count(*) FROM recon;
SELECT 'CLEANDETAIL ' || check_id || ' ' || problem || ' ' || coalesce(detail,'') FROM recon;
-- C1: xoá dòng B do hàm đẩy thêm. C2: thêm vào B cùng data viết khác. C3: lệch bộ đếm. C4: dòng "Tìm data" sai chiến dịch.
-- C5: lượt đẩy Nhóm data lỗi. C6: đích đã xoá mà liên kết còn active, sổ ghi sau lúc xoá.
WITH a AS (SELECT target_input_data_id AS id FROM public.auto_campaign_data_link_deliveries WHERE result = 'inserted' AND target_input_data_id IS NOT NULL ORDER BY id LIMIT 1)
UPDATE public.auto_campaign_input_data x SET is_delete = true FROM a WHERE x.id = a.id;
WITH b AS (SELECT d.target_campaign_id, d.value FROM public.auto_campaign_data_link_deliveries d JOIN public.auto_campaign_data_links l ON l.id = d.link_id
            JOIN public.auto_campaign_data_link_rules r ON r.id = l.rule_id
           WHERE d.result = 'inserted' AND r.value_column = 'uid' AND r.output_kind IN ('facebook_group','facebook_uid') ORDER BY d.id DESC LIMIT 1)
INSERT INTO public.auto_campaign_input_data (campaign_id, uid, status) SELECT target_campaign_id, upper(value) || '/', 'chờ xử lý' FROM b;
UPDATE public.auto_campaign_data_links SET inserted_count = inserted_count + 1 WHERE id = (SELECT min(id) FROM public.auto_campaign_data_links WHERE inserted_count > 0);
UPDATE public.auto_campaign_details SET campaign_id = -1 WHERE id = (SELECT min(id) FROM public.auto_campaign_details);
INSERT INTO public.auto_data_ingest_batches (request_id, status, created_at) VALUES ('find-data:20:2:2:9:facebook_group:0:y:v1', 'failed', now() - interval '1 hour');
UPDATE public.auto_campaigns SET is_delete = true, updated_at = '2000-01-01'
 WHERE id = (SELECT max(l.target_campaign_id) FROM public.auto_campaign_data_links l WHERE l.status = 'active' AND l.last_push_at IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.auto_campaign_data_link_deliveries d WHERE d.link_id = l.id));
SELECT 'FOUND ' || string_agg(DISTINCT check_id, ',' ORDER BY check_id) FROM recon;
ROLLBACK;
SQL
  [ "$(id -u)" = "0" ] && chown postgres "$work/reconcile_test.sql"
  rec_out="$(psql_run "-t -A -f '$work/reconcile_test.sql'")"
  echo "$rec_out" | grep -E '^(CLEANDETAIL)' || true
  if ! echo "$rec_out" | grep -qx 'CLEAN 0'; then echo "FAIL: đối chiếu trên dữ liệu đúng ra lệch"; echo "$rec_out"; exit 1; fi
  if ! echo "$rec_out" | grep -qx 'FOUND C1,C2,C3,C4,C5,C6'; then echo "FAIL: đối chiếu không bắt đủ 6 loại lệch"; echo "$rec_out"; exit 1; fi
  echo "PASS: đối chiếu A↔B: dữ liệu đúng 0 dòng lệch; bắt đủ C1–C6 khi làm sai"
fi
if [ "${WITH_V610:-1}" = "1" ]; then
  echo "== gỡ V610 (về đúng thân V608), apply lại V610 bị sổ chặn"
  psql_run "-f '$work/rollback_v610_find_data_push_match_key.sql'"
  psql_run "-c \"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121090000', 'migration_v610_find_data_push_match_key')\""
  if psql_run "-f '$work/migration_v610_find_data_push_match_key.sql'" >/dev/null 2>&1; then echo "FAIL: có dòng sổ mà V610 vẫn chạy lại"; exit 1; fi
  psql_run "-c \"DELETE FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v60%'\""
  echo "PASS: gỡ V610 về V608; có dòng sổ thì V610 không chạy lại"
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
