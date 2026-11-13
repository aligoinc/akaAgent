#!/usr/bin/env bash
# Thử V518 (hàm đọc dữ liệu nhắc gia hạn cho Desktop + dòng cài đặt renewal.reminder) trên PostgreSQL 16 cục bộ,
# không chạm production. Fixture chỉ dựng các cột mà hàm đọc và một bản thay của private.aka_agent_desktop_data_context()
# (lấy nhân viên từ biến phiên test.staff_id khi role là aka_agent_desktop).
# Kiểm: apply, quyền gọi, ngày đăng nhập (đúng nhân viên, trong 60 ngày, gộp presence + phiên Web), ưu đãi gia hạn sớm
# trước và sau khi có cột aka_promotion.min_days_before_expiry, ngoài phiên Desktop trả rỗng, apply lại bị từ chối, rollback.
# Dùng: bash scripts/test-v518-renewal-reminder-state.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v518_renewal_reminder_state.sql"
ROLLBACK="$ROOT/migrations/rollback_v518_renewal_reminder_state.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v518.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
psql_db() { as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d fixture -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db -c "$1"; }
# Gọi hàm trong phiên Desktop của một nhân viên.
desktop() { psql_db -c "SET test.staff_id = '$1'; SET ROLE aka_agent_desktop; SELECT $2"; }
run_file() { psql_db -f "$1" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }

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

CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint);
CREATE TABLE public.auto_staff_device_presence (instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id bigint,
  organization_id bigint, started_at timestamptz, last_seen_at timestamptz, ended_at timestamptz);
CREATE INDEX auto_staff_device_presence_history_idx ON public.auto_staff_device_presence (staff_id, started_at DESC);
CREATE TABLE public.auto_control_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id bigint, organization_id bigint,
  created_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz);
CREATE TABLE public.org_organization_product (id bigint PRIMARY KEY, organization_id bigint, product_id bigint,
  product_package_id bigint, package_type text, expiration_date timestamptz, is_deleted boolean DEFAULT false);
CREATE TABLE public.aka_promotion (id bigserial PRIMARY KEY, name text, org_product_id bigint, org_product_package_id bigint,
  purchase_scope text, discount_type text, discount_value numeric, bonus_days integer NOT NULL DEFAULT 0,
  starts_at timestamptz, ends_at timestamptz, is_active boolean NOT NULL DEFAULT true, code text);
CREATE TABLE public.auto_system_settings (id bigserial PRIMARY KEY, key text UNIQUE, value text, description text,
  is_secret boolean DEFAULT false, is_active boolean DEFAULT true);
-- Bảng presence chỉ service_role đọc được như production: Desktop không có quyền đọc trực tiếp.
REVOKE ALL ON public.auto_staff_device_presence FROM PUBLIC, aka_agent_desktop;

-- Bản thay của hàm ngữ cảnh phiên Desktop (production: V436, đọc nhân viên từ JWT).
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

INSERT INTO public.org_staff VALUES (7, 9), (8, 9), (20, 30);
-- Nhân viên 7: mở Desktop 3 phiên (một phiên kéo dài qua 2 ngày), đăng nhập Web 1 lần, 1 phiên quá 60 ngày, 1 phiên của người khác.
INSERT INTO public.auto_staff_device_presence (staff_id, organization_id, started_at, last_seen_at) VALUES
  (7, 9, now() - interval '20 days', now() - interval '20 days' + interval '1 hour'),
  (7, 9, now() - interval '10 days', now() - interval '9 days'),
  (7, 9, now() - interval '5 minutes', now()),
  (7, 9, now() - interval '90 days', now() - interval '89 days'),
  (8, 9, now() - interval '3 days', now() - interval '3 days');
INSERT INTO public.auto_control_sessions (staff_id, organization_id, created_at) VALUES
  (7, 9, now() - interval '30 days'), (7, 9, now() - interval '70 days'), (20, 30, now() - interval '2 days');
