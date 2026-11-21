#!/usr/bin/env bash
# Kiểm khoá so sánh V614 bằng bộ nhận diện độc lập trên giá trị thật (xem key-holes.cjs). Dựng Postgres tạm, nạp V608 → V610 → V614.
#   PG_MODULE=<node_modules/pg> bash scripts/find-data-push/test_v614_keys.sh <corpus.json> [báo cáo.json]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
work="$(mktemp -d)"
port="${PGPORT_TEST:-55614}"
as_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 755 "$work"; [ "$(id -u)" = "0" ] && chown postgres "$work"
cleanup() { as_pg "LC_ALL=C '$PGBIN/pg_ctl' -D '$work/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
as_pg "LC_ALL=C '$PGBIN/initdb' -D '$work/data' -U postgres -A trust >/dev/null"
as_pg "LC_ALL=C '$PGBIN/pg_ctl' -D '$work/data' -o '-p $port -k $work' -l '$work/log' start -w >/dev/null"
psql_run() { as_pg "'$PGBIN/psql' -X -q -v ON_ERROR_STOP=1 -h '$work' -p $port -U postgres -d postgres $*"; }
cp "$here"/fixture_v608.sql "$here"/seed_v608.sql "$repo/migrations/migration_v608_find_data_push_links.sql" \
   "$repo/migrations/migration_v610_find_data_push_match_key.sql" "$repo/migrations/migration_v614_find_data_push_match_key_v2.sql" "$work/"
[ "$(id -u)" = "0" ] && chown postgres "$work"/*.sql
psql_run "-f '$work/fixture_v608.sql'" >/dev/null
psql_run "-f '$work/seed_v608.sql'" >/dev/null
psql_run "-f '$work/migration_v608_find_data_push_links.sql'" >/dev/null
psql_run "-c \"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('1', 'migration_v608_find_data_push_links')\"" >/dev/null
psql_run "-f '$work/migration_v610_find_data_push_match_key.sql'" >/dev/null
psql_run "-c \"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('2', 'migration_v610_find_data_push_match_key')\"" >/dev/null
psql_run "-f '$work/migration_v614_find_data_push_match_key_v2.sql'" >/dev/null
echo "== V608 → V610 → V614: ok"
PGHOST="$work" PGPORT="$port" PGUSER=postgres node "$here/key-holes.cjs" "$1" "${2:-}"
