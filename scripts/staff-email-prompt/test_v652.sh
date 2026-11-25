#!/usr/bin/env bash
# Kiểm V652 trên PostgreSQL 16 cục bộ: fixture -> p1 -> p2 -> p3 -> khẳng định -> p3 chạy lại -> gỡ.
# Cách chạy: bash scripts/staff-email-prompt/test_v652.sh   (cần /usr/lib/postgresql/16/bin; chạy bằng root thì dùng user postgres)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
B="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
RUN=(); if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; RUN=(su postgres -c); fi
run() { if [ ${#RUN[@]} -gt 0 ]; then "${RUN[@]}" "$*"; else bash -c "$*"; fi; }
cleanup() { run "$B/pg_ctl -D $WORK/data stop -m fast >/dev/null 2>&1" || true; rm -rf "$WORK"; }
trap cleanup EXIT
run "LC_ALL=C $B/initdb -D $WORK/data -A trust >/dev/null"
run "$B/pg_ctl -D $WORK/data -o '-p 55452 -k $WORK -c listen_addresses=' -l $WORK/log start -w >/dev/null"
cp "$HERE"/fixture.sql "$HERE"/assertions.sql "$HERE"/assertions_v654.sql "$REPO"/migrations/migration_v654_staff_email_prompt_fixes.sql "$REPO"/migrations/rollback_v654_staff_email_prompt_fixes.sql "$REPO"/migrations/migration_v652_staff_email_prompt_p{1,2,3}.sql "$REPO"/migrations/rollback_v652_staff_email_prompt.sql "$WORK"/
chmod 644 "$WORK"/*.sql
PSQL="psql -h $WORK -p 55452 -X -q -v ON_ERROR_STOP=1 -d postgres"
run "$PSQL -f $WORK/fixture.sql"
run "$PSQL -f $WORK/migration_v652_staff_email_prompt_p1.sql"
run "$PSQL -f $WORK/migration_v652_staff_email_prompt_p2.sql"
run "$PSQL -f $WORK/migration_v652_staff_email_prompt_p3.sql" 2>&1 | grep -o 'V652 p3:.*' || true
run "$PSQL -f $WORK/assertions.sql" > "$WORK/out.txt" 2>&1 || true
if grep -E 'FAIL|ERROR' "$WORK/out.txt"; then exit 1; fi
# V654 sau khi đã có dữ liệu của V652; gỡ V654 rồi chạy lại V654.
run "$PSQL -f $WORK/migration_v654_staff_email_prompt_fixes.sql"
run "$PSQL -f $WORK/rollback_v654_staff_email_prompt_fixes.sql"
run "$PSQL -f $WORK/migration_v654_staff_email_prompt_fixes.sql"
run "$PSQL -c \"insert into supabase_migrations.schema_migrations values ('x','migration_v654_staff_email_prompt_fixes','{}')\""
if run "$PSQL -f $WORK/migration_v654_staff_email_prompt_fixes.sql" >/dev/null 2>&1; then echo 'FAIL V654 chạy lại không bị chặn'; exit 1; fi
run "$PSQL -f $WORK/assertions_v654.sql" >> "$WORK/out.txt" 2>&1 || true
if grep -E 'FAIL|ERROR' "$WORK/out.txt"; then exit 1; fi
PASS=$(grep -c 'PASS' "$WORK/out.txt" || true)
echo "PASS: $PASS"
# p1 / p2 chạy lại phải bị từ chối (đã có cột / bảng).
if run "$PSQL -f $WORK/migration_v652_staff_email_prompt_p1.sql" >/dev/null 2>&1; then echo 'FAIL p1 chạy lại không bị chặn'; exit 1; fi
if run "$PSQL -f $WORK/migration_v652_staff_email_prompt_p2.sql" >/dev/null 2>&1; then echo 'FAIL p2 chạy lại không bị chặn'; exit 1; fi
echo 'PASS p1/p2 chạy lại bị chặn'
run "$PSQL -f $WORK/migration_v652_staff_email_prompt_p3.sql" 2>&1 | grep -o 'V652 p3:.*'
run "$PSQL -f $WORK/rollback_v652_staff_email_prompt.sql"
LEFT=$(run "$PSQL -tA -c \"select count(*) from information_schema.columns where column_name='email_list'\"")
[ "$LEFT" = 0 ] || { echo "FAIL gỡ còn cột email_list"; exit 1; }
echo 'PASS gỡ sạch'
