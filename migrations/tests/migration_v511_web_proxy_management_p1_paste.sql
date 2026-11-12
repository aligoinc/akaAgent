-- V511 phần 1/3 — dán nguyên khối này vào Supabase SQL Editor (project akachat) rồi bấm Run.
-- Thành công: bảng kết quả có status = applied. Lỗi bất kỳ: không đổi gì trong DB.
BEGIN;
DO $v511_run$
DECLARE
  v_src text := $v511_src$-- V511 phần 1/3: quản lý proxy theo tổ chức trên Web (akaAgentWebApp, trang /proxies). Apply trước phần 2.
-- Phần 1: cột, bảng, index, policy Desktop, cài đặt, hàm phụ, trigger auto_accounts. Phần 2: RPC cho Web. Phần 3: RPC cho bộ kiểm tra, quyền, kiểm tra cuối.
-- Nguồn: akachat cgjbsmqtfhqvttudyjzq, đọc 12/11/2026 (ledger mới nhất V510). Hợp đồng, rollout, gỡ: docs/WEB_PROXY_MANAGEMENT_V511.md.
--
-- Thêm, không sửa hàm cũ:
--   * org_organization.web_proxy_management_enabled (mặc định false): bật trang Quản lý proxy trên Web cho tổ chức.
--   * auto_proxies.expires_on / note (khách tự nhập hạn dùng và ghi chú).
--   * Tên proxy không trùng trong TỔ CHỨC (trước: trong một nhân viên). Live 12/11: 0 tên trùng trong tổ chức.
--   * Bảng auto_proxy_checks (kết quả kiểm tra kết nối, mỗi proxy một dòng) — tách khỏi auto_proxies để bộ kiểm
--     tra không đổi updated_at (Web dùng updated_at chống ghi đè).
--   * Desktop (aka_agent_desktop) ĐỌC mọi proxy của tổ chức; vẫn chỉ ghi proxy của chính mình.
--   * Trigger trên auto_accounts: chỉ cho gắn proxy cùng tổ chức; proxy do nhân viên khác thêm chỉ gắn được khi phần
--     mềm chạy tài khoản đó đã đọc proxy theo tổ chức (auto_system_settings proxies.shared_runtime). Bản Desktop/App
--     Server cũ lọc proxy theo staff_id nên sẽ âm thầm chạy không proxy — trigger chặn trường hợp đó.
--   * RPC public.aka_agent_control_proxies (Web) và public.aka_agent_proxy_check_worker (bộ kiểm tra trong API Fly),
--     EXECUTE chỉ service_role. Cài đặt proxies.check_mode (off|shadow|on, mặc định off).
-- Không đụng: hàm tạo tài khoản, RPC cũ update/delete_control_zalo_proxy_atomic (Web/iOS cũ vẫn dùng), dữ liệu khách.
-- DDL trên org_organization/auto_proxies/auto_accounts ⇒ PostgREST nạp lại schema: apply buổi tối, ngoài cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  v_policy record;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'V511 phải chạy bằng postgres';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v511_%') THEN
    RAISE EXCEPTION 'V511 đã có trong sổ migration, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'org_organization' AND column_name = 'web_proxy_management_enabled')
               OR (table_name = 'auto_proxies' AND column_name IN ('expires_on', 'note'))))
     OR to_regclass('public.auto_proxy_checks') IS NOT NULL
     OR to_regclass('public.auto_proxies_org_name_unique') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE (n.nspname = 'public' AND p.proname IN ('aka_agent_control_proxies', 'aka_agent_proxy_check_worker'))
                   OR (n.nspname = 'private' AND p.proname LIKE 'aka_agent_proxy\_%'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'private' AND p.proname = 'aka_agent_guard_account_proxy_scope')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_accounts'::regclass AND tgname = 'trg_account_proxy_scope_guard')
     OR EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key IN ('proxies.check_mode', 'proxies.shared_runtime')) THEN
    RAISE EXCEPTION 'V511: đối tượng đích đã tồn tại, kiểm tra trước, không ghi đè';
  END IF;

  -- Đối tượng sẽ thay phải đúng bản đã đọc trên production.
  SELECT * INTO v_policy FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'auto_proxies' AND policyname = 'desktop_owned_resource';
  IF NOT FOUND
     OR v_policy.cmd <> 'ALL' OR v_policy.permissive <> 'RESTRICTIVE' OR v_policy.roles::text <> '{aka_agent_desktop}'
     OR v_policy.qual IS DISTINCT FROM '(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))'
     OR v_policy.with_check IS DISTINCT FROM '(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))' THEN
    RAISE EXCEPTION 'V511: policy desktop_owned_resource của auto_proxies khác bản đã đọc';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auto_proxies') <> 2 THEN
    RAISE EXCEPTION 'V511: auto_proxies có policy khác ngoài desktop_owned_resource và v435_existing_role_access';
  END IF;
  IF (SELECT pg_get_indexdef('public.auto_proxies_staff_name_unique'::regclass))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX auto_proxies_staff_name_unique ON public.auto_proxies USING btree (staff_id, lower(name)) WHERE (is_delete = false)' THEN
    RAISE EXCEPTION 'V511: index auto_proxies_staff_name_unique khác bản đã đọc';
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_desktop_data_context()'::regprocedure)) <> '1c661248ef952acb98ee2a2082cf8bf8' THEN
    RAISE EXCEPTION 'V511: private.aka_agent_desktop_data_context() khác bản đã đọc';
  END IF;
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN
    RAISE EXCEPTION 'V511: thiếu private.aka_agent_staff_scope_for_request()';
  END IF;

  -- Dữ liệu: luật mới không được làm hỏng dòng đang có.
  IF EXISTS (SELECT 1 FROM public.auto_proxies WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'V511: có proxy thiếu organization_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_proxies WHERE NOT is_delete
             GROUP BY organization_id, lower(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'V511: có tên proxy trùng trong một tổ chức, đổi tên trước';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_accounts a JOIN public.auto_proxies p ON p.id = a.proxy_id
             WHERE NOT COALESCE(a.is_delete, false)
               AND (p.organization_id IS DISTINCT FROM a.organization_id OR p.staff_id IS DISTINCT FROM a.staff_id)) THEN
    RAISE EXCEPTION 'V511: có tài khoản đang dùng proxy của nhân viên hoặc tổ chức khác';
  END IF;
END;
$preflight$;

-- 1. Cờ tổ chức. Hằng false là giá trị thiếu nhanh của PostgreSQL: không ghi lại dòng nào, không chạy trigger UPDATE
-- (đồng bộ đơn hàng CRM) của org_organization. Bật cho tổ chức là một UPDATE riêng sau khi apply.
ALTER TABLE public.org_organization
  ADD COLUMN web_proxy_management_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.org_organization.web_proxy_management_enabled IS
  'V511: bật trang Quản lý proxy theo tổ chức trên Web (akaAgentWebApp). Không ảnh hưởng phần mềm Desktop và app iOS.';

-- 2. Hạn dùng và ghi chú do khách nhập. Desktop chỉ có quyền INSERT/UPDATE theo cột cũ nên không ghi được hai cột này.
ALTER TABLE public.auto_proxies
  ADD COLUMN expires_on date,
  ADD COLUMN note text,
  ADD CONSTRAINT auto_proxies_note_length CHECK (note IS NULL OR char_length(note) <= 500);
COMMENT ON COLUMN public.auto_proxies.expires_on IS 'V511: ngày hết hạn theo giờ Việt Nam do khách nhập; NULL = chưa đặt hạn.';
COMMENT ON COLUMN public.auto_proxies.staff_id IS 'Nhân viên đã thêm proxy. Từ V511 proxy dùng chung trong tổ chức (organization_id).';

-- 3. Tên duy nhất trong tổ chức (chặt hơn bản cũ: một nhân viên chỉ thuộc một tổ chức).
DROP INDEX public.auto_proxies_staff_name_unique;
CREATE UNIQUE INDEX auto_proxies_org_name_unique ON public.auto_proxies (organization_id, lower(name)) WHERE is_delete = false;
CREATE INDEX idx_auto_proxies_org ON public.auto_proxies (organization_id) WHERE is_delete = false;

-- 4. Kết quả kiểm tra kết nối.
CREATE TABLE public.auto_proxy_checks (
  proxy_id bigint PRIMARY KEY REFERENCES public.auto_proxies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'failed', 'local')),
  checked_at timestamptz,
  last_ok_at timestamptz,
  failing_since timestamptz,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms BETWEEN 0 AND 600000),
  exit_ip text CHECK (exit_ip IS NULL OR char_length(exit_ip) <= 64),
  error_code text CHECK (error_code IS NULL OR error_code IN (
    'auth_failed', 'timeout', 'refused', 'dns_not_found', 'proxy_error', 'tls_error', 'unreachable',
    'local_address', 'ip_allowlist')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  requested_at timestamptz,
  bulk_requested_at timestamptz,
  endpoint_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_proxy_checks_next ON public.auto_proxy_checks (next_check_at);
COMMENT ON TABLE public.auto_proxy_checks IS
  'V511: kết quả kiểm tra kết nối proxy (một dòng mỗi proxy). Chỉ đọc/ghi qua aka_agent_control_proxies và aka_agent_proxy_check_worker.';
ALTER TABLE public.auto_proxy_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auto_proxy_checks FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

-- 5. Desktop đọc proxy của cả tổ chức (để chạy tài khoản gắn proxy đồng nghiệp thêm), chỉ ghi proxy của mình.
DROP POLICY desktop_owned_resource ON public.auto_proxies;
CREATE POLICY desktop_org_read ON public.auto_proxies AS RESTRICTIVE FOR SELECT TO aka_agent_desktop
  USING (organization_id = (SELECT ctx.organization_id FROM private.aka_agent_desktop_data_context() ctx));
CREATE POLICY desktop_owned_insert ON public.auto_proxies AS RESTRICTIVE FOR INSERT TO aka_agent_desktop
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY desktop_owned_update ON public.auto_proxies AS RESTRICTIVE FOR UPDATE TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY desktop_owned_delete ON public.auto_proxies AS RESTRICTIVE FOR DELETE TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));

