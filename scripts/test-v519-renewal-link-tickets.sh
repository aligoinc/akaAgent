#!/usr/bin/env bash
# Thử V519 (vé gia hạn dùng một lần) trên PostgreSQL 16 cục bộ, không chạm production. Fixture chỉ dựng các cột mà các hàm
# đọc và một bản thay của private.aka_agent_desktop_data_context() (lấy nhân viên từ biến phiên test.staff_id khi role là
# aka_agent_desktop).
# Kiểm: apply, quyền gọi từng hàm, Desktop xin vé theo phiên, API Web xin vé, cổng đổi vé đúng một lần, vé hết hạn/đã dùng/
# sai mã, không lưu mã vé dạng đọc được, giới hạn tần suất, tự dọn vé cũ, apply lại bị từ chối, rollback.
# Dùng: bash scripts/test-v519-renewal-link-tickets.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v519_renewal_link_tickets.sql"
ROLLBACK="$ROOT/migrations/rollback_v519_renewal_link_tickets.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v519.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
psql_db() { as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d fixture -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db -c "$1"; }
desktop() { psql_db -c "SET test.staff_id = '$1'; SET ROLE aka_agent_desktop; SELECT $2"; }
as_role() { psql_db -c "SET ROLE $1; SELECT $2"; }
run_file() { psql_db -f "$1" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }
field() { q "SELECT ('$1'::jsonb) ->> '$2'"; }

as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN;
CREATE DATABASE fixture;
SQL
psql_db >/dev/null <<'SQL'
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.org_organization_product (id bigint PRIMARY KEY, organization_id bigint, is_deleted boolean DEFAULT false);
CREATE FUNCTION private.aka_agent_desktop_data_context()
RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public
AS $f$
  SELECT s.id, s.organization_id, false
    FROM public.org_staff s
   WHERE current_setting('role', true) = 'aka_agent_desktop'
     AND s.id = NULLIF(current_setting('test.staff_id', true), '')::bigint;
$f$;
GRANT EXECUTE ON FUNCTION private.aka_agent_desktop_data_context() TO aka_agent_desktop;
INSERT INTO public.org_staff VALUES (7, 9, true), (8, 9, false), (20, 30, true), (21, 30, true);
INSERT INTO public.org_organization_product VALUES (501, 9, false), (504, 9, true), (601, 30, false);
SQL

# --- apply ---
run_file "$MIGRATION" >/dev/null || fail "apply V519"
ok "apply V519"
q "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261113000001', 'migration_v519_renewal_link_tickets', ARRAY['x'])"

# --- quyền ---
priv() { q "SELECT has_function_privilege('$1', '$2', 'EXECUTE')"; }
expect "Desktop gọi được hàm xin vé" "$(priv aka_agent_desktop 'public.aka_agent_renewal_link_ticket(bigint)')" "t"
expect "service_role không gọi hàm xin vé của Desktop" "$(priv service_role 'public.aka_agent_renewal_link_ticket(bigint)')" "f"
expect "service_role gọi được hàm xin vé của API" "$(priv service_role 'public.aka_agent_control_renewal_link_ticket(bigint,bigint,bigint)')" "t"
expect "Desktop không gọi được hàm xin vé của API" "$(priv aka_agent_desktop 'public.aka_agent_control_renewal_link_ticket(bigint,bigint,bigint)')" "f"
expect "service_role gọi được hàm đổi vé" "$(priv service_role 'public.aka_renewal_link_ticket_redeem(text)')" "t"
expect "Desktop không đổi được vé" "$(priv aka_agent_desktop 'public.aka_renewal_link_ticket_redeem(text)')" "f"
expect "anon không gọi được hàm nào" "$(q "SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::text FROM pg_proc p WHERE p.proname LIKE '%renewal_link_ticket%'")" "false"
expect "không role ứng dụng nào gọi được lõi cấp vé" "$(q "SELECT bool_or(has_function_privilege(r.rolname, 'private.aka_renewal_link_ticket_issue(bigint,bigint,bigint,text)', 'EXECUTE'))::text FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','aka_agent_desktop','aka_agent_chat_api')")" "false"
expect "không role ứng dụng nào đọc/ghi được bảng vé" "$(q "SELECT bool_or(has_table_privilege(r.rolname, 'private.aka_renewal_link_tickets', 'SELECT, INSERT, UPDATE, DELETE'))::text FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','aka_agent_desktop','aka_agent_chat_api')")" "false"
refuse "Desktop đọc thẳng bảng vé bị từ chối" "permission denied" as_role aka_agent_desktop "count(*) FROM private.aka_renewal_link_tickets"

