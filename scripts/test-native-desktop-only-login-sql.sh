#!/bin/sh
# v462 (phiên app iOS của tổ chức chỉ có gói Zalo Desktop): test trên PostgreSQL cục bộ dùng một lần,
# dựng từ fixtures V461 rồi áp V461 → v462. Không đọc credential ứng dụng, không kết nối ra ngoài.
# Chạy: PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-native-desktop-only-login-sql.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
pg_bin=${PG_TEST_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}
fixtures="$script_dir/fixtures/web-desktop-accounts-v461"
v462_fixtures="$script_dir/fixtures/native-desktop-only-login-v462"
snapshot="$repo_dir/migrations/snapshots/web-desktop-accounts-v461"
v461="$repo_dir/migrations/migration_v461_web_desktop_accounts.sql"
v462="$repo_dir/migrations/migration_v462_native_desktop_only_login.sql"
rollback="$repo_dir/migrations/rollback_v462_native_desktop_only_login.sql"
port=${PG_TEST_PORT:-25462}
test_dir=$(mktemp -d /tmp/aka-v462-sql.XXXXXX)
cleanup() { "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C -U postgres >/dev/null
"$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p $port -c max_connections=10" -w start >/dev/null
run() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 "$@"; }
seed_db() {
  run -d postgres -c "create database $1"
  run -d "$1" -f "$fixtures/schema.sql" -f "$snapshot/baseline.sql" -f "$fixtures/baseline-acl.sql" -f "$fixtures/compare-seed.sql" -f "$v461"
}
fn_state() {
  run -d "$1" -At -c "select md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '') from pg_proc p
    where p.oid = 'public.aka_agent_authenticate_control_session(text)'::regprocedure"
}

# Ca 1: V461 → v462 → assertions; áp lại không đổi gì; rollback; áp lại.
seed_db main
before=$(fn_state main)
case "$before" in de8f93ee545bca94a199b2dffb9fe324\ *) ;; *) echo "V461 source md5 khác: $before"; exit 1 ;; esac
run -d main -f "$v462" -f "$v462_fixtures/assertions.sql"
after=$(fn_state main)
test "${after#* }" = "${before#* }" || { echo "ACL đổi: $before -> $after"; exit 1; }
run -d main -f "$v462" 2>&1 | grep -q 'đã được apply' || { echo 'lần áp thứ hai phải bỏ qua'; exit 1; }
run -d main -f "$rollback" -f "$v462_fixtures/rollback-assertions.sql"
test "$(fn_state main)" = "$before" || { echo 'rollback không về đúng V461'; exit 1; }
run -d main -f "$rollback" 2>&1 | grep -q 'đã ở bản V461' || { echo 'rollback lần hai phải bỏ qua'; exit 1; }
run -d main -f "$v462" -f "$v462_fixtures/assertions.sql"

# Ca 2: hàm nguồn lệch → dừng, không đổi gì.
seed_db drift
run -d drift -c "alter function public.aka_agent_authenticate_control_session(text) set work_mem = '64kB'"
drift_before=$(fn_state drift)
if run -d drift -f "$v462" >"$test_dir/drift.out" 2>&1; then echo 'drift phải bị từ chối'; exit 1; fi
grep -q 'v462_unexpected_definition' "$test_dir/drift.out" || { cat "$test_dir/drift.out"; exit 1; }
test "$(fn_state drift)" = "$drift_before" || { echo 'drift làm đổi hàm'; exit 1; }
echo "v462 native desktop-only login SQL tests passed"
