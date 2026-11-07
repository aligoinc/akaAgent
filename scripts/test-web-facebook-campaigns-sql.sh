#!/bin/sh
# v476 Web/iOS quản lý chiến dịch Facebook: test trên PostgreSQL cục bộ dùng một lần.
# Không đọc credential ứng dụng, không kết nối ra ngoài.
# Nền = fixtures V461 + migration V461 + V464, tức đúng 6 định nghĩa live trước V476 (kiểm md5 + ACL).
# Ca:
#   1. caller cũ (không token 'facebook') giống hệt trước apply, sau apply, sau rollback, sau apply lại;
#   2. assertions Facebook (đọc, dừng/tiếp tục, xoá, đường ghi vẫn chặn, xác thực, chính sách, quyền);
#   3. apply lại không đổi gì và giữ giá trị chính sách đã chỉnh; rollback chạy lại được;
#   4. định nghĩa nguồn lệch → dừng trước khi đổi gì;
#   5. script so sánh chỉ đọc (một thông điệp như execute_sql) không đổi gì;
#   6. script áp một lần dán: thành công giống hệt migration thường, chạy lại bị chặn, nguồn lệch thì dừng;
#   7. smoke production sau apply.
# Chạy: PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-web-facebook-campaigns-sql.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
pg_bin=${PG_TEST_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}
v461_fixtures="$script_dir/fixtures/web-desktop-accounts-v461"
v461_snapshot="$repo_dir/migrations/snapshots/web-desktop-accounts-v461"
fixtures="$script_dir/fixtures/web-facebook-campaigns-v476"
snapshot="$repo_dir/migrations/snapshots/web-facebook-campaigns-v476"
migration="$repo_dir/migrations/migration_v476_web_facebook_campaigns.sql"
compare="$repo_dir/migrations/tests/migration_v476_web_facebook_campaigns_compare.sql"
guarded="$repo_dir/migrations/tests/migration_v476_web_facebook_campaigns_guarded_apply.sql"
smoke="$repo_dir/migrations/tests/migration_v476_web_facebook_campaigns_smoke.sql"
port=${PG_TEST_PORT:-25466}
test_dir=$(mktemp -d /tmp/aka-v476-sql.XXXXXX)
# initdb/pg_ctl không chạy dưới root (container cloud): khi đó chạy bằng user postgres.
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ "$(id -u)" = 0 ]; then chown postgres "$test_dir"; fi
cleanup() { as_pg "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
as_pg "$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C -U postgres >/dev/null
as_pg "$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p $port -c max_connections=10" -w start >/dev/null
export PGOPTIONS='-c client_min_messages=warning'
run() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 "$@"; }
one_message() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -At -F '|' -d "$1" -c "$(cat "$2")"; }
seed_db() {
  run -d postgres -c "create database $1"
  run -d "$1" -f "$v461_fixtures/schema.sql" -f "$v461_snapshot/baseline.sql" -f "$v461_fixtures/baseline-acl.sql" \
    -f "$repo_dir/migrations/migration_v461_web_desktop_accounts.sql" \
    -f "$repo_dir/migrations/migration_v464_native_desktop_only_login.sql" \
    -f "$snapshot/baseline.sql" -f "$fixtures/baseline-check.sql" -f "$fixtures/seed.sql"
  run -d "$1" -c "create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[])"
}
fingerprint() {
  run -d "$1" -At -c "select md5(string_agg(x, E'\\n' order by x)) from (
    select 'fn:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '') as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
    union all select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
    from information_schema.columns where table_schema = 'public'
    union all select 'set:' || key || ':' || coalesce(value, '') || ':' || is_secret || ':' || is_active from public.auto_system_settings) s"
}
new_objects() {
  run -d "$1" -At -c "select count(*) from pg_proc where proname in ('aka_agent_web_facebook_campaigns_policy', 'aka_agent_control_web_facebook_campaigns_policy')
    union all select count(*) from auto_system_settings where key = 'web.facebook_campaigns'" | tr '\n' ' '
}

