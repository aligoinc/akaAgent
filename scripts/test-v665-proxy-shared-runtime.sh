#!/usr/bin/env bash
# Thử V665 (cổng gắn proxy đồng nghiệp cho tài khoản Desktop xét máy đang gắn với tài khoản, máy khác đang mở và máy khác mở bản cũ trong
# 7 ngày) trên PostgreSQL 17 cục bộ, không chạm
# production. Fixture dựng các bảng như akachat ngày 26/11/2026 (cột auto_staff_device_presence, org_staff.aka_agent_device_fingerprint_hash,
# auto_system_settings) và nạp NGUYÊN VĂN hai hàm đang chạy production (pg_get_functiondef đọc 26/11:
# scripts/fixtures/proxy-shared-runtime-v665/live-20261126.sql, live-guard-20261126.sql) cùng trigger trg_account_proxy_scope_guard.
# Kiểm: md5 fixture = production; preflight từ chối khi thân hàm khác / số đã dùng; apply; chạy lại bị từ chối; quyền hàm giữ nguyên;
# bảng kết quả trước / sau cho từng kiểu nhân viên; các biến thể thiết lập; trigger thật trên auto_accounts; gỡ từ chối khi chưa có
# trong sổ / thân hàm không phải V665; gỡ trả đúng md5 production; apply lại sau khi gỡ; thời gian chạy với 2.000 phiên một nhân viên.
# Dùng: bash scripts/test-v665-proxy-shared-runtime.sh   (PGBIN mặc định postgresql@17 của Homebrew hoặc /usr/lib/postgresql/17/bin)
set -euo pipefail
export LC_ALL=C
if [ -z "${PGBIN:-}" ]; then
  if [ -x /opt/homebrew/opt/postgresql@17/bin/initdb ]; then PGBIN=/opt/homebrew/opt/postgresql@17/bin; else PGBIN=/usr/lib/postgresql/17/bin; fi
