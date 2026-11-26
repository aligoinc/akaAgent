#!/usr/bin/env bash
# Kiểm V660 trên Postgres cục bộ (PG16/17), cả bản gỡ. Cách chạy: bash scripts/zalo-tag-sync/v660-smoke.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$DIR/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/v660-smoke.XXXXXX")"; chmod 777 "$TMP"
RUN=(); if [ "$(id -u)" = 0 ]; then RUN=(runuser -u postgres --); fi
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; echo "(thư mục tạm giữ lại: $TMP)"; }
trap cleanup EXIT
export LC_ALL=C
"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -p 55660 -c listen_addresses=''" -l "$TMP/log" start >/dev/null
cp "$REPO/migrations/migration_v660_zalo_tag_sync.sql" "$REPO/migrations/rollback_v660_zalo_tag_sync.sql" "$DIR"/v660-*.sql "$TMP/"; chmod 644 "$TMP"/*.sql
PSQL=("${RUN[@]}" psql -h "$TMP" -p 55660 -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c 'CREATE DATABASE t'
"${PSQL[@]}" -d t -f "$TMP/v660-fixture.sql"
"${PSQL[@]}" -d t -v migration="$TMP/migration_v660_zalo_tag_sync.sql" -f "$TMP/v660-smoke.sql" 2>&1 | grep -E "PASS|FAIL|ERROR|ALL PASS"
"${PSQL[@]}" -d t -f "$TMP/rollback_v660_zalo_tag_sync.sql"
"${PSQL[@]}" -d t -tAc "SELECT CASE WHEN to_regclass('public.auto_zalo_tag_members') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_aka_agent_zalo_tag_sync_campaign%') AND NOT EXISTS (SELECT 1 FROM auto_system_settings WHERE key LIKE 'zalo.tag_sync.%') AND NOT EXISTS (SELECT 1 FROM auto_outcome_policies WHERE source='v660') AND NOT EXISTS (SELECT 1 FROM auto_outcome_signal_rules WHERE source='v660') THEN 'PASS: bản gỡ sạch' ELSE 'FAIL: bản gỡ còn sót' END"
"${PSQL[@]}" -d t -c "DELETE FROM auto_error WHERE error_code IN ('err_engine_zalo_tag_not_friend', 'err_engine_zalo_tag_friend_unavailable')"
"${PSQL[@]}" -d t -f "$TMP/migration_v660_zalo_tag_sync.sql" && echo 'PASS: apply lại sau khi gỡ'
