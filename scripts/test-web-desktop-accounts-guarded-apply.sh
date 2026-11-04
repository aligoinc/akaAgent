#!/bin/sh
# Thử script áp v461 một lần dán (SQL Editor) trên PostgreSQL cục bộ dựng từ định nghĩa live.
# Ca 1: chạy như SQL Editor (một thông điệp) → áp thành công, assertions đạt, có lịch sử migration.
# Ca 2: chạy lại → chốt chặn từ chối, không đổi gì.
# Ca 3: một hàm nguồn bị sửa khác → dừng trước khi áp, không có cột/hàm mới, không có lịch sử.
# Chạy: PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-web-desktop-accounts-guarded-apply.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
pg_bin=${PG_TEST_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}
fixtures="$script_dir/fixtures/web-desktop-accounts-v461"
snapshot="$repo_dir/migrations/snapshots/web-desktop-accounts-v461"
guarded="$repo_dir/migrations/tests/migration_v461_web_desktop_accounts_guarded_apply.sql"
port=${PG_TEST_PORT:-25455}
test_dir=$(mktemp -d /tmp/aka-v461-guarded.XXXXXX)
cleanup() { "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C -U postgres >/dev/null
"$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p $port -c max_connections=10" -w start >/dev/null
run() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 "$@"; }
sql_editor() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -At -F '|' -d "$1" -c "$(cat "$guarded")"; }
seed_db() {
  run -d postgres -c "create database $1"
  run -d "$1" -f "$fixtures/schema.sql" -f "$snapshot/baseline.sql" -f "$fixtures/baseline-acl.sql" -f "$fixtures/compare-seed.sql"
  run -d "$1" -c "create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[])"
}

# Ca 1: áp thành công trong một thông điệp như SQL Editor.
seed_db ok_case
result=$(sql_editor ok_case)
echo "$result"
echo "$result" | grep -c '^patch_dry_run|||t|' | grep -qx 10 || { echo 'patch dry run rows missing'; exit 1; }
echo "$result" | grep -q '^applied|||t|' || { echo 'applied row missing'; exit 1; }
# Trạng thái cuối phải giống hệt áp file migration thường (hành vi của bản đó đã có assertions riêng).
seed_db plain_case
run -d plain_case -f "$repo_dir/migrations/migration_v461_web_desktop_accounts.sql"
fingerprint() {
  run -d "$1" -At -c "select md5(string_agg(x, E'\\n' order by x)) from (
    select 'fn:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '') as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
    union all select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
    from information_schema.columns where table_schema = 'public'
    union all select 'con:' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
    union all select 'set:' || key || ':' || coalesce(value, '') from public.auto_system_settings) s"
}
test "$(fingerprint ok_case)" = "$(fingerprint plain_case)" || { echo 'guarded apply differs from plain migration'; exit 1; }
test "$(run -d ok_case -At -c "select count(*) from supabase_migrations.schema_migrations where name='migration_v461_web_desktop_accounts' and statements[1] like '%COMMIT;%'")" = 1

# Ca 2: chạy lại bị chốt chặn từ chối, lịch sử vẫn đúng một dòng.
if sql_editor ok_case >"$test_dir/rerun.out" 2>&1; then echo 'rerun should fail'; exit 1; fi
grep -q 'v461_guard_failed' "$test_dir/rerun.out" || { cat "$test_dir/rerun.out"; exit 1; }
test "$(run -d ok_case -At -c "select count(*) from supabase_migrations.schema_migrations")" = 1

# Ca 3: định nghĩa nguồn lệch → dừng, không đổi gì.
seed_db drift_case
run -d drift_case -c "alter function public.aka_agent_device_presence(text,text,uuid,jsonb,boolean) set work_mem = '64kB'"
if sql_editor drift_case >"$test_dir/drift.out" 2>&1; then echo 'drift should fail'; exit 1; fi
grep -q 'v461_unexpected_definition' "$test_dir/drift.out" || { cat "$test_dir/drift.out"; exit 1; }
test "$(run -d drift_case -At -c "select count(*) from information_schema.columns where table_name='auto_staff_device_presence' and column_name like 'runtime_state%'")" = 0
test "$(run -d drift_case -At -c "select count(*) from pg_proc where proname in ('aka_agent_control_set_desktop_campaign_status','aka_agent_control_desktop_activity')")" = 0
test "$(run -d drift_case -At -c "select count(*) from supabase_migrations.schema_migrations")" = 0
echo "v461 guarded apply local test passed"
