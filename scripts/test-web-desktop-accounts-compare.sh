#!/bin/sh
# Thử script so sánh v455 (chỉ đọc) trên PostgreSQL cục bộ dựng từ định nghĩa live (baseline).
# Chạy: PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-web-desktop-accounts-compare.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
pg_bin=${PG_TEST_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}
fixtures="$script_dir/fixtures/web-desktop-accounts-v455"
snapshot="$repo_dir/migrations/snapshots/web-desktop-accounts-v455"
port=${PG_TEST_PORT:-25454}
test_dir=$(mktemp -d /tmp/aka-v455-compare.XXXXXX)
cleanup() { "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C -U postgres >/dev/null
"$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p $port -c max_connections=10" -w start >/dev/null
run() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
run -f "$fixtures/schema.sql" -f "$snapshot/baseline.sql" -f "$fixtures/baseline-acl.sql" -f "$fixtures/compare-seed.sql"
result=$(run -At -F '|' -f "$repo_dir/migrations/tests/migration_v455_web_desktop_accounts_compare.sql")
echo "$result"
echo "$result" | grep -c '^patch_dry_run|||t|' | grep -qx 10 || { echo 'patch dry run failed'; exit 1; }
if echo "$result" | grep -E '^(page|snapshot|logs)_legacy_same\|' | grep -vq '|t|'; then echo 'legacy parity failed'; exit 1; fi
test "$(run -At -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like '%\_v455'")" = 0
echo "v455 compare script local test passed"