fi
ROOT=$(cd "$(dirname "$0")/.." && pwd)
UP=migration_v665_proxy_shared_runtime_bound_device.sql
DOWN=rollback_v665_proxy_shared_runtime_bound_device.sql
NAME=migration_v665_proxy_shared_runtime_bound_device
FIX="$ROOT/scripts/fixtures/proxy-shared-runtime-v665"
OLD_MD5=5c25d073f3a9ee1859dccf6cc4f45fff
GUARD_MD5=f627625f6081c390328be43d27bec454
node "$ROOT/scripts/build-v665-sql.cjs" >/dev/null
NEW_MD5=$(node -e "
const fs=require('fs'),c=require('crypto');const s=fs.readFileSync(process.argv[1],'utf8');
const m=s.match(/\n(CREATE OR REPLACE FUNCTION private\.aka_agent_proxy_shared_runtime_ready[\s\S]*?\n\\\$function\\\$);\n/);
process.stdout.write(c.createHash('md5').update(m[1]+'\n').digest('hex'))" "$ROOT/migrations/$UP")
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v665.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cp "$ROOT/migrations/$UP" "$ROOT/migrations/$DOWN" "$FIX/live-20261126.sql" "$FIX/live-guard-20261126.sql" "$WORK/" && chmod 644 "$WORK"/*.sql
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
DB=v665
psql_db() { local db=$1; shift; as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d "$db" -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db "$DB" -c "$1"; }
run_file() { psql_db "$DB" -f "$WORK/$1" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối: $out)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }
fn_md5() { q "SELECT md5(pg_get_functiondef('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)'::regprocedure))"; }
fn_acl() { q "SELECT COALESCE(proacl::text,'') FROM pg_proc WHERE oid='private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)'::regprocedure"; }
ledger_add() { python3 - "$WORK/$UP" "$NAME" > "$WORK/ledger.sql" <<'PY'
import sys
body = open(sys.argv[1], encoding='utf-8').read()
assert '$v665file$' not in body
print("INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES "
      "(to_char(clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MISS'), '%s', ARRAY[$v665file$%s$v665file$]);" % (sys.argv[2], body))
PY
  psql_db "$DB" -f "$WORK/ledger.sql" >/dev/null; }

psql_db postgres <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN BYPASSRLS;
CREATE DATABASE v665;
SQL
psql_db "$DB" >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
INSERT INTO supabase_migrations.schema_migrations VALUES
  ('20261112151259','migration_v511_web_proxy_management_p1',NULL),('20261112152033','migration_v511_web_proxy_management_p2',NULL),
  ('20261112152346','migration_v511_web_proxy_management_p3',NULL);

-- Cột như akachat 26/11/2026.
CREATE TABLE public.auto_system_settings (
  id bigserial PRIMARY KEY, key text NOT NULL UNIQUE, value text, description text,
  is_secret boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.auto_system_settings(key, value) VALUES ('proxies.shared_runtime', '{"server":true,"desktopMinVersion":"9.6.0"}');
CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text);
INSERT INTO public.org_organization VALUES (1, 'Tổ chức 1');
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL, name text, aka_agent_device_fingerprint_hash text);
CREATE TABLE public.auto_staff_device_presence (
  instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id bigint NOT NULL, organization_id bigint NOT NULL,
  device_fingerprint_hash text NOT NULL, device_label text, device_platform text, app_version text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz, runtime_state jsonb, runtime_state_at timestamptz);
CREATE INDEX auto_staff_device_presence_online_idx ON public.auto_staff_device_presence USING btree (staff_id, last_seen_at DESC) WHERE (ended_at IS NULL);
CREATE INDEX auto_staff_device_presence_history_idx ON public.auto_staff_device_presence USING btree (staff_id, started_at DESC);
CREATE TABLE public.auto_proxies (
  id bigserial PRIMARY KEY, name text NOT NULL, staff_id bigint NOT NULL REFERENCES public.org_staff(id), organization_id bigint,
  is_active boolean NOT NULL DEFAULT true, is_delete boolean NOT NULL DEFAULT false);
CREATE TABLE public.auto_accounts (
  id bigserial PRIMARY KEY, staff_id bigint, organization_id bigint, proxy_id bigint REFERENCES public.auto_proxies(id),
  flatform_type text, is_zalo_server boolean, is_zalo_show_web boolean, is_delete boolean DEFAULT false);
SQL
psql_db "$DB" -f "$WORK/live-20261126.sql" >/dev/null
psql_db "$DB" -f "$WORK/live-guard-20261126.sql" >/dev/null
psql_db "$DB" >/dev/null <<'SQL'
CREATE TRIGGER trg_account_proxy_scope_guard BEFORE INSERT OR UPDATE OF proxy_id, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, is_delete ON public.auto_accounts FOR EACH ROW EXECUTE FUNCTION private.aka_agent_guard_account_proxy_scope();
REVOKE ALL ON FUNCTION private.aka_agent_proxy_shared_runtime_ready(bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_guard_account_proxy_scope() FROM PUBLIC;

-- Nhân viên (tổ chức 1) và phiên app. p(staff, máy, bản, cách đây, đã kết thúc).
CREATE FUNCTION pg_temp.p(s bigint, fp text, v text, ago interval, ended boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auto_staff_device_presence(staff_id, organization_id, device_fingerprint_hash, app_version, started_at, last_seen_at, ended_at)
  VALUES (s, 1, fp, v, now() - ago - interval '1 hour', now() - ago, CASE WHEN ended THEN now() - ago END) $$;
INSERT INTO public.org_staff(id, organization_id, name, aka_agent_device_fingerprint_hash) VALUES
  (900, 1, 'Chủ proxy', 'fp900'),
  (101, 1, 'A máy gắn đã cập nhật, còn dòng cũ của chính máy', 'fpA'),
  (102, 1, 'B dòng cũ của mã máy trước', 'fpB3'),
  (103, 1, 'C máy gắn phiên mới nhất bản cũ', 'fpC'),
  (104, 1, 'D chưa gắn máy', NULL),
  (105, 1, 'D2 mã máy trống', '   '),
  (106, 1, 'E máy gắn chưa có phiên', 'fpE'),
  (107, 1, 'F máy khác đang mở bản cũ', 'fpF'),
  (108, 1, 'G máy khác bản cũ đã đóng', 'fpG'),
  (109, 1, 'H máy khác bản cũ chưa đóng, 2 ngày không thấy', 'fpH'),
  (110, 1, 'I máy khác đang mở bản mới', 'fpI'),
  (111, 1, 'J phiên mới nhất không có bản', 'fpJ'),
  (112, 1, 'J2 phiên mới nhất bản sai dạng', 'fpJ2'),
  (113, 1, 'K máy khác đang mở không có bản', 'fpK'),
  (114, 1, 'L 9.10.0', 'fpL'),
  (115, 1, 'L2 10.0.0', 'fpL2'),
  (116, 1, 'M đúng 9.6.0', 'fpM'),
  (117, 1, 'M2 9.6', 'fpM2'),
  (118, 1, 'P mã máy trùng nhân viên khác', 'fpShared'),
  (119, 1, 'P2 chủ dòng fpShared', 'fpShared'),
  (120, 1, 'Q máy gắn 40 ngày không mở', 'fpQ'),
  (121, 1, 'R máy khác bản cũ chưa đóng, 23 giờ trước', 'fpR'),
  (122, 1, 'S máy khác bản cũ đã đóng, 2 ngày trước', 'fpS'),
  (123, 1, 'S2 máy khác bản cũ, 8 ngày trước', 'fpS2'),
  (124, 1, 'S3 máy khác đã cập nhật', 'fpS3');
SELECT pg_temp.p(900, 'fp900', '10.6.0', '1 hour', false);
SELECT pg_temp.p(101, 'fpA', '9.5.0', '10 days', true), pg_temp.p(101, 'fpA', '9.5.0', '5 days', false), pg_temp.p(101, 'fpA', '10.6.0', '1 hour', false);
SELECT pg_temp.p(102, 'fpB2', '9.5.0', '20 days', false), pg_temp.p(102, 'fpB3', '10.6.0', '2 hours', true);
SELECT pg_temp.p(103, 'fpC', '10.0.0', '3 days', true), pg_temp.p(103, 'fpC', '9.5.0', '1 hour', false);
SELECT pg_temp.p(104, 'fpD', '10.6.0', '1 hour', false);
SELECT pg_temp.p(105, 'fpD2', '10.6.0', '1 hour', false);
SELECT pg_temp.p(106, 'fpX', '10.6.0', '1 hour', false);
SELECT pg_temp.p(107, 'fpF', '10.6.0', '1 hour', false), pg_temp.p(107, 'fpF2', '9.5.0', '30 minutes', false);
SELECT pg_temp.p(108, 'fpG', '10.6.0', '1 hour', false), pg_temp.p(108, 'fpG2', '9.5.0', '1 hour', true);
SELECT pg_temp.p(109, 'fpH', '10.6.0', '1 hour', false), pg_temp.p(109, 'fpH2', '9.5.0', '2 days', false);
SELECT pg_temp.p(110, 'fpI', '10.6.0', '1 hour', false), pg_temp.p(110, 'fpI2', '10.7.0', '10 minutes', false);
SELECT pg_temp.p(111, 'fpJ', '10.6.0', '2 days', true), pg_temp.p(111, 'fpJ', NULL, '1 hour', false);
SELECT pg_temp.p(112, 'fpJ2', '10.6.0', '2 days', true), pg_temp.p(112, 'fpJ2', 'abc', '1 hour', false);
SELECT pg_temp.p(113, 'fpK', '10.6.0', '1 hour', false), pg_temp.p(113, 'fpK2', NULL, '10 minutes', false);
SELECT pg_temp.p(114, 'fpL', '9.10.0', '1 hour', false);
SELECT pg_temp.p(115, 'fpL2', '10.0.0', '1 hour', false);
SELECT pg_temp.p(116, 'fpM', '9.6.0', '1 hour', false);
SELECT pg_temp.p(117, 'fpM2', '9.6', '1 hour', false);
SELECT pg_temp.p(119, 'fpShared', '10.6.0', '1 hour', false);
SELECT pg_temp.p(120, 'fpQ', '10.6.0', '40 days', true);
SELECT pg_temp.p(121, 'fpR', '10.6.0', '1 hour', false), pg_temp.p(121, 'fpR2', '9.5.0', '23 hours', false);
SELECT pg_temp.p(122, 'fpS', '10.6.0', '1 hour', false), pg_temp.p(122, 'fpSx', '9.5.0', '2 days', true);
SELECT pg_temp.p(123, 'fpS2', '10.6.0', '1 hour', false), pg_temp.p(123, 'fpS2x', '9.5.0', '8 days', true);
SELECT pg_temp.p(124, 'fpS3', '10.6.0', '1 hour', false), pg_temp.p(124, 'fpS3x', '9.5.0', '3 days', true), pg_temp.p(124, 'fpS3x', '10.6.0', '2 days', true);
INSERT INTO public.auto_proxies(id, name, staff_id, organization_id) VALUES (1, 'proxy của 900', 900, 1), (2, 'proxy của 101', 101, 1);
SQL

ready_all() { q "SELECT string_agg(id || ':' || CASE WHEN private.aka_agent_proxy_shared_runtime_ready(id, false) THEN 't' ELSE 'f' END, ' ' ORDER BY id) FROM public.org_staff WHERE id BETWEEN 101 AND 124"; }
# Một tài khoản Desktop (Facebook) gắn proxy của nhân viên 900.
assign() { q "INSERT INTO public.auto_accounts(staff_id, organization_id, proxy_id, flatform_type, is_zalo_server, is_zalo_show_web) VALUES ($1, 1, ${2:-1}, '${3:-facebook}', ${4:-false}, false) RETURNING 'gắn'"; }

# ---------------------------------------------------------------------------------------------------- fixture = production
expect "hàm nạp từ fixture có md5 pg_get_functiondef như production" "$(fn_md5)" "$OLD_MD5"
expect "hàm trigger nạp từ fixture có md5 như production" "$(q "SELECT md5(pg_get_functiondef('private.aka_agent_guard_account_proxy_scope()'::regprocedure))")" "$GUARD_MD5"
ACL0=$(fn_acl)
expect "quyền hàm như production" "$ACL0" "{postgres=X/postgres}"
OLD_EXPECT="101:f 102:f 103:f 104:t 105:t 106:t 107:f 108:f 109:f 110:t 111:f 112:f 113:f 114:t 115:t 116:t 117:f 118:f 119:t 120:f 121:f 122:f 123:f 124:f"
NEW_EXPECT="101:t 102:t 103:f 104:f 105:f 106:f 107:f 108:f 109:f 110:t 111:f 112:f 113:f 114:t 115:t 116:t 117:f 118:f 119:t 120:t 121:f 122:f 123:t 124:t"
expect "bản V511 (production): chặn cả nhân viên đã cập nhật (A, B, G, H, Q)" "$(ready_all)" "$OLD_EXPECT"
refuse "bản V511: trigger chặn gắn proxy đồng nghiệp cho A" "proxy_shared_runtime_not_ready" assign 101
expect "bản V511: proxy của chính mình vẫn gắn được" "$(assign 101 2)" "gắn"
expect "bản V511: D (chưa gắn máy, mọi phiên bản mới) gắn được" "$(assign 104)" "gắn"

# ---------------------------------------------------------------------------------------------------- preflight
refuse "gỡ khi V665 chưa có trong sổ bị từ chối" "Gỡ V665: V665 chưa có trong sổ" run_file "$DOWN"
python3 - "$WORK/live-20261126.sql" "$WORK/variant.sql" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
open(sys.argv[2], 'w', encoding='utf-8').write(s.replace('DECLARE\n', '-- sửa tay\nDECLARE\n', 1).rstrip('\n') + ';\n')
PY
psql_db "$DB" -f "$WORK/variant.sql" >/dev/null
refuse "thân hàm khác production: V665 từ chối" "V665: hàm khác bản production 26/11" run_file "$UP"
psql_db "$DB" -f "$WORK/live-20261126.sql" >/dev/null
expect "trả lại thân production" "$(fn_md5)" "$OLD_MD5"
q "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261126000001','migration_v665_khac',NULL)"
refuse "số 665 đã dùng: V665 từ chối" "V665: số đã dùng cho migration khác" run_file "$UP"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name='migration_v665_khac'"
expect "các lần bị từ chối không đổi hàm" "$(fn_md5)" "$OLD_MD5"

# ---------------------------------------------------------------------------------------------------- apply
out=$(run_file "$UP") || fail "apply V665: $out"
ok "apply V665"
ledger_add
expect "md5 sổ = md5 file" "$(q "SELECT md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE name='$NAME'")" "$(python3 -c "import hashlib,sys;print(hashlib.md5(open(sys.argv[1],'rb').read()).hexdigest())" "$WORK/$UP")"
expect "md5 pg_get_functiondef = bản sinh (dạng PostgreSQL 17 khớp bộ sinh)" "$(fn_md5)" "$NEW_MD5"
expect "quyền hàm giữ nguyên" "$(fn_acl)" "$ACL0"
for r in anon authenticated aka_agent_desktop aka_agent_chat_api service_role; do
  expect "$r không chạy được hàm" "$(q "SELECT has_function_privilege('$r','private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)','EXECUTE')")" "f"
done
refuse "chạy lại V665 bị từ chối" "V665 đã có trong sổ migration, không chạy lại" run_file "$UP"
expect "bản V665: bảng kết quả từng kiểu nhân viên" "$(ready_all)" "$NEW_EXPECT"
expect "0 nhân viên chuyển từ true sang false ngoài D / D2 / E (chưa gắn máy hoặc máy gắn chưa có phiên)" \
  "$(python3 -c "
o=dict(x.split(':') for x in '$OLD_EXPECT'.split()); n=dict(x.split(':') for x in '$NEW_EXPECT'.split())
print(','.join(k for k in o if o[k]=='t' and n[k]=='f'))")" "104,105,106"

# ---------------------------------------------------------------------------------------------------- thiết lập
setting() { q "UPDATE public.auto_system_settings SET value='$1', is_active=${2:-true} WHERE key='proxies.shared_runtime'"; }
r101() { q "SELECT private.aka_agent_proxy_shared_runtime_ready(101, ${1:-false})"; }
setting '{"server":true,"desktopMinVersion":null}'; expect "desktopMinVersion null: false" "$(r101)" "f"
setting '{"server":true,"desktopMinVersion":"10.7.0"}'; expect "desktopMinVersion cao hơn máy gắn: false" "$(r101)" "f"
setting '{"server":true,"desktopMinVersion":"10.6.0"}'; expect "desktopMinVersion bằng máy gắn: true" "$(r101)" "t"
setting '{"server":true,"desktopMinVersion":"10.6"}'; expect "desktopMinVersion 10.6 với máy 10.6.0: true" "$(r101)" "t"
setting '{"server":true,"desktopMinVersion":9.6}'; expect "desktopMinVersion không phải chuỗi: false" "$(r101)" "f"
setting '{"server":true,"desktopMinVersion":"9.6.0"}' false; expect "thiết lập tắt: false" "$(r101)" "f"
setting 'không phải json'; expect "thiết lập sai JSON: false" "$(r101)" "f"
setting '[1]'; expect "thiết lập là mảng: false" "$(r101)" "f"
setting '{"server":false,"desktopMinVersion":"9.6.0"}'; expect "Zalo Server server=false: false" "$(r101 true)" "f"
setting '{"server":"true","desktopMinVersion":"9.6.0"}'; expect "Zalo Server server là chuỗi: false" "$(r101 true)" "f"
setting '{"server":true,"desktopMinVersion":"9.6.0"}'; expect "Zalo Server server=true: true (không xét máy)" "$(q "SELECT private.aka_agent_proxy_shared_runtime_ready(104, true)")" "t"

# ---------------------------------------------------------------------------------------------------- trigger thật
expect "V665: trigger cho gắn proxy đồng nghiệp cho A" "$(assign 101)" "gắn"
expect "V665: trigger cho gắn cho B (dòng cũ của mã máy trước)" "$(assign 102)" "gắn"
refuse "V665: trigger vẫn chặn C (máy gắn bản cũ)" "proxy_shared_runtime_not_ready" assign 103
refuse "V665: trigger vẫn chặn F (máy khác đang mở bản cũ)" "proxy_shared_runtime_not_ready" assign 107
refuse "V665: trigger chặn D (chưa gắn máy)" "proxy_shared_runtime_not_ready" assign 104
expect "V665: Zalo Server của C theo server=true" "$(assign 103 1 zalo true)" "gắn"
expect "V665: đổi proxy tài khoản sẵn có của A sang proxy đồng nghiệp" \
  "$(q "UPDATE public.auto_accounts SET proxy_id=1 WHERE staff_id=101 AND proxy_id=2 RETURNING 'đổi'")" "đổi"
q "UPDATE public.auto_staff_device_presence SET ended_at=now() WHERE staff_id=107 AND device_fingerprint_hash='fpF2'"
refuse "V665: F đóng máy bản cũ vẫn chặn (mở trong 7 ngày)" "proxy_shared_runtime_not_ready" assign 107
refuse "V665: trigger chặn S (máy khác mở bản cũ 2 ngày trước, đã đóng)" "proxy_shared_runtime_not_ready" assign 122
expect "V665: trigger cho gắn cho S2 (máy bản cũ 8 ngày không mở)" "$(assign 123)" "gắn"
q "INSERT INTO public.auto_staff_device_presence(staff_id, organization_id, device_fingerprint_hash, device_label, app_version, started_at, last_seen_at, ended_at)
   VALUES (107, 1, 'fpF2', 'cập nhật', '10.6.0', now() - interval '10 minutes', now() - interval '5 minutes', now() - interval '5 minutes'),
          (122, 1, 'fpSx', 'cập nhật', '10.7.0', now() - interval '10 minutes', now() - interval '5 minutes', now() - interval '5 minutes')"
expect "F cập nhật máy kia lên bản mới thì gắn được ngay" "$(assign 107)" "gắn"
expect "S cập nhật máy kia lên bản mới thì gắn được ngay" "$(assign 122)" "gắn"

# ---------------------------------------------------------------------------------------------------- thời gian
q "INSERT INTO public.auto_staff_device_presence(staff_id, organization_id, device_fingerprint_hash, device_label, app_version, started_at, last_seen_at, ended_at)
   SELECT 101, 1, CASE WHEN g % 3 = 0 THEN 'fpOld' || (g % 7) ELSE 'fpA' END, 'bulk', '9.5.0',
          now() - g * interval '12 minutes' - CASE WHEN g % 3 = 0 THEN interval '8 days' ELSE interval '2 days' END,
          now() - g * interval '12 minutes' - CASE WHEN g % 3 = 0 THEN interval '8 days' ELSE interval '2 days' END + interval '30 minutes',
          now() - g * interval '12 minutes' - CASE WHEN g % 3 = 0 THEN interval '8 days' ELSE interval '2 days' END + interval '30 minutes'
   FROM generate_series(1, 2000) g; ANALYZE public.auto_staff_device_presence"
ms=$(q "SELECT round(extract(epoch FROM clock_timestamp() - t) * 1000 / 50) FROM (SELECT clock_timestamp() t) s, LATERAL (SELECT count(*) FROM generate_series(1, 50) g WHERE private.aka_agent_proxy_shared_runtime_ready(101, false)) c")
[ "$ms" -lt 20 ] && ok "2.000 phiên một nhân viên: ${ms} ms / lần" || fail "chậm: ${ms} ms / lần"
expect "2.000 phiên cũ đã đóng (máy khác quá 7 ngày) không đổi kết quả của A" "$(r101)" "t"

# ---------------------------------------------------------------------------------------------------- gỡ
psql_db "$DB" -f "$WORK/live-20261126.sql" >/dev/null
refuse "thân hàm không phải V665: gỡ từ chối" "Gỡ V665: hàm không phải bản V665" run_file "$DOWN"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name='$NAME'"
out=$(run_file "$UP") || fail "apply lại V665 sau khi thân bị thay: $out"
ledger_add
expect "apply lại V665" "$(fn_md5)" "$NEW_MD5"
out=$(run_file "$DOWN") || fail "gỡ V665: $out"
ok "gỡ V665"
expect "gỡ: md5 về production" "$(fn_md5)" "$OLD_MD5"
expect "gỡ: quyền giữ nguyên" "$(fn_acl)" "$ACL0"
expect "gỡ: xoá dòng sổ" "$(q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v665_%'")" "0"
q "DELETE FROM public.auto_staff_device_presence WHERE device_label IN ('bulk', 'cập nhật')"
q "UPDATE public.auto_staff_device_presence SET ended_at=NULL WHERE staff_id=107 AND device_fingerprint_hash='fpF2'"
expect "gỡ: kết quả trở về như V511" "$(ready_all)" "$OLD_EXPECT"
out=$(run_file "$UP") || fail "apply lại sau khi gỡ: $out"
ledger_add
expect "apply lại sau khi gỡ" "$(fn_md5)" "$NEW_MD5"

echo "V665: $pass/$pass đạt"