# --- Desktop xin vé ---
T1=$(desktop 7 "public.aka_agent_renewal_link_ticket(501)")
expect "Desktop: cấp vé" "$(field "$T1" ok)" "true"
TOKEN1=$(field "$T1" token)
[[ "$TOKEN1" =~ ^[0-9a-f]{64}$ ]] && ok "mã vé là 64 ký tự hex" || fail "mã vé sai dạng: $TOKEN1"
expect "vé gắn đúng nhân viên, tổ chức, sản phẩm, nơi xin" "$(q "SELECT staff_id || ',' || organization_id || ',' || organization_product_id || ',' || client FROM private.aka_renewal_link_tickets")" "7,9,501,desktop"
expect "bảng chỉ lưu SHA-256, không lưu mã vé" "$(q "SELECT (token_hash = sha256(convert_to('$TOKEN1','UTF8')))::text || ',' || (position('$TOKEN1' in encode(token_hash,'hex')) = 0)::text FROM private.aka_renewal_link_tickets")" "true,true"
expect "vé sống 10 phút" "$(q "SELECT (expires_at - created_at)::text FROM private.aka_renewal_link_tickets")" "00:10:00"
T2=$(desktop 7 "public.aka_agent_renewal_link_ticket(601)")
expect "sản phẩm của tổ chức khác: vẫn cấp vé nhưng bỏ gợi ý sản phẩm" "$(field "$T2" ok),$(q "SELECT count(*) FROM private.aka_renewal_link_tickets WHERE organization_product_id IS NULL")" "true,1"
T3=$(desktop 7 "public.aka_agent_renewal_link_ticket(504)")
expect "sản phẩm đã xoá: bỏ gợi ý sản phẩm" "$(field "$T3" ok),$(q "SELECT count(*) FROM private.aka_renewal_link_tickets WHERE organization_product_id IS NULL")" "true,2"
expect "ngoài phiên Desktop (không ánh xạ được nhân viên): không cấp vé" "$(field "$(desktop 999 "public.aka_agent_renewal_link_ticket(501)")" reason)" "no_session"
expect "nhân viên đã bị khoá: không cấp vé" "$(field "$(desktop 8 "public.aka_agent_renewal_link_ticket(501)")" reason)" "staff_inactive"

# --- cổng CRM đổi vé ---
R1=$(as_role service_role "public.aka_renewal_link_ticket_redeem('$TOKEN1')")
expect "đổi vé: trả nhân viên, tổ chức, sản phẩm, nơi xin" "$(field "$R1" ok),$(field "$R1" staffId),$(field "$R1" organizationId),$(field "$R1" organizationProductId),$(field "$R1" client)" "true,7,9,501,desktop"
expect "đổi lần hai: từ chối (đã dùng)" "$(field "$(as_role service_role "public.aka_renewal_link_ticket_redeem('$TOKEN1')")" reason)" "used"
expect "mã không có trong bảng" "$(field "$(as_role service_role "public.aka_renewal_link_ticket_redeem('$(printf 'a%.0s' {1..64})')")" reason)" "not_found"
expect "mã sai dạng (JWT, chữ hoa, rỗng)" "$(field "$(as_role service_role "public.aka_renewal_link_ticket_redeem('eyJhbGciOi.x.y')")" reason),$(field "$(as_role service_role "public.aka_renewal_link_ticket_redeem(upper('$TOKEN1'))")" reason),$(field "$(as_role service_role "public.aka_renewal_link_ticket_redeem(NULL)")" reason)" "invalid,invalid,invalid"
TOKEN2=$(field "$T2" token)
q "UPDATE private.aka_renewal_link_tickets SET expires_at = now() - interval '1 second' WHERE token_hash = sha256(convert_to('$TOKEN2','UTF8'))"
expect "vé quá 10 phút: từ chối (hết hạn), không bị đánh dấu đã dùng" "$(field "$(as_role service_role "public.aka_renewal_link_ticket_redeem('$TOKEN2')")" reason),$(q "SELECT (used_at IS NULL)::text FROM private.aka_renewal_link_tickets WHERE token_hash = sha256(convert_to('$TOKEN2','UTF8'))")" "expired,true"
refuse "Desktop gọi hàm đổi vé bị từ chối" "permission denied" desktop 7 "public.aka_renewal_link_ticket_redeem('$TOKEN1')"
refuse "anon gọi hàm xin vé bị từ chối" "permission denied" as_role anon "public.aka_agent_renewal_link_ticket(501)"

