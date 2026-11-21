#!/usr/bin/env bash
# Đo thời gian aka_agent_find_data_push_v1 (V608 + V610) trên đích lớn (PG16 cục bộ): 2.000 group vào đích 7.745 dòng + 60.000 dòng,
# 2.000 link bài vào đích 60.000 dòng có tham số theo dõi. Kiểm luôn số dòng thêm đúng (894 / 0 / 65).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"; work="$(mktemp -d)"; port="${PGPORT_TEST:-55609}"
as_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 777 "$work"
cleanup() { as_pg "LC_ALL=C '$PGBIN/pg_ctl' -D '$work/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
as_pg "LC_ALL=C '$PGBIN/initdb' -D '$work/data' -U postgres -A trust >/dev/null"
as_pg "LC_ALL=C '$PGBIN/pg_ctl' -D '$work/data' -o '-p $port -k $work' -l '$work/log' start -w >/dev/null"
cp "$here/fixture_v608.sql" "$repo/migrations/migration_v608_find_data_push_links.sql" "$repo/migrations/migration_v610_find_data_push_match_key.sql" "$work/"
cat > "$work/perf.sql" <<'SQL'
\set ON_ERROR_STOP 1
\set QUIET 1
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('1', 'migration_v608_find_data_push_links');
\i migration_v610_find_data_push_match_key.sql
INSERT INTO public.auto_campaigns (id, name, action_id, staff_id, organization_id, extra_settings) VALUES
 (1, 'Nguồn', 'facebook_find_data_search', 1, 100, '{"isFindFacebookGroup":true,"findFacebookGroupJoinTargetCampaignIds":[2,3],"isFindPostLink":true,"findPostLinkTargetCampaignIds":[4]}'),
 (2, 'Đích 7745', 'facebook_join_group', 1, 100, '{}'), (3, 'Đích 60000', 'facebook_join_group', 1, 100, '{}'),
 (4, 'Đích link bài 60000', 'facebook_comment_seeding_post', 1, 100, '{}');
INSERT INTO public.auto_campaign_input_data (campaign_id, uid) SELECT 2, 'https://www.facebook.com/groups/g' || i || '/' FROM generate_series(1, 7745) i;
INSERT INTO public.auto_campaign_input_data (campaign_id, uid) SELECT 3, 'https://www.facebook.com/groups/g' || i || '/' FROM generate_series(1, 60000) i;
INSERT INTO public.auto_campaign_input_data (campaign_id, uid) SELECT 4, 'https://www.facebook.com/groups/1/posts/' || i || '/?__cft__[0]=AZ' || i || '&__tn__=R' FROM generate_series(1, 60000) i;
INSERT INTO public.auto_campaign_input_data (campaign_id, uid) SELECT 100 + (i % 10), 'x' || i FROM generate_series(1, 200000) i;
ANALYZE public.auto_campaign_input_data;
\timing on
\unset QUIET
BEGIN; SELECT set_config('test.staff_id', '1', true) \g /dev/null
SET LOCAL ROLE aka_agent_desktop;
SELECT jsonb_path_query_array(public.aka_agent_find_data_push_v1(jsonb_build_object('sourceCampaignId', 1, 'outputKind', 'facebook_group',
  'items', (SELECT jsonb_agg(jsonb_build_object('value', 'https://www.facebook.com/groups/g' || (i * 7) || '/', 'key', 'k' || i)) FROM generate_series(1, 2000) i))), '$.targets[*].inserted') AS groups_inserted;
COMMIT;
BEGIN; SELECT set_config('test.staff_id', '1', true) \g /dev/null
SET LOCAL ROLE aka_agent_desktop;
SELECT jsonb_path_query_array(public.aka_agent_find_data_push_v1(jsonb_build_object('sourceCampaignId', 1, 'outputKind', 'post_link',
  'items', (SELECT jsonb_agg(jsonb_build_object('value', 'https://www.facebook.com/groups/1/posts/' || (i * 31) || '/', 'key', 'k' || i)) FROM generate_series(1, 2000) i))), '$.targets[*].inserted') AS posts_inserted;
COMMIT;
SQL
[ "$(id -u)" = "0" ] && chown postgres "$work"/*.sql
psql_run() { as_pg "cd '$work' && '$PGBIN/psql' -X -q -v ON_ERROR_STOP=1 -h '$work' -p $port -U postgres -d postgres $*"; }
psql_run "-f fixture_v608.sql" >/dev/null
psql_run "-f migration_v608_find_data_push_links.sql" >/dev/null
out="$(psql_run "-f perf.sql" 2>&1)"
echo "$out" | grep -E 'Time: [0-9]{3,}|\[' 
echo "$out" | grep -q '\[894, 0\]' || { echo 'FAIL: số group thêm sai'; exit 1; }
echo "$out" | grep -q '\[65\]' || { echo 'FAIL: số link bài thêm sai'; exit 1; }
echo 'PASS: số dòng thêm đúng'
