#!/bin/sh
# v455 Web quản lý tài khoản/chiến dịch Desktop: test trên PostgreSQL cục bộ dùng một lần.
# Không đọc credential ứng dụng, không kết nối ra ngoài.
# Chạy: PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-web-desktop-accounts-sql.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
pg_bin=${PG_TEST_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}
fixtures="$script_dir/fixtures/web-desktop-accounts-v455"
snapshot="$repo_dir/migrations/snapshots/web-desktop-accounts-v455"
migration="$repo_dir/migrations/migration_v455_web_desktop_accounts.sql"
port=${PG_TEST_PORT:-25453}
test_dir=$(mktemp -d /tmp/aka-web-desktop-sql.XXXXXX)
cleanup() { "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C -U postgres >/dev/null
"$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p $port -c max_connections=10" -w start >/dev/null
run() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
run -f "$fixtures/schema.sql" -f "$snapshot/baseline.sql" -f "$fixtures/baseline-acl.sql"
run -f "$migration"
run -f "$fixtures/assertions.sql"
# Áp lại không đổi gì (idempotent), rollback về đúng baseline, rồi áp lại lần nữa.
run -f "$migration"
run -f "$snapshot/rollback.sql" -f "$fixtures/baseline-acl.sql" -f "$fixtures/rollback-assertions.sql"
run -f "$migration" -f "$fixtures/assertions.sql"
echo "v455 web desktop accounts SQL tests passed"