# 1–3. Apply, caller cũ, assertions, apply lại, rollback, apply lại.
seed_db main
run -d main -f "$fixtures/legacy-calls.sql" -f "$fixtures/legacy-capture.sql"
run -d main -f "$migration"
run -d main -f "$fixtures/legacy-compare.sql" -f "$fixtures/assertions.sql"
run -d main -c "update auto_system_settings set value = '{\"enabled\":true,\"organizationIds\":[21],\"facebookOnlyLogin\":false}' where key = 'web.facebook_campaigns'"
before=$(fingerprint main)
reapply=$(PGOPTIONS='-c client_min_messages=notice' run -d main -f "$migration" 2>&1)
echo "$reapply" | grep -q 'v476 đã được apply trước đó; không đổi gì' || { echo "$reapply"; echo 'reapply notice missing'; exit 1; }
test "$(fingerprint main)" = "$before" || { echo 'reapply changed state'; exit 1; }
run -d main -c "update auto_system_settings set value = '{\"enabled\":false,\"organizationIds\":null,\"facebookOnlyLogin\":false}' where key = 'web.facebook_campaigns'"
run -d main -f "$snapshot/rollback.sql"
run -d main -f "$fixtures/rollback-assertions.sql" -f "$fixtures/legacy-compare.sql"
rerollback=$(PGOPTIONS='-c client_min_messages=notice' run -d main -f "$snapshot/rollback.sql" 2>&1)
echo "$rerollback" | grep -q 'v476 đã ở baseline' || { echo "$rerollback"; echo 'second rollback notice missing'; exit 1; }
run -d main -f "$fixtures/rollback-assertions.sql"
run -d main -f "$migration" -f "$fixtures/legacy-compare.sql" -f "$fixtures/assertions.sql"
# 7. Smoke production trên nền đã apply.
run -d main -c "begin" -f "$smoke" -c "rollback"
echo 'v476: apply/compare/assertions/reapply/rollback/smoke passed'

# 4. Nguồn lệch → dừng, không đổi gì (giao dịch rollback cả seed chính sách và hàm mới).
seed_db drift
run -d drift -c "alter function public.delete_control_campaign_atomic(bigint,bigint,bigint) set work_mem = '64kB'"
drift_before=$(fingerprint drift)
if run -d drift -f "$migration" >"$test_dir/drift.out" 2>&1; then echo 'drift should fail'; exit 1; fi
grep -q 'v476_unexpected_definition' "$test_dir/drift.out" || { cat "$test_dir/drift.out"; exit 1; }
test "$(fingerprint drift)" = "$drift_before" || { echo 'drift changed state'; exit 1; }
test "$(new_objects drift)" = '0 0 ' || { echo 'drift left new objects'; exit 1; }
echo 'v476: drift guard passed'

# 5. Script so sánh chỉ đọc chạy như một lệnh execute_sql: đủ dòng, mọi dòng đạt, không đổi gì.
seed_db cmp
cmp_before=$(fingerprint cmp)
result=$(one_message cmp "$compare")
echo "$result" | grep -c '^patch_dry_run|||t|' | grep -qx 6 || { echo "$result"; echo 'patch dry run rows missing'; exit 1; }
echo "$result" | grep -q '|f|' && { echo "$result"; echo 'compare row failed'; exit 1; }
for check in page_legacy_same page_desktop_same snapshot_legacy_same snapshot_desktop_same catalog_desktop_same \
  activity_desktop_same page_facebook snapshot_facebook activity_facebook; do
  echo "$result" | grep -q "^$check|" || { echo "$result"; echo "missing $check"; exit 1; }
done
test "$(fingerprint cmp)" = "$cmp_before" || { echo 'compare changed state'; exit 1; }
echo "$result" | grep -c '_same|' | xargs printf 'v476: compare passed (%s legacy rows)\n'

# 6. Áp một lần dán như SQL Editor.
seed_db guard_ok
result=$(one_message guard_ok "$guarded")
echo "$result" | grep -q '^applied|||t|' || { echo "$result"; echo 'applied row missing'; exit 1; }
seed_db plain_case
run -d plain_case -f "$migration"
test "$(fingerprint guard_ok)" = "$(fingerprint plain_case)" || { echo 'guarded apply differs from plain migration'; exit 1; }
test "$(run -d guard_ok -At -c "select count(*) from supabase_migrations.schema_migrations where name='migration_v476_web_facebook_campaigns' and statements[1] like '%COMMIT;%'")" = 1
if one_message guard_ok "$guarded" >"$test_dir/rerun.out" 2>&1; then echo 'guarded rerun should fail'; exit 1; fi
grep -q 'v476_guard_failed' "$test_dir/rerun.out" || { cat "$test_dir/rerun.out"; exit 1; }
test "$(run -d guard_ok -At -c "select count(*) from supabase_migrations.schema_migrations")" = 1
seed_db guard_drift
run -d guard_drift -c "alter function public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer) set work_mem = '64kB'"
if one_message guard_drift "$guarded" >"$test_dir/guard-drift.out" 2>&1; then echo 'guarded drift should fail'; exit 1; fi
grep -q 'v476_unexpected_definition' "$test_dir/guard-drift.out" || { cat "$test_dir/guard-drift.out"; exit 1; }
test "$(new_objects guard_drift)" = '0 0 ' || { echo 'guarded drift left new objects'; exit 1; }
test "$(run -d guard_drift -At -c "select count(*) from supabase_migrations.schema_migrations")" = 0
echo 'v476: guarded apply passed'
echo "v476 web facebook campaigns SQL tests passed"