-- Sản phẩm tổ chức 9: gói trả phí còn hạn (id 501, gói 62), bản dùng thử (502), gói đã hết hạn (503), gói đã xoá (504);
-- tổ chức 30: gói trả phí cùng loại (601).
INSERT INTO public.org_organization_product VALUES
  (501, 9, 16, 62, '2month', now() + interval '12 days', false),
  (502, 9, 3, 11, 'demo', now() + interval '2 days', false),
  (503, 9, 17, 70, 'year', now() - interval '3 days', false),
  (504, 9, 16, 62, '2month', now() + interval '40 days', true),
  (601, 30, 16, 62, '2month', now() + interval '20 days', false);
SQL

days_ago() { q "SELECT to_char((timezone('Asia/Ho_Chi_Minh', now() - interval '$1'))::date, 'YYYY-MM-DD')"; }

# --- apply ---
run_file "$MIGRATION" >/dev/null || fail "apply V518"
ok "apply V518"
q "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261113000000', 'migration_v518_renewal_reminder_state', ARRAY['x'])"

expect "hàm là SECURITY DEFINER, STABLE" "$(q "SELECT prosecdef::text || ',' || provolatile::text FROM pg_proc WHERE oid = 'public.aka_agent_renewal_reminder_state()'::regprocedure")" "true,s"
expect "aka_agent_desktop gọi được" "$(q "SELECT has_function_privilege('aka_agent_desktop', 'public.aka_agent_renewal_reminder_state()', 'EXECUTE')")" "t"
expect "service_role, anon, authenticated, chat_api không gọi được" \
  "$(q "SELECT string_agg(has_function_privilege(r, 'public.aka_agent_renewal_reminder_state()', 'EXECUTE')::text, ',' ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role','aka_agent_chat_api']) r")" "false,false,false,false"
refuse "service_role gọi bị từ chối" "permission denied" psql_db -c "SET ROLE service_role; SELECT public.aka_agent_renewal_reminder_state()"
expect "dòng cài đặt renewal.reminder: chỉ admin akaBiz" "$(q "SELECT value || '|' || is_active || '|' || is_secret FROM auto_system_settings WHERE key = 'renewal.reminder'")" '{"audience":"admin_akabiz"}|true|false'

# --- ngày giờ máy chủ ---
expect "today là ngày Việt Nam" "$(desktop 7 "public.aka_agent_renewal_reminder_state()->>'today'")" "$(days_ago '0 days')"
expect "serverTime đọc được thành thời điểm gần hiện tại" "$(desktop 7 "abs(extract(epoch FROM ((public.aka_agent_renewal_reminder_state()->>'serverTime')::timestamptz - now()))) < 5")" "t"

# --- ngày đăng nhập ---
expected_days=$(q "SELECT jsonb_agg(d ORDER BY d)::text FROM (SELECT DISTINCT d FROM unnest(ARRAY['$(days_ago '30 days')','$(days_ago '20 days')','$(days_ago '19 days 23 hours')','$(days_ago '10 days')','$(days_ago '9 days')','$(days_ago '5 minutes')','$(days_ago '0 days')']) d) x")
expect "ngày đăng nhập của nhân viên 7: presence (bắt đầu + lần cuối) và phiên Web, trong 60 ngày, không trùng" \
  "$(desktop 7 "(public.aka_agent_renewal_reminder_state()->'loginDays')::text")" "$expected_days"
expect "không lẫn ngày của nhân viên khác" "$(desktop 8 "(public.aka_agent_renewal_reminder_state()->'loginDays')::text")" "[\"$(days_ago '3 days')\"]"
expect "nhân viên tổ chức khác chỉ thấy ngày của mình" "$(desktop 20 "(public.aka_agent_renewal_reminder_state()->'loginDays')::text")" "[\"$(days_ago '2 days')\"]"
expect "Desktop không đọc trực tiếp được bảng presence" "$(q "SELECT has_table_privilege('aka_agent_desktop', 'public.auto_staff_device_presence', 'SELECT')")" "f"

# --- ngoài phiên Desktop ---
expect "nhân viên không tồn tại: hai mảng rỗng" "$(desktop 999 "(public.aka_agent_renewal_reminder_state() - 'serverTime' - 'today')::text")" '{"offers": [], "loginDays": []}'
expect "role khác (postgres): hai mảng rỗng" "$(q "SELECT (public.aka_agent_renewal_reminder_state() - 'serverTime' - 'today')::text")" '{"offers": [], "loginDays": []}'

# --- ưu đãi gia hạn sớm: chưa có cột của CRM ---
q "INSERT INTO aka_promotion (name, org_product_package_id, purchase_scope, bonus_days) VALUES ('Sớm theo gói', 62, 'renewal', 7)"
expect "chưa có cột min_days_before_expiry: offers rỗng, không lỗi" "$(desktop 7 "(public.aka_agent_renewal_reminder_state()->'offers')::text")" "[]"

# --- có cột ---
q "ALTER TABLE aka_promotion ADD COLUMN min_days_before_expiry integer"
q "UPDATE aka_promotion SET min_days_before_expiry = 7 WHERE name = 'Sớm theo gói'"
expect "ưu đãi theo đúng gói đang dùng" "$(desktop 7 "(public.aka_agent_renewal_reminder_state()->'offers')::text")" \
  '[{"bonusDays": 7, "discountType": null, "discountValue": null, "minDaysBeforeExpiry": 7, "organizationProductId": 501}]'
expect "tổ chức khác cùng gói nhận ưu đãi cho dòng của mình" "$(desktop 20 "(public.aka_agent_renewal_reminder_state()->'offers'->0->>'organizationProductId')")" "601"
q "INSERT INTO aka_promotion (name, org_product_id, purchase_scope, discount_type, discount_value, min_days_before_expiry) VALUES
  ('Sớm theo sản phẩm', 16, 'both', 'percent', 10, 3),
  ('Mua mới', 16, 'new', 'percent', 50, 3),
  ('Có mã', 16, 'renewal', 'percent', 30, 3),
  ('Đã tắt', 16, 'renewal', 'percent', 30, 3),
  ('Hết hạn chương trình', 16, 'renewal', 'percent', 30, 3),
  ('Chưa bắt đầu', 16, 'renewal', 'percent', 30, 3),
  ('Không điều kiện', 16, 'renewal', 'percent', 5, NULL),
  ('Cho dùng thử Facebook', 3, 'both', 'percent', 20, 1),
  ('Cho gói đã hết hạn', 17, 'renewal', 'percent', 20, 1)"
q "UPDATE aka_promotion SET code = 'SOM30' WHERE name = 'Có mã'"
q "UPDATE aka_promotion SET is_active = false WHERE name = 'Đã tắt'"
q "UPDATE aka_promotion SET ends_at = now() - interval '1 day' WHERE name = 'Hết hạn chương trình'"
q "UPDATE aka_promotion SET starts_at = now() + interval '1 day' WHERE name = 'Chưa bắt đầu'"
expect "chỉ nhận chương trình gia hạn sớm đang chạy, không mã, đúng gói/sản phẩm, gói trả phí còn hạn" \
  "$(desktop 7 "(SELECT string_agg((o->>'organizationProductId') || ':' || (o->>'minDaysBeforeExpiry') || ':' || COALESCE(o->>'discountType', 'bonus') || ':' || COALESCE(o->>'discountValue', o->>'bonusDays'), ',' ORDER BY (o->>'minDaysBeforeExpiry')::int) FROM jsonb_array_elements(public.aka_agent_renewal_reminder_state()->'offers') o)")" \
  "501:3:percent:10,501:7:bonus:7"

# --- apply lại bị từ chối ---
refuse "apply lại bị từ chối" "V518 đã có trong sổ migration" run_file "$MIGRATION"

# --- rollback ---
run_file "$ROLLBACK" >/dev/null || fail "rollback V518"
ok "rollback V518"
expect "sau rollback: hàm không còn" "$(q "SELECT to_regprocedure('public.aka_agent_renewal_reminder_state()') IS NULL")" "t"
expect "sau rollback: dòng cài đặt tắt, không bị xoá" "$(q "SELECT count(*) || '|' || bool_or(is_active) FROM auto_system_settings WHERE key = 'renewal.reminder'")" "1|false"

echo "V518: $pass khẳng định đạt"
