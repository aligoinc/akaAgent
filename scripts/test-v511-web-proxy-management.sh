#!/usr/bin/env bash
# Thử V511 (quản lý proxy theo tổ chức trên Web) trên PostgreSQL 16 cục bộ, không chạm production.
# Fixture dựng các bảng/hàm/policy liên quan như akachat ngày 12/11/2026 (định nghĩa hàm private.aka_agent_desktop_data_context
# và private.aka_agent_staff_scope_for_request, trigger khoá tài nguyên tài khoản, policy Desktop của auto_proxies/auto_accounts,
# quyền theo cột của aka_agent_desktop). Preflight của migration xác nhận policy/index/hàm khớp production.
# Kiểm: apply; quyền; cờ tổ chức; list/get/summary/accounts; thêm (đơn, hàng loạt), sửa, đặt hạn, xoá, chuyển tài khoản;
# quyền người thêm/quản trị; trigger chặn proxy khác tổ chức/khác nhân viên khi phần mềm chưa hỗ trợ; Desktop đọc proxy
# của tổ chức nhưng chỉ ghi proxy của mình; bộ kiểm tra (claim/report/lease/hash/2 lần hỏng/thử lại); chạy lại bị từ chối;
# rollback trả trạng thái cũ và từ chối khi còn tài khoản dùng proxy của nhân viên khác.
# Dùng: bash scripts/test-v511-web-proxy-management.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATIONS="$ROOT/migrations/migration_v511_web_proxy_management_p1.sql $ROOT/migrations/migration_v511_web_proxy_management_p2.sql $ROOT/migrations/migration_v511_web_proxy_management_p3.sql"
ROLLBACK="$ROOT/migrations/rollback_v511_web_proxy_management.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v511.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
python3 "$ROOT/scripts/build-v511-guarded-apply-sql.py" >/dev/null
cp $MIGRATIONS "$ROLLBACK" "$ROOT"/migrations/tests/migration_v511_web_proxy_management_p?_guarded_apply.sql "$WORK/" && chmod 644 "$WORK"/*.sql
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
DB=v511
psql_db() { local db=$1; shift; as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d "$db" -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db "$DB" -c "$1"; }
# Gọi RPC bằng service_role trong một giao dịch riêng.
svc() { psql_db "$DB" -c "SET ROLE service_role; $1"; }
rpc() { svc "SELECT public.aka_agent_control_proxies($1, $2, '$3', '$4'::jsonb)"; }
worker() { svc "SELECT public.aka_agent_proxy_check_worker('$1', '$2'::jsonb)"; }
run_file() { psql_db "$DB" -f "$WORK/$1" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối: $out)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }
jq_() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(eval(sys.argv[1], {'d': d}))" "$1"; }

psql_db postgres <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN BYPASSRLS;
CREATE DATABASE v511;
SQL
psql_db "$DB" >/dev/null <<'SQL'
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);

CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text NOT NULL, staff_admin_id bigint);
CREATE TABLE public.org_staff (
  id bigint PRIMARY KEY, organization_id bigint NOT NULL, name text, is_active boolean DEFAULT true,
  is_admin boolean DEFAULT false, is_admin_akabiz boolean DEFAULT false, deleted_at timestamptz);
CREATE TABLE private.aka_agent_desktop_users (staff_id bigint, auth_user_id uuid, created_at timestamptz DEFAULT now());

CREATE OR REPLACE FUNCTION private.aka_agent_staff_scope_for_request()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
BEGIN
 -- SET ROLE is retained across SECURITY DEFINER calls; current_user is not.
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
 BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
  v_user := NULLIF(v_claims->>'sub','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
 END;
 SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user;
 RETURN COALESCE(v_staff,0);
END;
$function$;
CREATE OR REPLACE FUNCTION private.aka_agent_desktop_data_context()
 RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT s.id, s.organization_id,
   COALESCE(s.is_admin_akabiz AND s.is_active AND s.deleted_at IS NULL,false)
 FROM public.org_staff s
 WHERE current_setting('role',true)='aka_agent_desktop'
   AND s.id=(SELECT private.aka_agent_staff_scope_for_request());
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_staff_scope_for_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_desktop_data_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION private.aka_agent_desktop_data_context() TO aka_agent_desktop;

CREATE TABLE public.auto_proxies (
  id bigserial PRIMARY KEY, name text NOT NULL, protocol text NOT NULL DEFAULT 'http', host text NOT NULL,
  port integer NOT NULL, username text, password text,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE, organization_id bigint,
  is_active boolean NOT NULL DEFAULT true, is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_proxies_port_check CHECK (port >= 1 AND port <= 65535),
  CONSTRAINT auto_proxies_protocol_check CHECK (protocol = ANY (ARRAY['http'::text, 'https'::text, 'socks5'::text])));
CREATE UNIQUE INDEX auto_proxies_staff_name_unique ON public.auto_proxies USING btree (staff_id, lower(name)) WHERE (is_delete = false);
CREATE INDEX idx_auto_proxies_staff ON public.auto_proxies USING btree (staff_id) WHERE (is_delete = false);
REVOKE ALL ON public.auto_proxies FROM anon, authenticated;
GRANT SELECT ON public.auto_proxies TO aka_agent_desktop;
GRANT INSERT (host, is_active, name, organization_id, password, port, protocol, staff_id, username),
      UPDATE (host, is_active, is_delete, name, password, port, protocol, updated_at, username)
  ON public.auto_proxies TO aka_agent_desktop;
GRANT USAGE ON SEQUENCE public.auto_proxies_id_seq TO aka_agent_desktop;
ALTER TABLE public.auto_proxies ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_owned_resource ON public.auto_proxies AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY v435_existing_role_access ON public.auto_proxies AS PERMISSIVE FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);

CREATE FUNCTION public.prevent_delete_proxy_with_accounts() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.is_delete = false AND NEW.is_delete = true) THEN
    IF EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.proxy_id = OLD.id AND a.is_delete = false) THEN
      RAISE EXCEPTION 'Không thể xoá proxy khi còn tài khoản đang dùng proxy này';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TABLE public.auto_account_groups (id bigint PRIMARY KEY, is_delete boolean DEFAULT false);
GRANT SELECT ON public.auto_account_groups TO aka_agent_desktop;
CREATE TABLE public.auto_accounts (
  id bigint PRIMARY KEY, name text, flatform_type text DEFAULT 'facebook', login_status text DEFAULT 'chưa đăng nhập',
  status text DEFAULT 'chờ xử lý', is_active boolean DEFAULT true, is_delete boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), staff_id bigint, organization_id bigint,
  account_group_id bigint, proxy_id bigint REFERENCES public.auto_proxies(id) ON DELETE RESTRICT,
  is_zalo_show_web boolean DEFAULT false, is_zalo_server boolean);
CREATE INDEX idx_auto_accounts_proxy_id ON public.auto_accounts (proxy_id) WHERE is_delete = false;
CREATE TRIGGER trg_prevent_delete_proxy_with_accounts BEFORE DELETE OR UPDATE OF is_delete ON public.auto_proxies
  FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_proxy_with_accounts();
CREATE OR REPLACE FUNCTION public.lock_auto_account_control_resources()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_old_account_group_id bigint;
  v_old_proxy_id bigint;
  v_lock_key bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_account_group_id := OLD.account_group_id;
    v_old_proxy_id := OLD.proxy_id;
  END IF;
  FOR v_lock_key IN
    SELECT DISTINCT resource.lock_key
    FROM (VALUES
        (CASE WHEN v_old_account_group_id IS NULL THEN NULL ELSE hashtextextended('control-zalo-account-group:' || v_old_account_group_id::text, 0) END),
        (CASE WHEN NEW.account_group_id IS NULL THEN NULL ELSE hashtextextended('control-zalo-account-group:' || NEW.account_group_id::text, 0) END),
        (CASE WHEN v_old_proxy_id IS NULL THEN NULL ELSE hashtextextended('control-zalo-proxy:' || v_old_proxy_id::text, 0) END),
        (CASE WHEN NEW.proxy_id IS NULL THEN NULL ELSE hashtextextended('control-zalo-proxy:' || NEW.proxy_id::text, 0) END)
    ) AS resource(lock_key)
    WHERE resource.lock_key IS NOT NULL
    ORDER BY resource.lock_key
  LOOP
    PERFORM pg_advisory_xact_lock_shared(v_lock_key);
  END LOOP;
  IF NOT COALESCE(NEW.is_delete, false) AND NEW.proxy_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.auto_proxies AS proxy WHERE proxy.id = NEW.proxy_id AND COALESCE(proxy.is_delete, false) = false) THEN
    RAISE EXCEPTION 'proxy_not_found';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_lock_auto_account_control_resources BEFORE INSERT OR UPDATE OF account_group_id, proxy_id, flatform_type,
  is_zalo_show_web, is_zalo_server, is_delete, staff_id, organization_id ON public.auto_accounts
  FOR EACH ROW EXECUTE FUNCTION public.lock_auto_account_control_resources();
REVOKE ALL ON public.auto_accounts FROM anon, authenticated;
GRANT SELECT ON public.auto_accounts TO aka_agent_desktop;
GRANT UPDATE (name, proxy_id, updated_at) ON public.auto_accounts TO aka_agent_desktop;
ALTER TABLE public.auto_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_owned_resource ON public.auto_accounts AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))
  WITH CHECK ((staff_id = (SELECT private.aka_agent_staff_scope_for_request()))
    AND ((account_group_id IS NULL) OR (EXISTS (SELECT 1 FROM auto_account_groups owned WHERE owned.id = auto_accounts.account_group_id)))
    AND ((proxy_id IS NULL) OR (EXISTS (SELECT 1 FROM auto_proxies owned WHERE owned.id = auto_accounts.proxy_id))));
CREATE POLICY v435_existing_role_access ON public.auto_accounts AS PERMISSIVE FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);

CREATE TABLE public.auto_system_settings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text NOT NULL UNIQUE, value text, description text,
  is_secret boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.auto_staff_device_presence (
  instance_id uuid PRIMARY KEY, staff_id bigint NOT NULL, organization_id bigint, app_version text,
  started_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(), ended_at timestamptz);

-- Dữ liệu: tổ chức 1 (nhân viên 11 = quản trị qua staff_admin_id, 12, 13), tổ chức 2 (nhân viên 21).
INSERT INTO public.org_organization VALUES (1, 'Org 1', 11), (2, 'Org 2', 21);
INSERT INTO public.org_staff (id, organization_id, name, is_active) VALUES
  (11, 1, 'Quản trị', true), (12, 1, 'Nhân viên B', true), (13, 1, 'Nhân viên C', true), (14, 1, 'Đã khoá', false), (21, 2, 'Org2', true);
INSERT INTO private.aka_agent_desktop_users VALUES (12, '00000000-0000-0000-0000-000000000012'), (13, '00000000-0000-0000-0000-000000000013');
INSERT INTO public.auto_proxies (id, name, protocol, host, port, username, password, staff_id, organization_id, updated_at) VALUES
  (101, 'A', 'http', '203.0.113.1', 8080, 'ua', 'pa', 11, 1, '2026-11-01 00:00:00+00'),
  (102, 'B', 'http', '203.0.113.2', 8080, 'ub', 'pb', 12, 1, '2026-11-01 00:00:00+00'),
  (103, 'C', 'socks5', '203.0.113.3', 1080, NULL, NULL, 12, 1, '2026-11-01 00:00:00+00'),
  (104, 'D', 'http', '203.0.113.4', 3128, '', '', 13, 1, '2026-11-01 00:00:00+00'),
  (201, 'A', 'http', '198.51.100.1', 8080, 'u2', 'p2', 21, 2, '2026-11-01 00:00:00+00');
SELECT setval('public.auto_proxies_id_seq', 500);
INSERT INTO public.auto_accounts (id, name, flatform_type, status, staff_id, organization_id, proxy_id, is_zalo_server, is_zalo_show_web) VALUES
  (1001, 'Zalo Server B1', 'zalo', 'chờ xử lý', 12, 1, 102, true, false),
  (1002, 'Zalo QR B2', 'zalo', 'chờ xử lý', 12, 1, 102, false, false),
  (1003, 'FB A', 'facebook', 'chờ xử lý', 11, 1, 101, NULL, false),
  (1004, 'Zalo Server B3', 'zalo', 'đang chạy', 12, 1, 102, true, false),
  (1005, 'Zalo Server B4', 'zalo', 'chờ xử lý', 12, 1, NULL, true, false),
  (1006, 'Zalo Server C1', 'zalo', 'chờ xử lý', 13, 1, 104, true, false),
  (2001, 'Org2 acc', 'zalo', 'chờ xử lý', 21, 2, 201, true, false);
SQL
ok "dựng fixture"

expect "md5 hàm data_context khớp production" "$(q "SELECT md5(pg_get_functiondef('private.aka_agent_desktop_data_context()'::regprocedure))")" "1c661248ef952acb98ee2a2082cf8bf8"

refuse "phần 2 trước phần 1 bị từ chối" "chưa apply phần 1" run_file migration_v511_web_proxy_management_p2.sql
for part in 1 2 3; do
  out=$(run_file migration_v511_web_proxy_management_p$part.sql) || fail "apply V511 phần $part: $out"
  q "INSERT INTO supabase_migrations.schema_migrations VALUES ('2026111215000$part', 'migration_v511_web_proxy_management_p$part', NULL)"
done
ok "apply V511 ba phần theo thứ tự"
refuse "chạy lại phần 1 bị từ chối" "đã có trong sổ migration" run_file migration_v511_web_proxy_management_p1.sql
refuse "chạy lại phần 2 bị từ chối" "đã có trong sổ migration" run_file migration_v511_web_proxy_management_p2.sql
refuse "chạy lại phần 3 bị từ chối" "đã có trong sổ migration" run_file migration_v511_web_proxy_management_p3.sql

# Quyền
expect "anon không gọi được RPC" "$(q "SELECT has_function_privilege('anon', 'public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'EXECUTE')")" "f"
expect "desktop không gọi được worker" "$(q "SELECT has_function_privilege('aka_agent_desktop', 'public.aka_agent_proxy_check_worker(text,jsonb)', 'EXECUTE')")" "f"
expect "service_role không đọc thẳng bảng kiểm tra" "$(q "SELECT has_table_privilege('service_role', 'public.auto_proxy_checks', 'SELECT')")" "f"
expect "cờ mặc định tắt" "$(q "SELECT count(*) FROM org_organization WHERE web_proxy_management_enabled")" "0"

refuse "cờ tắt thì từ chối" "proxy_management_disabled" rpc 12 1 list '{}'
q "UPDATE org_organization SET web_proxy_management_enabled = true WHERE id = 1"
refuse "nhân viên đã khoá bị từ chối" "proxy_staff_invalid" rpc 14 1 list '{}'
refuse "sai tổ chức bị từ chối" "proxy_staff_invalid" rpc 21 1 list '{}'
refuse "tổ chức 2 chưa bật cờ" "proxy_management_disabled" rpc 21 2 list '{}'
refuse "lệnh lạ bị từ chối" "proxy_invalid_action" rpc 12 1 dance '{}'

# list
list=$(rpc 12 1 list '{}')
expect "list trả 4 proxy của tổ chức" "$(echo "$list" | jq_ "len(d['proxies'])")" "4"
expect "không lộ proxy tổ chức khác" "$(echo "$list" | jq_ "sorted(p['id'] for p in d['proxies'])")" "[101, 102, 103, 104]"
expect "không trả mật khẩu" "$(echo "$list" | grep -c '"pa"\|"pb"' || true)" "0"
expect "nhân viên thường không phải quản trị" "$(echo "$list" | jq_ "d['isOrgAdmin']")" "False"
expect "B quản lý được proxy của mình" "$(echo "$list" | jq_ "[p['canManage'] for p in d['proxies'] if p['id']==102][0]")" "True"
expect "B không quản lý proxy của A" "$(echo "$list" | jq_ "[p['canManage'] for p in d['proxies'] if p['id']==101][0]")" "False"
expect "usage proxy 102" "$(echo "$list" | jq_ "[(p['usage']['total'], p['usage']['mine'], p['usage']['server'], p['usage']['desktop']) for p in d['proxies'] if p['id']==102][0]")" "(3, 3, 2, 1)"
expect "proxy 102 khoá địa chỉ vì có tài khoản Desktop" "$(echo "$list" | jq_ "[p['endpointLocked'] for p in d['proxies'] if p['id']==102][0]")" "True"
expect "proxy 101: tài khoản của người khác gom theo nhân viên" "$(echo "$list" | jq_ "[p['usage']['others'] for p in d['proxies'] if p['id']==101][0]")" "[{'name': 'Quản trị', 'count': 1, 'staffId': 11}]"
expect "chưa kiểm tra thì pending" "$(echo "$list" | jq_ "[p['check']['status'] for p in d['proxies'] if p['id']==103][0]")" "pending"
expect "tên người thêm" "$(echo "$list" | jq_ "[p['ownerName'] for p in d['proxies'] if p['id']==101][0]")" "Quản trị"
admin=$(rpc 11 1 list '{}')
expect "staff_admin_id là quản trị" "$(echo "$admin" | jq_ "(d['isOrgAdmin'], all(p['canManage'] for p in d['proxies']))")" "(True, True)"

# create
created=$(rpc 13 1 create '{"proxy":{"name":"Mới 1","protocol":"https","host":"Proxy.Example.COM","port":443,"username":"u","password":"p","expiresOn":"2026-12-12","note":"ghi chú"}}')
newid=$(echo "$created" | jq_ "d['proxy']['id']")
expect "create trả proxy, host viết thường" "$(echo "$created" | jq_ "(d['proxy']['host'], d['proxy']['expiresOn'], d['proxy']['hasPassword'], d['proxy']['ownerStaffId'])")" "('proxy.example.com', '2026-12-12', True, 13)"
expect "create tạo dòng kiểm tra pending" "$(q "SELECT status FROM auto_proxy_checks WHERE proxy_id = $newid")" "pending"
refuse "tên trùng trong tổ chức (khác nhân viên, khác hoa thường)" "proxy_name_taken" rpc 12 1 create '{"proxy":{"name":"mới 1","host":"203.0.113.9","port":1}}'
refuse "proxy trùng địa chỉ" "proxy_duplicate" rpc 12 1 create '{"proxy":{"name":"Khác","host":"PROXY.example.com","port":443,"username":"u"}}'
refuse "cổng sai" "proxy_invalid_port" rpc 12 1 create '{"proxy":{"name":"X","host":"h","port":70000}}'
refuse "địa chỉ sai" "proxy_invalid_host" rpc 12 1 create '{"proxy":{"name":"X","host":"bad host","port":80}}'
refuse "hạn dùng sai" "proxy_invalid_expiry" rpc 12 1 create '{"proxy":{"name":"X","host":"h","port":80,"expiresOn":"2026-02-30"}}'
refuse "khoá lạ trong proxy" "proxy_invalid_payload" rpc 12 1 create '{"proxy":{"name":"X","host":"h","port":80,"staff_id":11}}'
refuse "tên trùng tổ chức khác thì được (tổ chức 2 chưa bật)" "proxy_management_disabled" rpc 21 2 create '{"proxy":{"name":"Mới 1","host":"h","port":80}}'

# create_many
many=$(rpc 12 1 create_many '{"items":[{"name":"Lô 1","host":"203.0.113.50","port":8080},{"name":"Lô 2","host":"203.0.113.2","port":8080,"username":"ub"},{"name":"B","host":"203.0.113.51","port":1},{"name":"Lô 3","host":"x y","port":1},{"name":"Lô 4","host":"203.0.113.50","port":8080}]}')
expect "create_many: 1 tạo, 4 bỏ qua đúng lý do" "$(echo "$many" | jq_ "(len(d['created']), [(s['index'], s['reason']) for s in d['skipped']])")" "(1, [(1, 'duplicate'), (2, 'name_taken'), (3, 'invalid'), (4, 'duplicate')])"
expect "create_many: tên proxy đã có" "$(echo "$many" | jq_ "d['skipped'][0]['existingName']")" "B"

# update
v102=$(q "SELECT to_jsonb(updated_at) #>> '{}' FROM auto_proxies WHERE id = 102")
refuse "người khác không sửa được" "proxy_forbidden" rpc 13 1 update "{\"proxyId\":102,\"expectedUpdatedAt\":\"$v102\",\"patch\":{\"name\":\"B2\"}}"
refuse "sai phiên bản" "proxy_version_conflict" rpc 12 1 update '{"proxyId":102,"expectedUpdatedAt":"2020-01-01T00:00:00Z","patch":{"name":"B2"}}'
refuse "đổi địa chỉ khi có tài khoản Desktop" "proxy_endpoint_locked" rpc 12 1 update "{\"proxyId\":102,\"expectedUpdatedAt\":\"$v102\",\"patch\":{\"host\":\"203.0.113.99\"}}"
refuse "tắt khi đang dùng" "proxy_in_use" rpc 12 1 update "{\"proxyId\":102,\"expectedUpdatedAt\":\"$v102\",\"patch\":{\"isActive\":false}}"
upd=$(rpc 11 1 update "{\"proxyId\":102,\"expectedUpdatedAt\":\"$v102\",\"patch\":{\"name\":\"B2\",\"note\":\"n\",\"expiresOn\":\"2026-11-14\",\"username\":\"ub\"}}")
expect "quản trị sửa tên/hạn/ghi chú của proxy người khác" "$(echo "$upd" | jq_ "(d['proxy']['name'], d['proxy']['note'], d['proxy']['expiresOn'])")" "('B2', 'n', '2026-11-14')"
v103=$(q "SELECT to_jsonb(updated_at) #>> '{}' FROM auto_proxies WHERE id = 103")
q "INSERT INTO auto_proxy_checks (proxy_id, status, checked_at, last_ok_at, endpoint_hash, next_check_at) SELECT 103, 'ok', now(), now(), private.aka_agent_proxy_endpoint_hash(protocol, host, port, username, password), now() + interval '1 day' FROM auto_proxies WHERE id = 103"
upd=$(rpc 12 1 update "{\"proxyId\":103,\"expectedUpdatedAt\":\"$v103\",\"patch\":{\"host\":\"203.0.113.33\",\"password\":\"x\",\"username\":\"y\"}}")
expect "đổi địa chỉ proxy chưa dùng: kiểm tra lại từ đầu" "$(echo "$upd" | jq_ "(d['proxy']['host'], d['proxy']['check']['status'])")|$(q "SELECT status || ',' || (next_check_at <= now()) FROM auto_proxy_checks WHERE proxy_id = 103")" "('203.0.113.33', 'pending')|pending,true"
v103=$(q "SELECT to_jsonb(updated_at) #>> '{}' FROM auto_proxies WHERE id = 103")
upd=$(rpc 12 1 update "{\"proxyId\":103,\"expectedUpdatedAt\":\"$v103\",\"patch\":{\"password\":null}}")
expect "xoá mật khẩu đã lưu" "$(echo "$upd" | jq_ "d['proxy']['hasPassword']")" "False"

# set_expiry
q "UPDATE auto_proxies SET expires_on = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 5 WHERE id = 104"
exp=$(rpc 12 1 set_expiry '{"proxyIds":[102,103,104,201,999],"addDays":30}')
expect "đặt hạn: chỉ proxy được quản lý" "$(echo "$exp" | jq_ "(sorted(d['updated']), sorted(d['forbidden']))")" "([102, 103], [104, 201, 999])"
expect "+30 tính từ hạn hiện tại" "$(q "SELECT expires_on FROM auto_proxies WHERE id = 102")" "2026-12-14"
expect "+30 khi chưa có hạn tính từ hôm nay" "$(q "SELECT expires_on = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 30 FROM auto_proxies WHERE id = 103")" "t"
rpc 11 1 set_expiry '{"proxyIds":[104],"addDays":10}' >/dev/null
expect "+10 khi đã hết hạn tính từ hôm nay" "$(q "SELECT expires_on = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 10 FROM auto_proxies WHERE id = 104")" "t"
rpc 12 1 set_expiry '{"proxyIds":[103],"expiresOn":null}' >/dev/null
expect "bỏ hạn" "$(q "SELECT expires_on IS NULL FROM auto_proxies WHERE id = 103")" "t"
refuse "đặt hạn cần đúng một kiểu" "proxy_invalid_payload" rpc 12 1 set_expiry '{"proxyIds":[103],"addDays":1,"expiresOn":null}'

# summary
q "UPDATE auto_proxies SET expires_on = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 2 WHERE id = 101"
sum=$(rpc 12 1 summary '{}')
expect "summary đếm sắp hết hạn" "$(echo "$sum" | jq_ "(d['total'], d['expiring'], d['failedOnly'], d['checkMode'])")" "(6, 1, 0, 'off')"

# accounts
acc=$(rpc 13 1 accounts '{"proxyId":102}')
expect "accounts: tài khoản của mình rỗng, người khác gom" "$(echo "$acc" | jq_ "(d['mine'], d['others'])")" "([], [{'name': 'Nhân viên B', 'count': 3, 'staffId': 12}])"
acc=$(rpc 12 1 accounts '{"proxyId":102}')
expect "accounts: tài khoản của mình kèm nơi chạy" "$(echo "$acc" | jq_ "[(a['id'], a['runtime']) for a in d['mine']]")" "[(1002, 'desktop'), (1001, 'server'), (1004, 'server')]"
refuse "accounts: proxy tổ chức khác" "proxy_not_found" rpc 12 1 accounts '{"proxyId":201}'

# can_assign
expect "can_assign: proxy của mình" "$(rpc 12 1 can_assign '{"proxyId":102,"server":true}' | jq_ "(d['ok'], d['ownProxy'])")" "(True, True)"
expect "can_assign: proxy đồng nghiệp khi chưa sẵn sàng" "$(rpc 12 1 can_assign '{"proxyId":101,"server":true}' | jq_ "(d['ok'], d['reason'])")" "(False, 'proxy_shared_runtime_not_ready')"
expect "can_assign: proxy tổ chức khác" "$(rpc 12 1 can_assign '{"proxyId":201,"server":false}' | jq_ "d['reason']")" "proxy_not_found"

# reassign
mv=$(rpc 12 1 reassign '{"fromProxyId":102,"toProxyId":103,"accountIds":[1001,1004,1003,9999]}')
expect "chuyển: tài khoản đang chạy, của người khác bị bỏ qua" "$(echo "$mv" | jq_ "(d['moved'], sorted((s['accountId'], s['reason']) for s in d['skipped']))")" "([1001], [(1003, 'not_found'), (1004, 'running'), (9999, 'not_found')])"
expect "tài khoản đã sang proxy mới" "$(q "SELECT proxy_id FROM auto_accounts WHERE id = 1001")" "103"
mv=$(rpc 12 1 reassign '{"fromProxyId":103,"toProxyId":101,"accountIds":[1001]}')
expect "proxy của nhân viên khác: chặn khi App Server chưa sẵn sàng" "$(echo "$mv" | jq_ "(d['moved'], d['skipped'])")" "([], [{'reason': 'shared_runtime_not_ready', 'accountId': 1001}])"
q "UPDATE auto_system_settings SET value = '{\"server\":true,\"desktopMinVersion\":null}' WHERE key = 'proxies.shared_runtime'"
mv=$(rpc 12 1 reassign '{"fromProxyId":103,"toProxyId":101,"accountIds":[1001]}')
expect "App Server sẵn sàng thì tài khoản Server dùng được proxy đồng nghiệp" "$(echo "$mv" | jq_ "d['moved']")" "[1001]"
mv=$(rpc 12 1 reassign '{"fromProxyId":102,"toProxyId":101,"accountIds":[1002]}')
expect "tài khoản Desktop vẫn bị chặn khi chưa có bản Desktop đọc theo tổ chức" "$(echo "$mv" | jq_ "d['skipped'][0]['reason']")" "shared_runtime_not_ready"
q "UPDATE auto_system_settings SET value = '{\"server\":true,\"desktopMinVersion\":\"9.6.0\"}' WHERE key = 'proxies.shared_runtime'"
q "INSERT INTO auto_staff_device_presence (instance_id, staff_id, organization_id, app_version) VALUES ('00000000-0000-0000-0000-0000000000a1', 12, 1, '9.6.0'), ('00000000-0000-0000-0000-0000000000a2', 12, 1, '9.5.1')"
mv=$(rpc 12 1 reassign '{"fromProxyId":102,"toProxyId":101,"accountIds":[1002]}')
expect "còn một máy bản cũ thì vẫn chặn" "$(echo "$mv" | jq_ "d['skipped'][0]['reason']")" "shared_runtime_not_ready"
q "UPDATE auto_staff_device_presence SET last_seen_at = now() - interval '31 days' WHERE app_version = '9.5.1'"
mv=$(rpc 12 1 reassign '{"fromProxyId":102,"toProxyId":101,"accountIds":[1002]}')
expect "mọi máy 30 ngày qua đủ bản thì cho" "$(echo "$mv" | jq_ "d['moved']")" "[1002]"
mv=$(rpc 12 1 reassign '{"fromProxyId":101,"toProxyId":null,"accountIds":[1002]}')
expect "gỡ proxy" "$(echo "$mv" | jq_ "d['moved']")|$(q "SELECT proxy_id IS NULL FROM auto_accounts WHERE id = 1002")" "[1002]|t"
refuse "chuyển sang proxy tổ chức khác" "proxy_unavailable" rpc 12 1 reassign '{"fromProxyId":101,"toProxyId":201,"accountIds":[1001]}'
q "UPDATE auto_system_settings SET value = '{\"server\":false,\"desktopMinVersion\":null}' WHERE key = 'proxies.shared_runtime'"

# Trigger trên auto_accounts (mọi đường ghi, kể cả SQL trực tiếp).
refuse "trigger: proxy khác tổ chức" "proxy_wrong_organization" q "UPDATE auto_accounts SET proxy_id = 201 WHERE id = 1005"
refuse "trigger: proxy đồng nghiệp khi chưa sẵn sàng" "proxy_shared_runtime_not_ready" q "UPDATE auto_accounts SET proxy_id = 101 WHERE id = 1005"
q "UPDATE auto_accounts SET proxy_id = 103 WHERE id = 1005"
ok "trigger: proxy của chính mình vẫn gắn được"
q "UPDATE auto_accounts SET name = 'đổi tên', proxy_id = proxy_id WHERE id = 1001"
ok "trigger: tài khoản đang dùng proxy đồng nghiệp vẫn sửa được khi không đổi proxy"

# Desktop (aka_agent_desktop): đọc proxy cả tổ chức, chỉ ghi proxy của mình.
desk() { psql_db "$DB" -c "SET ROLE aka_agent_desktop; SET request.jwt.claims = '{\"role\":\"aka_agent_desktop\",\"sub\":\"00000000-0000-0000-0000-000000000012\"}'; $1"; }
expect "Desktop đọc proxy của tổ chức" "$(desk "SELECT string_agg(id::text, ',' ORDER BY id) FROM auto_proxies WHERE NOT is_delete")" "101,102,103,104,$newid,$(q "SELECT string_agg(id::text, ',' ORDER BY id) FROM auto_proxies WHERE name = 'Lô 1'")"
expect "Desktop không thấy proxy tổ chức khác" "$(desk "SELECT count(*) FROM auto_proxies WHERE id = 201")" "0"
expect "Desktop không sửa được proxy đồng nghiệp" "$(desk "WITH u AS (UPDATE auto_proxies SET name = 'hack' WHERE id = 101 RETURNING 1) SELECT count(*) FROM u")" "0"
expect "Desktop sửa được proxy của mình" "$(desk "WITH u AS (UPDATE auto_proxies SET port = 8081 WHERE id = 102 RETURNING 1) SELECT count(*) FROM u")" "1"
refuse "Desktop không thêm proxy đứng tên người khác" "row-level security" desk "INSERT INTO auto_proxies (name, host, port, staff_id, organization_id) VALUES ('x', 'h', 1, 11, 1)"
refuse "Desktop gắn proxy đồng nghiệp khi chưa sẵn sàng" "proxy_shared_runtime_not_ready" desk "UPDATE auto_accounts SET proxy_id = 101 WHERE id = 1005"

# Xoá
del=$(rpc 12 1 delete '{"proxyIds":[102,103,101,999]}')
expect "xoá: đang dùng/không có quyền" "$(echo "$del" | jq_ "(d['updated'], sorted(d['inUse']), sorted(d['forbidden']))")" "([], [102, 103], [101, 999])"
lot=$(q "SELECT id FROM auto_proxies WHERE name = 'Lô 1'")
del=$(rpc 12 1 delete "{\"proxyIds\":[$lot]}")
expect "xoá proxy chưa dùng" "$(echo "$del" | jq_ "d['updated']")|$(q "SELECT is_delete FROM auto_proxies WHERE id = $lot")" "[$lot]|t"

# Bộ kiểm tra.
expect "chế độ off: claim rỗng" "$(worker claim '{"limit":10}' | jq_ "(d['mode'], d['items'])")" "('off', [])"
refuse "chế độ off: check_now bị từ chối" "proxy_check_disabled" rpc 12 1 check_now '{"proxyId":101}'
q "UPDATE auto_system_settings SET value = 'on' WHERE key = 'proxies.check_mode'"
claim=$(worker claim '{"limit":50,"leaseSeconds":120}')
expect "claim: proxy đang bật của tổ chức đã bật cờ, kèm mật khẩu" "$(echo "$claim" | jq_ "(d['mode'], sorted(i['proxyId'] for i in d['items']), [i['password'] for i in d['items'] if i['proxyId']==101][0])")" "('on', [101, 102, 103, 104, $newid], 'pa')"
expect "claim lần hai không nhận lại proxy đang giữ" "$(worker claim '{"limit":50}' | jq_ "d['items']")" "[]"
lease101=$(echo "$claim" | jq_ "[i['leaseToken'] for i in d['items'] if i['proxyId']==101][0]")
hash101=$(echo "$claim" | jq_ "[i['endpointHash'] for i in d['items'] if i['proxyId']==101][0]")
lease104=$(echo "$claim" | jq_ "[i['leaseToken'] for i in d['items'] if i['proxyId']==104][0]")
hash104=$(echo "$claim" | jq_ "[i['endpointHash'] for i in d['items'] if i['proxyId']==104][0]")
rep=$(worker report "{\"results\":[{\"proxyId\":101,\"leaseToken\":\"$lease101\",\"endpointHash\":\"$hash101\",\"outcome\":\"ok\",\"latencyMs\":120,\"exitIp\":\"203.0.113.1\"},{\"proxyId\":104,\"leaseToken\":\"$lease104\",\"endpointHash\":\"$hash104\",\"outcome\":\"failed\",\"errorCode\":\"timeout\"},{\"proxyId\":102,\"leaseToken\":\"00000000-0000-0000-0000-000000000000\",\"endpointHash\":\"x\",\"outcome\":\"ok\"}]}")
expect "report: 2 ghi, 1 sai lease" "$(echo "$rep" | jq_ "(d['applied'], d['stale'])")" "(2, 1)"
expect "ok: trạng thái và lần kiểm tra kế tiếp 06:xx giờ VN" "$(q "SELECT status || ',' || latency_ms || ',' || exit_ip || ',' || (extract(hour FROM next_check_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int || ',' || (next_check_at > now() + interval '6 hours') FROM auto_proxy_checks WHERE proxy_id = 101")" "ok,120,203.0.113.1,6,true"
expect "hỏng lần đầu: chưa đổi trạng thái, thử lại sau 2 phút" "$(q "SELECT status || ',' || consecutive_failures || ',' || (next_check_at BETWEEN now() + interval '100 seconds' AND now() + interval '140 seconds') FROM auto_proxy_checks WHERE proxy_id = 104")" "pending,1,true"
q "UPDATE auto_proxy_checks SET next_check_at = now() - interval '1 second' WHERE proxy_id = 104"
claim=$(worker claim '{"limit":50}')
lease104=$(echo "$claim" | jq_ "[i['leaseToken'] for i in d['items'] if i['proxyId']==104][0]")
worker report "{\"results\":[{\"proxyId\":104,\"leaseToken\":\"$lease104\",\"endpointHash\":\"$hash104\",\"outcome\":\"failed\",\"errorCode\":\"auth_failed\"}]}" >/dev/null
expect "hỏng lần hai: failed" "$(q "SELECT status || ',' || error_code || ',' || consecutive_failures || ',' || (failing_since IS NOT NULL) FROM auto_proxy_checks WHERE proxy_id = 104")" "failed,auth_failed,2,true"
list=$(rpc 13 1 list '{}')
expect "list hiện lý do hỏng" "$(echo "$list" | jq_ "[(p['check']['status'], p['check']['errorCode']) for p in d['proxies'] if p['id']==104][0]")" "('failed', 'auth_failed')"
q "UPDATE auto_proxies SET expires_on = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1 WHERE id = 104"
expect "summary: hỏng mà sắp hết hạn chỉ đếm một lần" "$(rpc 13 1 summary '{}' | jq_ "(d['expiring'], d['failedOnly'])")" "(2, 0)"
q "UPDATE auto_proxies SET expires_on = NULL WHERE id = 104"
expect "summary: hỏng được đếm khi không sắp hết hạn" "$(rpc 13 1 summary '{}' | jq_ "(d['expiring'], d['failedOnly'])")" "(1, 1)"

# check_now (khách bấm): trả mật khẩu cho API, giới hạn 30 giây, 1 lần hỏng là failed.
now=$(rpc 13 1 check_now '{"proxyId":101}')
expect "check_now trả thông tin kết nối" "$(echo "$now" | jq_ "(d['host'], d['password'], d['endpointHash'] == '$hash101')")" "('203.0.113.1', 'pa', True)"
refuse "check_now quá nhanh" "proxy_check_rate_limited" rpc 13 1 check_now '{"proxyId":101}'
worker report "{\"results\":[{\"proxyId\":101,\"endpointHash\":\"$hash101\",\"outcome\":\"failed\",\"errorCode\":\"refused\",\"manual\":true}]}" >/dev/null
expect "khách bấm kiểm tra, hỏng một lần là failed" "$(q "SELECT status || ',' || error_code FROM auto_proxy_checks WHERE proxy_id = 101")" "failed,refused"
# Proxy bị sửa giữa lúc kiểm tra: bỏ kết quả.
q "UPDATE auto_proxy_checks SET next_check_at = now() - interval '1 second', lease_token = NULL, lease_until = NULL WHERE proxy_id = 101"
claim=$(worker claim '{"limit":50}')
lease101=$(echo "$claim" | jq_ "[i['leaseToken'] for i in d['items'] if i['proxyId']==101][0]")
q "UPDATE auto_proxies SET password = 'mới' WHERE id = 101"
rep=$(worker report "{\"results\":[{\"proxyId\":101,\"leaseToken\":\"$lease101\",\"endpointHash\":\"$hash101\",\"outcome\":\"ok\"}]}")
expect "sửa giữa lúc kiểm tra: bỏ kết quả, kiểm tra lại ngay" "$(echo "$rep" | jq_ "d['stale']")|$(q "SELECT status || ',' || (next_check_at <= now()) FROM auto_proxy_checks WHERE proxy_id = 101")" "1|failed,true"
expect "list coi kết quả cũ là pending khi địa chỉ/mật khẩu đã đổi" "$(rpc 13 1 list '{}' | jq_ "[p['check']['status'] for p in d['proxies'] if p['id']==101][0]")" "pending"
# retry (API phát hiện mất mạng hàng loạt).
claim=$(worker claim '{"limit":50}')
lease101=$(echo "$claim" | jq_ "[i['leaseToken'] for i in d['items'] if i['proxyId']==101][0]")
hash101=$(echo "$claim" | jq_ "[i['endpointHash'] for i in d['items'] if i['proxyId']==101][0]")
worker report "{\"results\":[{\"proxyId\":101,\"leaseToken\":\"$lease101\",\"endpointHash\":\"$hash101\",\"outcome\":\"retry\",\"retryAfterSeconds\":900}]}" >/dev/null
expect "retry: không đổi trạng thái, hẹn 15 phút" "$(q "SELECT status || ',' || (next_check_at BETWEEN now() + interval '880 seconds' AND now() + interval '920 seconds') || ',' || (lease_token IS NULL) FROM auto_proxy_checks WHERE proxy_id = 101")" "failed,true,true"
# Tổ chức tắt cờ thì không nhận.
q "UPDATE auto_proxy_checks SET next_check_at = now() - interval '1 second', lease_token = NULL, lease_until = NULL"
q "UPDATE org_organization SET web_proxy_management_enabled = false WHERE id = 1"
expect "tổ chức tắt cờ: không kiểm tra" "$(worker claim '{"limit":50}' | jq_ "d['items']")" "[]"
q "UPDATE org_organization SET web_proxy_management_enabled = true WHERE id = 1"
# check_all
ca=$(rpc 12 1 check_all '{}')
expect "check_all xếp hàng mọi proxy đang bật" "$(echo "$ca" | jq_ "(d['queued'], d['retryAfterSeconds'])")" "(5, 0)"
expect "check_all lần hai trong 10 phút" "$(rpc 12 1 check_all '{}' | jq_ "(d['queued'], d['retryAfterSeconds'] > 500)")" "(0, True)"

# Rollback.
refuse "rollback từ chối khi còn tài khoản dùng proxy đồng nghiệp" "Còn tài khoản dùng proxy do nhân viên khác thêm" run_file rollback_v511_web_proxy_management.sql
q "UPDATE auto_accounts SET proxy_id = 103 WHERE id = 1001"
out=$(run_file rollback_v511_web_proxy_management.sql) || fail "rollback: $out"
ok "rollback chạy"
expect "rollback: cột/bảng/hàm/cài đặt đã gỡ" "$(q "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name IN ('org_organization','auto_proxies') AND column_name IN ('web_proxy_management_enabled','expires_on','note')) || ',' || (to_regclass('public.auto_proxy_checks') IS NULL) || ',' || (SELECT count(*) FROM pg_proc WHERE proname LIKE 'aka_agent_proxy%' OR proname = 'aka_agent_control_proxies') || ',' || (SELECT count(*) FROM auto_system_settings WHERE key LIKE 'proxies.%')")" "0,true,0,0"
expect "rollback: Desktop lại chỉ đọc proxy của mình" "$(desk "SELECT string_agg(DISTINCT staff_id::text, ',') FROM auto_proxies")" "12"
q "DELETE FROM supabase_migrations.schema_migrations"
for part in 1 2 3; do
  out=$(run_file migration_v511_web_proxy_management_p$part.sql) || fail "apply lại phần $part sau rollback: $out"
done
ok "apply lại sau rollback"

# Đường dự phòng: script dán SQL Editor (scripts/build-v511-guarded-apply-sql.py) tự ghi sổ migration.
out=$(run_file rollback_v511_web_proxy_management.sql) || fail "rollback trước khi thử script dán: $out"
q "DELETE FROM supabase_migrations.schema_migrations"
G=migration_v511_web_proxy_management
refuse "script dán: phần 2 trước phần 1 bị từ chối" "chưa thấy ${G}_p1 trong sổ migration" run_file ${G}_p2_guarded_apply.sql
expect "script dán: lượt bị từ chối không đổi gì" "$(q "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations) || ',' || (to_regclass('public.auto_proxy_checks') IS NULL)")" "0,true"
for part in 1 2 3; do
  out=$(run_file ${G}_p${part}_guarded_apply.sql) || fail "script dán phần $part: $out"
  case "$out" in *"applied|"*"|${G}_p$part|"*"|t|"*) ;; *) fail "script dán phần $part: kết quả lạ: $out" ;; esac
done
ok "script dán: ba phần apply và báo md5 khớp"
expect "script dán: md5 sổ = md5 file" "$(q "SELECT string_agg(md5(statements[1]), ',' ORDER BY name) FROM supabase_migrations.schema_migrations")" \
  "$(for part in 1 2 3; do md5sum < "$WORK/${G}_p$part.sql" | cut -c1-32; done | paste -sd,)"
refuse "script dán: dán lại bị từ chối" "đã có trong sổ migration, không chạy lại" run_file ${G}_p1_guarded_apply.sql
expect "script dán: không bật cờ tổ chức nào" "$(q "SELECT count(*) FROM org_organization WHERE web_proxy_management_enabled")" "0"

echo "Tất cả $pass kiểm tra đạt"