-- 6. Cài đặt hệ thống.
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('proxies.check_mode', 'off',
   'V511: kiểm tra kết nối proxy hằng ngày trong API Web. off = không kiểm tra; shadow = kiểm tra, chỉ admin akaBiz thấy kết quả; on = khách thấy.',
   false, true),
  ('proxies.shared_runtime', '{"server":false,"desktopMinVersion":null}',
   'V511: phần mềm nào đã đọc proxy theo tổ chức. server=true sau khi cài App Server mới; desktopMinVersion = bản Desktop đầu tiên đọc theo tổ chức. Chưa bật thì không gắn được proxy do nhân viên khác thêm.',
   false, true);

-- 7. Hàm phụ.
CREATE FUNCTION private.aka_agent_proxy_endpoint_hash(p_protocol text, p_host text, p_port integer, p_username text, p_password text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT md5(concat_ws('|', COALESCE(p_protocol, ''), lower(COALESCE(p_host, '')), COALESCE(p_port::text, ''),
                       COALESCE(p_username, ''), COALESCE(p_password, '')));
$function$;

CREATE FUNCTION private.aka_agent_proxy_check_mode()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_value text;
BEGIN
  SELECT setting.value INTO v_value FROM public.auto_system_settings AS setting
  WHERE setting.key = 'proxies.check_mode' AND setting.is_active
  LIMIT 1;
  v_value := lower(btrim(btrim(COALESCE(v_value, '')), '"'));
  RETURN CASE WHEN v_value IN ('off', 'shadow', 'on') THEN v_value ELSE 'off' END;
END;
$function$;

-- Lượt kiểm tra hằng ngày kế tiếp: 06:00 giờ Việt Nam + 0–29 phút theo id (rải tải), cách lần này ít nhất 6 giờ.
CREATE FUNCTION private.aka_agent_proxy_next_daily(p_proxy_id bigint, p_now timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_local timestamp := p_now AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_next timestamp;
BEGIN
  v_next := date_trunc('day', v_local) + interval '6 hours' + make_interval(mins => (abs(p_proxy_id) % 30)::integer);
  IF v_next <= v_local + interval '6 hours' THEN
    v_next := v_next + interval '1 day';
  END IF;
  RETURN v_next AT TIME ZONE 'Asia/Ho_Chi_Minh';
END;
$function$;

CREATE FUNCTION private.aka_agent_proxy_parse_date(p_object jsonb, p_key text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_text text;
  v_date date;
BEGIN
  IF p_object IS NULL OR NOT (p_object ? p_key) OR jsonb_typeof(p_object -> p_key) = 'null' THEN
    RETURN NULL;
  END IF;
  v_text := p_object ->> p_key;
  IF jsonb_typeof(p_object -> p_key) <> 'string' OR v_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'proxy_invalid_expiry';
  END IF;
  BEGIN
    v_date := v_text::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'proxy_invalid_expiry';
  END;
  IF v_date < date '2020-01-01' OR v_date > date '2100-12-31' THEN
    RAISE EXCEPTION 'proxy_invalid_expiry';
  END IF;
  RETURN v_date;
END;
$function$;

CREATE FUNCTION private.aka_agent_proxy_positive_id(p_value jsonb)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}') !~ '^[1-9]\d{0,17}$' THEN
    RAISE EXCEPTION 'proxy_invalid_payload';
  END IF;
  RETURN (p_value #>> '{}')::bigint;
END;
$function$;

-- Danh sách id dương, không trùng, 1..p_max phần tử.
CREATE FUNCTION private.aka_agent_proxy_id_list(p_value jsonb, p_max integer)
RETURNS bigint[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_ids bigint[];
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) = 0
     OR jsonb_array_length(p_value) > p_max THEN
    RAISE EXCEPTION 'proxy_invalid_payload';
  END IF;
  SELECT array_agg(DISTINCT private.aka_agent_proxy_positive_id(item)) INTO v_ids
  FROM jsonb_array_elements(p_value) AS item;
  RETURN v_ids;
END;
$function$;

CREATE FUNCTION private.aka_agent_proxy_check_field(p_field text, p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    v_text := NULL;
  ELSIF p_field = 'port' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}') !~ '^\d{1,5}$'
       OR (p_value #>> '{}')::integer NOT BETWEEN 1 AND 65535 THEN
      RAISE EXCEPTION 'proxy_invalid_port';
    END IF;
    RETURN p_value #>> '{}';
  ELSIF jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION 'proxy_invalid_payload';
  ELSE
    v_text := p_value #>> '{}';
  END IF;

  IF p_field = 'name' THEN
    v_text := btrim(COALESCE(v_text, ''));
    IF v_text = '' OR char_length(v_text) > 250 THEN RAISE EXCEPTION 'proxy_invalid_name'; END IF;
  ELSIF p_field = 'protocol' THEN
    v_text := lower(btrim(COALESCE(v_text, '')));
    IF v_text NOT IN ('http', 'https', 'socks5') THEN RAISE EXCEPTION 'proxy_invalid_protocol'; END IF;
  ELSIF p_field = 'host' THEN
    v_text := lower(btrim(COALESCE(v_text, '')));
    IF v_text = '' OR char_length(v_text) > 253 OR v_text !~ '^[a-z0-9._-]+$' THEN RAISE EXCEPTION 'proxy_invalid_host'; END IF;
  ELSIF p_field = 'port' THEN
    RAISE EXCEPTION 'proxy_invalid_port';
  ELSIF p_field IN ('username', 'password') THEN
    v_text := CASE WHEN p_field = 'username' THEN NULLIF(btrim(COALESCE(v_text, '')), '') ELSE NULLIF(v_text, '') END;
    IF char_length(COALESCE(v_text, '')) > 255 THEN RAISE EXCEPTION 'proxy_invalid_credentials'; END IF;
  ELSIF p_field = 'note' THEN
    v_text := NULLIF(btrim(COALESCE(v_text, '')), '');
    IF char_length(COALESCE(v_text, '')) > 500 THEN RAISE EXCEPTION 'proxy_invalid_note'; END IF;
  ELSE
    RAISE EXCEPTION 'proxy_invalid_payload';
  END IF;
  RETURN v_text;
END;
$function$;

-- Phần mềm chạy tài khoản đã đọc proxy theo tổ chức chưa (để gắn proxy do nhân viên khác thêm).
-- Zalo Server: proxies.shared_runtime.server = true sau khi cài App Server mới.
-- Desktop: mọi máy của nhân viên hoạt động trong 30 ngày đều ≥ desktopMinVersion, và có ít nhất một máy.
CREATE FUNCTION private.aka_agent_proxy_shared_runtime_ready(p_staff_id bigint, p_server boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_raw text;
  v_config jsonb;
  v_min text;
  v_min_parts integer[];
BEGIN
  SELECT setting.value INTO v_raw FROM public.auto_system_settings AS setting
  WHERE setting.key = 'proxies.shared_runtime' AND setting.is_active
  LIMIT 1;
  BEGIN
    v_config := NULLIF(btrim(COALESCE(v_raw, '')), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_config IS NULL OR jsonb_typeof(v_config) <> 'object' THEN
    RETURN false;
  END IF;
  IF p_server THEN
    RETURN jsonb_typeof(v_config -> 'server') = 'boolean' AND (v_config ->> 'server')::boolean;
  END IF;
  v_min := v_config ->> 'desktopMinVersion';
  IF jsonb_typeof(v_config -> 'desktopMinVersion') IS DISTINCT FROM 'string'
     OR v_min !~ '^\d{1,6}(\.\d{1,6}){0,3}$' THEN
    RETURN false;
  END IF;
  v_min_parts := string_to_array(v_min, '.')::integer[];
  RETURN EXISTS (
      SELECT 1 FROM public.auto_staff_device_presence AS device
      WHERE device.staff_id = p_staff_id AND device.last_seen_at > now() - interval '30 days')
    AND NOT EXISTS (
      SELECT 1 FROM public.auto_staff_device_presence AS device
      WHERE device.staff_id = p_staff_id AND device.last_seen_at > now() - interval '30 days'
        AND (device.app_version IS NULL OR device.app_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$'
             OR string_to_array(device.app_version, '.')::integer[] < v_min_parts));
END;
$function$;

-- 8. Trigger: proxy phải cùng tổ chức; proxy của nhân viên khác chỉ gắn khi phần mềm chạy tài khoản đã sẵn sàng.
CREATE FUNCTION private.aka_agent_guard_account_proxy_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_owner bigint;
  v_org bigint;
  v_server boolean;
BEGIN
  IF NEW.proxy_id IS NULL OR COALESCE(NEW.is_delete, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.proxy_id IS NOT DISTINCT FROM OLD.proxy_id
     AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.flatform_type IS NOT DISTINCT FROM OLD.flatform_type
     AND NEW.is_zalo_server IS NOT DISTINCT FROM OLD.is_zalo_server
     AND NEW.is_zalo_show_web IS NOT DISTINCT FROM OLD.is_zalo_show_web
     AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete THEN
    RETURN NEW;
  END IF;
  SELECT proxy.staff_id, proxy.organization_id INTO v_owner, v_org
  FROM public.auto_proxies AS proxy WHERE proxy.id = NEW.proxy_id;
  IF NOT FOUND THEN
    RETURN NEW; -- FK và trg_lock_auto_account_control_resources báo lỗi proxy không tồn tại.
  END IF;
  IF v_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'proxy_wrong_organization';
  END IF;
  IF v_owner IS NOT DISTINCT FROM NEW.staff_id THEN
    RETURN NEW;
  END IF;
  v_server := lower(btrim(COALESCE(NEW.flatform_type, ''))) = 'zalo'
    AND COALESCE(NEW.is_zalo_server, false) AND NOT COALESCE(NEW.is_zalo_show_web, false);
  IF NOT private.aka_agent_proxy_shared_runtime_ready(NEW.staff_id, v_server) THEN
    RAISE EXCEPTION 'proxy_shared_runtime_not_ready'
      USING DETAIL = CASE WHEN v_server THEN 'server' ELSE 'desktop' END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_account_proxy_scope_guard
  BEFORE INSERT OR UPDATE OF proxy_id, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, is_delete
  ON public.auto_accounts
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_guard_account_proxy_scope();

-- Quyền hàm phần 1: schema private có USAGE cho anon/authenticated/aka_agent_desktop/aka_agent_chat_api, hàm mới mặc
-- định cho PUBLIC EXECUTE ⇒ thu hồi ngay trong giao dịch này.
REVOKE ALL ON FUNCTION private.aka_agent_proxy_endpoint_hash(text, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_check_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_next_daily(bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_parse_date(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_positive_id(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_id_list(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_check_field(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_shared_runtime_ready(bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_guard_account_proxy_scope() FROM PUBLIC;

DO $postflight$
DECLARE
  v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_organization'
                 AND column_name = 'web_proxy_management_enabled' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION 'V511 p1 postflight: thiếu cột cờ tổ chức';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_organization WHERE web_proxy_management_enabled) THEN
    RAISE EXCEPTION 'V511 p1 postflight: migration không được tự bật cờ cho tổ chức nào';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auto_proxies') <> 5 THEN
    RAISE EXCEPTION 'V511 p1 postflight: số policy của auto_proxies sai';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF has_table_privilege(v_role, 'public.auto_proxy_checks', 'SELECT')
       OR has_function_privilege(v_role, 'private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)', 'EXECUTE') THEN
      RAISE EXCEPTION 'V511 p1 postflight: % còn quyền trên đối tượng mới', v_role;
    END IF;
  END LOOP;
  IF private.aka_agent_proxy_check_mode() <> 'off'
     OR private.aka_agent_proxy_shared_runtime_ready(0, true) OR private.aka_agent_proxy_shared_runtime_ready(0, false) THEN
    RAISE EXCEPTION 'V511 p1 postflight: cài đặt mặc định sai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_accounts'::regclass
                 AND tgname = 'trg_account_proxy_scope_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'V511 p1 postflight: thiếu trigger trên auto_accounts';
  END IF;
END;
$postflight$;

COMMIT;
$v511_src$;
  v_body text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p1') THEN
    RAISE EXCEPTION 'Phần 1 đã chạy rồi, không chạy lại';
  END IF;
  IF md5(v_src) <> '61ffc263a23f1e1c56fcaafc728529f9' THEN
    RAISE EXCEPTION 'Nội dung dán bị thiếu hoặc sai (md5 %), chưa chạy gì; chép lại nguyên khối', md5(v_src);
  END IF;
  v_body := substr(v_src, strpos(v_src, E'\nBEGIN;\n') + 8);
  v_body := left(v_body, length(v_body) - length(E'COMMIT;\n'));
  EXECUTE v_body;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  SELECT to_char(greatest(clock_timestamp() AT TIME ZONE 'UTC',
                          max(to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp) + interval '1 second'),
                 'YYYYMMDDHH24MISS'), 'migration_v511_web_proxy_management_p1', ARRAY[v_src]
  FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{14}$';
END
$v511_run$;
COMMIT;
SELECT 'applied' AS status, version, name, md5(statements[1]) = '61ffc263a23f1e1c56fcaafc728529f9' AS md5_khop_file
FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p1';
