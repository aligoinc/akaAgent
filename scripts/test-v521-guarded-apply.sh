#!/usr/bin/env bash
# Thử bản dán SQL Editor của V521 (migrations/tests/migration_v521_renewal_link_tickets_guarded_apply.sql) trên PostgreSQL 16
# cục bộ, không chạm production. Kiểm: bản dán còn khớp file migration (sinh lại không đổi), dán một lần thì tạo đủ bảng và
# hàm, ghi sổ migration với md5 = file, dán lần hai bị từ chối và không đổi gì, và DB đã apply V521 bằng đường khác (đã có
# dòng sổ) thì bản dán cũng bị từ chối.
# Dùng: bash scripts/test-v521-guarded-apply.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME=migration_v521_renewal_link_tickets
MIGRATION="$ROOT/migrations/$NAME.sql"
GUARDED="$ROOT/migrations/tests/${NAME}_guarded_apply.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v521g.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
psql_in() { local db=$1; shift; as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d "$db" -v ON_ERROR_STOP=1 -qAt "$@"; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }

FILE_MD5=$(md5sum "$MIGRATION" | cut -d' ' -f1)
before=$(md5sum "$GUARDED" | cut -d' ' -f1)
python3 "$ROOT/scripts/build-v521-guarded-apply-sql.py" >/dev/null
expect "bản dán khớp file migration hiện tại (sinh lại không đổi)" "$(md5sum "$GUARDED" | cut -d' ' -f1)" "$before"

as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN;
SQL
fixture() {
  psql_in postgres -c "CREATE DATABASE $1"
  psql_in "$1" >/dev/null <<'SQL'
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[], created_by text);
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.org_organization_product (id bigint PRIMARY KEY, organization_id bigint, is_deleted boolean DEFAULT false);
CREATE FUNCTION private.aka_agent_desktop_data_context()
RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public
AS $f$ SELECT s.id, s.organization_id, false FROM public.org_staff s WHERE false $f$;
INSERT INTO public.org_staff VALUES (7, 9, true);
INSERT INTO public.org_organization_product VALUES (501, 9, false);
SQL
}
fingerprint() {
  psql_in "$1" -c "SELECT md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text), ''))
    || '/' || (SELECT count(*) FROM supabase_migrations.schema_migrations)
    || '/' || (to_regclass('private.aka_renewal_link_tickets') IS NOT NULL)
    FROM pg_proc p WHERE p.proname LIKE '%renewal_link_ticket%'"
}

# --- dán một lần ---
fixture paste
out=$(psql_in paste -f "$GUARDED" 2>&1) || fail "dán lần đầu lỗi: $out"
case "$out" in applied\|*"|$NAME|$FILE_MD5|t|"*) ok "dán lần đầu: status applied, md5 sổ = file" ;; *) fail "kết quả dán khác mong đợi: $out" ;; esac
expect "sổ có đúng một dòng V521, statements[1] = nguyên văn file" \
  "$(psql_in paste -c "SELECT count(*) || ':' || max(md5(statements[1])) || ':' || max(array_length(statements, 1)) FROM supabase_migrations.schema_migrations WHERE name = '$NAME'")" "1:$FILE_MD5:1"
expect "version của dòng sổ là 14 chữ số" "$(psql_in paste -c "SELECT version ~ '^[0-9]{14}\$' FROM supabase_migrations.schema_migrations WHERE name = '$NAME'")" "t"
expect "có bảng vé, bật RLS" "$(psql_in paste -c "SELECT relrowsecurity FROM pg_class WHERE oid = 'private.aka_renewal_link_tickets'::regclass")" "t"
expect "đủ bốn hàm" "$(psql_in paste -c "SELECT count(*) FROM pg_proc WHERE proname LIKE '%renewal_link_ticket%'")" "4"
expect "API xin được vé sau khi dán" "$(psql_in paste -c "SET ROLE service_role; SELECT (public.aka_agent_control_renewal_link_ticket(7, 9, 501) ->> 'token') ~ '^[0-9a-f]{64}\$'")" "t"
expect "thân hàm giống hệt khi apply file migration trực tiếp" "$(
  fixture direct; psql_in direct -f "$MIGRATION" >/dev/null 2>&1
  a=$(psql_in direct -c "SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.proname LIKE '%renewal_link_ticket%'")
  b=$(psql_in paste -c "SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.proname LIKE '%renewal_link_ticket%'")
  [ -n "$a" ] && [ "$a" = "$b" ] && echo same || echo differ)" "same"

