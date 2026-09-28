#!/bin/sh
# Disposable local DB, no application credentials or external connections.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pg_bin=${PG_TEST_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}
test_dir=$(mktemp -d /tmp/aka-desktop-ui-sql.XXXXXX)
cleanup() { "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C >/dev/null
"$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p 25441 -c max_connections=10" -w start >/dev/null
"$pg_bin/psql" -X -h "$test_dir" -p 25441 -d postgres -v ON_ERROR_STOP=1 -f "$script_dir/fixtures/desktop-ui/schema.sql" -f "$script_dir/../migrations/migration_v327_desktop_ui_reads.sql" -f "$script_dir/fixtures/desktop-ui/assertions.sql" -f "$script_dir/../migrations/migration_v327_desktop_ui_reads.sql" -f "$script_dir/../migrations/migration_v328_desktop_ui_read_deltas.sql" -f "$script_dir/fixtures/desktop-ui/deltas.sql" -f "$script_dir/../migrations/migration_v328_desktop_ui_read_deltas.sql"