# --- hai lượt đổi cùng lúc: chỉ một lượt thắng ---
T4=$(desktop 7 "public.aka_agent_renewal_link_ticket(501)"); TOKEN4=$(field "$T4" token)
for i in 1 2 3 4 5 6; do as_role service_role "public.aka_renewal_link_ticket_redeem('$TOKEN4') ->> 'ok'" > "$WORK/race.$i" & done; wait
expect "6 lượt đổi cùng lúc: đúng 1 lượt thành công" "$(cat "$WORK"/race.* | grep -c '^true$')" "1"

# --- API Web xin vé ---
W1=$(as_role service_role "public.aka_agent_control_renewal_link_ticket(20, 30, 601)")
expect "API Web: cấp vé cho nhân viên của phiên Web" "$(field "$W1" ok),$(q "SELECT client || ',' || organization_product_id FROM private.aka_renewal_link_tickets WHERE staff_id = 20")" "true,web,601"
expect "API Web: nhân viên không thuộc tổ chức gửi lên" "$(field "$(as_role service_role "public.aka_agent_control_renewal_link_ticket(20, 9, 501)")" reason)" "staff_inactive"
expect "API Web: thiếu nhân viên" "$(field "$(as_role service_role "public.aka_agent_control_renewal_link_ticket(NULL, 30, NULL)")" reason)" "no_session"

# --- giới hạn tần suất: 12 vé / 10 phút / nhân viên ---
q "DELETE FROM private.aka_renewal_link_tickets WHERE staff_id = 21"
for i in $(seq 1 12); do as_role service_role "public.aka_agent_control_renewal_link_ticket(21, 30, NULL) ->> 'ok'" >/dev/null; done
expect "vé thứ 13 trong 10 phút bị từ chối" "$(field "$(as_role service_role "public.aka_agent_control_renewal_link_ticket(21, 30, NULL)")" reason),$(q "SELECT count(*) FROM private.aka_renewal_link_tickets WHERE staff_id = 21")" "rate_limited,12"
expect "giới hạn tính riêng từng nhân viên" "$(field "$(as_role service_role "public.aka_agent_control_renewal_link_ticket(20, 30, NULL)")" ok)" "true"

# --- tự dọn vé cũ khi xin vé mới ---
q "UPDATE private.aka_renewal_link_tickets SET created_at = now() - interval '2 days', expires_at = now() - interval '2 days' + interval '10 minutes' WHERE staff_id = 21"
q "INSERT INTO private.aka_renewal_link_tickets (token_hash, staff_id, organization_id, client, created_at, expires_at) VALUES
     (sha256('old-other'), 7, 9, 'desktop', now() - interval '9 days', now() - interval '9 days' + interval '10 minutes'),
     (sha256('recent-other'), 7, 9, 'desktop', now() - interval '3 days', now() - interval '3 days' + interval '10 minutes')"
as_role service_role "public.aka_agent_control_renewal_link_ticket(21, 30, NULL) ->> 'ok'" >/dev/null
expect "vé quá 1 ngày của chính nhân viên được dọn" "$(q "SELECT count(*) FROM private.aka_renewal_link_tickets WHERE staff_id = 21")" "1"
expect "vé quá 7 ngày của người khác được dọn, vé 3 ngày thì chưa" "$(q "SELECT (SELECT count(*) FROM private.aka_renewal_link_tickets WHERE token_hash = sha256('old-other')) || ',' || (SELECT count(*) FROM private.aka_renewal_link_tickets WHERE token_hash = sha256('recent-other'))")" "0,1"

refuse "nơi xin vé lạ bị từ chối" "renewal_link_invalid_client" q "SELECT private.aka_renewal_link_ticket_issue(7, 9, NULL, 'ios')"

# --- apply lại / rollback ---
refuse "apply lại V519 bị từ chối" "đã có trong sổ migration" run_file "$MIGRATION"
run_file "$ROLLBACK" >/dev/null || fail "rollback V519"
ok "rollback V519"
expect "sau rollback: bảng và hàm không còn" "$(q "SELECT (to_regclass('private.aka_renewal_link_tickets') IS NULL)::text || ',' || (SELECT count(*) FROM pg_proc WHERE proname LIKE '%renewal_link_ticket%')")" "true,0"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v519_%'"
run_file "$MIGRATION" >/dev/null || fail "apply lại sau rollback"
ok "apply lại sau rollback"
echo "V519: $pass khẳng định đạt"