# --- dán lần hai: bị từ chối, không đổi gì ---
psql_in paste -c "DELETE FROM private.aka_renewal_link_tickets" >/dev/null
fp=$(fingerprint paste)
if out=$(psql_in paste -f "$GUARDED" 2>&1); then fail "dán lần hai không bị từ chối"; fi
case "$out" in *"đã có trong sổ migration, không chạy lại"*) ok "dán lần hai bị từ chối" ;; *) fail "thông báo khác: $out" ;; esac
expect "dán lần hai không đổi gì" "$(fingerprint paste)" "$fp"
expect "không còn giao dịch dở sau khi bị từ chối" "$(psql_in paste -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'paste' AND state LIKE 'idle in transaction%'")" "0"

# --- DB đã apply V521 bằng đường khác (MCP ghi dòng sổ riêng): bản dán bị từ chối ---
psql_in direct -c "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261113999999', '$NAME', ARRAY['x'])" >/dev/null
fp=$(fingerprint direct)
if out=$(psql_in direct -f "$GUARDED" 2>&1); then fail "dán lên DB đã apply không bị từ chối"; fi
case "$out" in *"đã có trong sổ migration, không chạy lại"*) ok "DB đã apply bằng đường khác: bản dán bị từ chối" ;; *) fail "thông báo khác: $out" ;; esac
expect "DB đã apply: không đổi gì" "$(fingerprint direct)" "$fp"

# --- có đối tượng mà sổ chưa ghi (apply dở bằng tay): preflight của migration chặn, không ghi sổ ---
fixture half
psql_in half -f "$MIGRATION" >/dev/null 2>&1
if out=$(psql_in half -f "$GUARDED" 2>&1); then fail "DB có sẵn bảng vé mà bản dán vẫn chạy"; fi
case "$out" in *"aka_renewal_link_tickets đã có"*) ok "DB có sẵn bảng vé: preflight chặn" ;; *) fail "thông báo khác: $out" ;; esac
expect "preflight chặn thì không ghi sổ" "$(psql_in half -c "SELECT count(*) FROM supabase_migrations.schema_migrations")" "0"

# --- bản gọn để chép từ khung chat (migrations/tests/..._paste.sql): nội dung một lần, kiểm md5 trước khi chạy ---
PASTE="$ROOT/migrations/tests/${NAME}_paste.sql"
before=$(md5sum "$PASTE" | cut -d' ' -f1)
python3 "$ROOT/scripts/build-v521-paste-sql.py" >/dev/null
expect "bản gọn khớp file migration hiện tại (sinh lại không đổi)" "$(md5sum "$PASTE" | cut -d' ' -f1)" "$before"
fixture compact
psql_in compact -c "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261113130104', 'migration_v520_notification_package_expiring', ARRAY['x'])" >/dev/null
out=$(psql_in compact -f "$PASTE" 2>&1) || fail "dán bản gọn lỗi: $out"
case "$out" in applied\|*"|$NAME|t") ok "bản gọn: status applied, md5 sổ = file" ;; *) fail "kết quả bản gọn khác mong đợi: $out" ;; esac
expect "bản gọn: sổ ghi nguyên văn file, version sau dòng mới nhất" \
  "$(psql_in compact -c "SELECT md5(statements[1]) || ':' || (version > '20261113130104') || ':' || (version ~ '^[0-9]{14}\$') FROM supabase_migrations.schema_migrations WHERE name = '$NAME'")" "$FILE_MD5:true:true"
expect "bản gọn: thân hàm và quyền giống hệt bản dán đầy đủ" "$(
  a=$(psql_in compact -c "SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.proname LIKE '%renewal_link_ticket%'")
  b=$(psql_in paste -c "SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.proname LIKE '%renewal_link_ticket%'")
  [ -n "$a" ] && [ "$a" = "$b" ] && echo same || echo differ)" "same"
expect "bản gọn: bảng vé bật RLS, không role nào có quyền" "$(psql_in compact -c "SELECT relrowsecurity || ':' || (SELECT count(*) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','aka_agent_desktop','aka_agent_chat_api') AND has_table_privilege(r.rolname, 'private.aka_renewal_link_tickets', 'SELECT, INSERT, UPDATE, DELETE')) FROM pg_class WHERE oid = 'private.aka_renewal_link_tickets'::regclass")" "true:0"
expect "bản gọn: API xin vé rồi cổng đổi vé đúng một lần" "$(psql_in compact -c "SET ROLE service_role; WITH t AS (SELECT public.aka_agent_control_renewal_link_ticket(7, 9, 501) ->> 'token' AS token) SELECT (public.aka_renewal_link_ticket_redeem(token) ->> 'ok') || ':' || (public.aka_renewal_link_ticket_redeem(token) ->> 'reason') FROM t")" "true:used"
fp=$(fingerprint compact)
if out=$(psql_in compact -f "$PASTE" 2>&1); then fail "dán bản gọn lần hai không bị từ chối"; fi
case "$out" in *"V521 đã chạy rồi, không chạy lại"*) ok "bản gọn: dán lần hai bị từ chối" ;; *) fail "thông báo khác: $out" ;; esac
psql_in compact -c "DELETE FROM private.aka_renewal_link_tickets" >/dev/null; fp=$(fingerprint compact)
psql_in compact -f "$PASTE" >/dev/null 2>&1 || true
expect "bản gọn: dán lần hai không đổi gì" "$(fingerprint compact)" "$fp"

# chép thiếu/sai một ký tự: dừng trước khi chạy gì
fixture broken
sed '0,/Vì sao:/s//Vi sao:/' "$PASTE" > "$WORK/broken.sql"; chmod 644 "$WORK/broken.sql"
if out=$(psql_in broken -f "$WORK/broken.sql" 2>&1); then fail "bản gọn sai một ký tự vẫn chạy"; fi
case "$out" in *"Nội dung dán bị thiếu hoặc sai"*) ok "bản gọn sai một ký tự: bị từ chối" ;; *) fail "thông báo khác: $out" ;; esac
expect "bản gọn sai một ký tự: chưa tạo gì, chưa ghi sổ" "$(psql_in broken -c "SELECT (to_regclass('private.aka_renewal_link_tickets') IS NULL) || ':' || (SELECT count(*) FROM supabase_migrations.schema_migrations) || ':' || (SELECT count(*) FROM pg_proc WHERE proname LIKE '%renewal_link_ticket%')")" "true:0:0"

# xuống dòng kiểu Windows (trình soạn thảo đổi \n thành \r\n): vẫn chạy, sổ vẫn ghi nguyên văn file
fixture crlf
sed 's/$/\r/' "$PASTE" > "$WORK/crlf.sql"; chmod 644 "$WORK/crlf.sql"
out=$(psql_in crlf -f "$WORK/crlf.sql" 2>&1 | tr -d '\r') || fail "bản gọn CRLF lỗi: $out"
case "$out" in applied\|*"|$NAME|t") ok "bản gọn xuống dòng kiểu Windows: applied, md5 sổ = file" ;; *) fail "kết quả CRLF khác mong đợi: $out" ;; esac

echo "PASS $pass"
