-- V509: quản lý proxy theo tổ chức trên Web (akaAgentWebApp, trang /proxies).
-- Nguồn: akachat cgjbsmqtfhqvttudyjzq, đọc 12/11/2026 (ledger mới nhất V508). Hợp đồng, rollout, gỡ: docs/WEB_PROXY_MANAGEMENT_V509.md.
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
    RAISE EXCEPTION 'V509 phải chạy bằng postgres';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v509_%') THEN
    RAISE EXCEPTION 'V509 đã có trong sổ migration, không chạy lại';
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
    RAISE EXCEPTION 'V509: đối tượng đích đã tồn tại, kiểm tra trước, không ghi đè';
  END IF;

  -- Đối tượng sẽ thay phải đúng bản đã đọc trên production.
  SELECT * INTO v_policy FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'auto_proxies' AND policyname = 'desktop_owned_resource';
  IF NOT FOUND
     OR v_policy.cmd <> 'ALL' OR v_policy.permissive <> 'RESTRICTIVE' OR v_policy.roles::text <> '{aka_agent_desktop}'
     OR v_policy.qual IS DISTINCT FROM '(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))'
     OR v_policy.with_check IS DISTINCT FROM '(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))' THEN
    RAISE EXCEPTION 'V509: policy desktop_owned_resource của auto_proxies khác bản đã đọc';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auto_proxies') <> 2 THEN
    RAISE EXCEPTION 'V509: auto_proxies có policy khác ngoài desktop_owned_resource và v435_existing_role_access';
  END IF;
  IF (SELECT pg_get_indexdef('public.auto_proxies_staff_name_unique'::regclass))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX auto_proxies_staff_name_unique ON public.auto_proxies USING btree (staff_id, lower(name)) WHERE (is_delete = false)' THEN
    RAISE EXCEPTION 'V509: index auto_proxies_staff_name_unique khác bản đã đọc';
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_desktop_data_context()'::regprocedure)) <> '1c661248ef952acb98ee2a2082cf8bf8' THEN
    RAISE EXCEPTION 'V509: private.aka_agent_desktop_data_context() khác bản đã đọc';
  END IF;
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN
    RAISE EXCEPTION 'V509: thiếu private.aka_agent_staff_scope_for_request()';
  END IF;

  -- Dữ liệu: luật mới không được làm hỏng dòng đang có.
  IF EXISTS (SELECT 1 FROM public.auto_proxies WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'V509: có proxy thiếu organization_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_proxies WHERE NOT is_delete
             GROUP BY organization_id, lower(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'V509: có tên proxy trùng trong một tổ chức, đổi tên trước';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_accounts a JOIN public.auto_proxies p ON p.id = a.proxy_id
             WHERE NOT COALESCE(a.is_delete, false)
               AND (p.organization_id IS DISTINCT FROM a.organization_id OR p.staff_id IS DISTINCT FROM a.staff_id)) THEN
    RAISE EXCEPTION 'V509: có tài khoản đang dùng proxy của nhân viên hoặc tổ chức khác';
  END IF;
END;
$preflight$;

-- 1. Cờ tổ chức. Hằng false là giá trị thiếu nhanh của PostgreSQL: không ghi lại dòng nào, không chạy trigger UPDATE
-- (đồng bộ đơn hàng CRM) của org_organization. Bật cho tổ chức là một UPDATE riêng sau khi apply.
ALTER TABLE public.org_organization
  ADD COLUMN web_proxy_management_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.org_organization.web_proxy_management_enabled IS
  'V509: bật trang Quản lý proxy theo tổ chức trên Web (akaAgentWebApp). Không ảnh hưởng phần mềm Desktop và app iOS.';

-- 2. Hạn dùng và ghi chú do khách nhập. Desktop chỉ có quyền INSERT/UPDATE theo cột cũ nên không ghi được hai cột này.
ALTER TABLE public.auto_proxies
  ADD COLUMN expires_on date,
  ADD COLUMN note text,
  ADD CONSTRAINT auto_proxies_note_length CHECK (note IS NULL OR char_length(note) <= 500);
COMMENT ON COLUMN public.auto_proxies.expires_on IS 'V509: ngày hết hạn theo giờ Việt Nam do khách nhập; NULL = chưa đặt hạn.';
COMMENT ON COLUMN public.auto_proxies.staff_id IS 'Nhân viên đã thêm proxy. Từ V509 proxy dùng chung trong tổ chức (organization_id).';

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
  'V509: kết quả kiểm tra kết nối proxy (một dòng mỗi proxy). Chỉ đọc/ghi qua aka_agent_control_proxies và aka_agent_proxy_check_worker.';
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
   'V509: kiểm tra kết nối proxy hằng ngày trong API Web. off = không kiểm tra; shadow = kiểm tra, chỉ admin akaBiz thấy kết quả; on = khách thấy.',
   false, true),
  ('proxies.shared_runtime', '{"server":false,"desktopMinVersion":null}',
   'V509: phần mềm nào đã đọc proxy theo tổ chức. server=true sau khi cài App Server mới; desktopMinVersion = bản Desktop đầu tiên đọc theo tổ chức. Chưa bật thì không gắn được proxy do nhân viên khác thêm.',
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

-- 9. JSON proxy cho Web: dùng chung giữa list/get/create/update. Không bao giờ trả mật khẩu.
CREATE FUNCTION private.aka_agent_proxy_list_json(p_org bigint, p_staff bigint, p_admin boolean, p_ids bigint[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH px AS (
    SELECT proxy.* FROM public.auto_proxies AS proxy
    WHERE proxy.organization_id = p_org AND NOT proxy.is_delete
      AND (p_ids IS NULL OR proxy.id = ANY (p_ids))
  ), acc AS (
    SELECT account.proxy_id, account.staff_id,
      (lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_server, false) AND NOT COALESCE(account.is_zalo_show_web, false)) AS is_server
    FROM public.auto_accounts AS account
    WHERE account.proxy_id IN (SELECT px.id FROM px) AND NOT COALESCE(account.is_delete, false)
  ), usage_counts AS (
    SELECT acc.proxy_id, count(*)::integer AS total,
      count(*) FILTER (WHERE acc.staff_id = p_staff)::integer AS mine,
      count(*) FILTER (WHERE acc.is_server)::integer AS server,
      count(*) FILTER (WHERE NOT acc.is_server)::integer AS desktop
    FROM acc GROUP BY acc.proxy_id
  ), other_staff AS (
    SELECT grouped.proxy_id,
      jsonb_agg(jsonb_build_object('staffId', grouped.staff_id,
          'name', COALESCE(NULLIF(btrim(staff.name), ''), 'Nhân viên #' || grouped.staff_id),
          'count', grouped.n) ORDER BY grouped.n DESC, grouped.staff_id) AS list
    FROM (SELECT acc.proxy_id, acc.staff_id, count(*)::integer AS n FROM acc
          WHERE acc.staff_id IS DISTINCT FROM p_staff GROUP BY acc.proxy_id, acc.staff_id) AS grouped
    LEFT JOIN public.org_staff AS staff ON staff.id = grouped.staff_id
    GROUP BY grouped.proxy_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', px.id, 'name', px.name, 'protocol', px.protocol, 'host', px.host, 'port', px.port,
      'username', NULLIF(px.username, ''), 'hasPassword', COALESCE(px.password, '') <> '',
      'isActive', px.is_active, 'expiresOn', px.expires_on, 'note', px.note,
      'ownerStaffId', px.staff_id,
      'ownerName', COALESCE(NULLIF(btrim(owner_staff.name), ''), 'Nhân viên #' || px.staff_id),
      'canManage', p_admin OR px.staff_id = p_staff,
      'endpointLocked', COALESCE(usage_counts.desktop, 0) > 0,
      'usage', jsonb_build_object('total', COALESCE(usage_counts.total, 0), 'mine', COALESCE(usage_counts.mine, 0),
        'server', COALESCE(usage_counts.server, 0), 'desktop', COALESCE(usage_counts.desktop, 0),
        'others', COALESCE(other_staff.list, '[]'::jsonb)),
      'check', CASE
        WHEN checks.proxy_id IS NULL OR checks.endpoint_hash IS DISTINCT FROM
             private.aka_agent_proxy_endpoint_hash(px.protocol, px.host, px.port, px.username, px.password)
        THEN jsonb_build_object('status', 'pending', 'checkedAt', NULL, 'lastOkAt', NULL, 'failingSince', NULL,
          'latencyMs', NULL, 'exitIp', NULL, 'errorCode', NULL)
        ELSE jsonb_build_object('status', checks.status, 'checkedAt', checks.checked_at, 'lastOkAt', checks.last_ok_at,
          'failingSince', CASE WHEN checks.status = 'failed' THEN checks.failing_since END,
          'latencyMs', CASE WHEN checks.status = 'ok' THEN checks.latency_ms END,
          'exitIp', CASE WHEN checks.status = 'ok' THEN checks.exit_ip END,
          'errorCode', CASE WHEN checks.status IN ('failed', 'local') THEN checks.error_code END)
      END,
      'createdAt', px.created_at, 'updatedAt', px.updated_at
    ) ORDER BY px.id), '[]'::jsonb)
  FROM px
  LEFT JOIN usage_counts ON usage_counts.proxy_id = px.id
  LEFT JOIN other_staff ON other_staff.proxy_id = px.id
  LEFT JOIN public.org_staff AS owner_staff ON owner_staff.id = px.staff_id
  LEFT JOIN public.auto_proxy_checks AS checks ON checks.proxy_id = px.id;
$function$;

-- Thêm một proxy (dùng cho create và create_many). Lỗi là mã proxy_* để API dịch.
CREATE FUNCTION private.aka_agent_proxy_insert(p_org bigint, p_staff bigint, p_item jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_name text;
  v_protocol text;
  v_host text;
  v_port integer;
  v_username text;
  v_password text;
  v_note text;
  v_expires date;
  v_id bigint;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_item) AS item_key(name)
      WHERE item_key.name NOT IN ('name', 'protocol', 'host', 'port', 'username', 'password', 'expiresOn', 'note')) THEN
    RAISE EXCEPTION 'proxy_invalid_payload';
  END IF;
  v_name := private.aka_agent_proxy_check_field('name', p_item -> 'name');
  v_protocol := private.aka_agent_proxy_check_field('protocol', COALESCE(p_item -> 'protocol', '"http"'::jsonb));
  v_host := private.aka_agent_proxy_check_field('host', p_item -> 'host');
  v_port := private.aka_agent_proxy_check_field('port', p_item -> 'port')::integer;
  IF v_port IS NULL THEN RAISE EXCEPTION 'proxy_invalid_port'; END IF;
  v_username := private.aka_agent_proxy_check_field('username', p_item -> 'username');
  v_password := private.aka_agent_proxy_check_field('password', p_item -> 'password');
  v_note := private.aka_agent_proxy_check_field('note', p_item -> 'note');
  v_expires := private.aka_agent_proxy_parse_date(p_item, 'expiresOn');

  IF EXISTS (SELECT 1 FROM public.auto_proxies AS proxy WHERE proxy.organization_id = p_org AND NOT proxy.is_delete
             AND lower(proxy.name) = lower(v_name)) THEN
    RAISE EXCEPTION 'proxy_name_taken';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_proxies AS proxy WHERE proxy.organization_id = p_org AND NOT proxy.is_delete
             AND lower(proxy.host) = v_host AND proxy.port = v_port
             AND COALESCE(proxy.username, '') = COALESCE(v_username, '')) THEN
    RAISE EXCEPTION 'proxy_duplicate';
  END IF;
  BEGIN
    INSERT INTO public.auto_proxies (name, protocol, host, port, username, password, staff_id, organization_id,
      is_active, is_delete, expires_on, note, created_at, updated_at)
    VALUES (v_name, v_protocol, v_host, v_port, v_username, v_password, p_staff, p_org,
      true, false, v_expires, v_note, now(), now())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'proxy_name_taken';
  END;
  INSERT INTO public.auto_proxy_checks (proxy_id, status, next_check_at, updated_at)
  VALUES (v_id, 'pending', now(), now());
  RETURN v_id;
END;
$function$;

-- 10. RPC cho Web (service_role). Mọi lệnh kiểm nhân viên còn hoạt động, đúng tổ chức và tổ chức đã bật cờ.
-- Quyền: xem/thêm/chọn/kiểm tra = mọi nhân viên của tổ chức; sửa/tắt/xoá/đặt hạn = người thêm hoặc quản trị tổ chức;
-- gỡ/chuyển proxy = chỉ tài khoản của chính mình. Lệnh check_now trả mật khẩu cho API để kiểm tra: API không được
-- chuyển giá trị đó ra trình duyệt.
CREATE FUNCTION public.aka_agent_control_proxies(
  p_staff_id bigint,
  p_organization_id bigint,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_admin boolean;
  v_enabled boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_mode text := private.aka_agent_proxy_check_mode();
  v_proxy public.auto_proxies%ROWTYPE;
  v_target public.auto_proxies%ROWTYPE;
  v_id bigint;
  v_ids bigint[];
  v_patch jsonb;
  v_expected timestamptz;
  v_name text;
  v_protocol text;
  v_host text;
  v_port integer;
  v_username text;
  v_password text;
  v_note text;
  v_expires date;
  v_active boolean;
  v_endpoint_changed boolean;
  v_desktop_usage integer;
  v_total_usage integer;
  v_done bigint[] := ARRAY[]::bigint[];
  v_forbidden bigint[] := ARRAY[]::bigint[];
  v_in_use bigint[] := ARRAY[]::bigint[];
  v_skipped jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index integer;
  v_add_days integer;
  v_set_expiry boolean;
  v_account record;
  v_count integer;
  v_wait integer;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
     OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'proxy_invalid_payload';
  END IF;
  SELECT (COALESCE(staff.is_admin, false) OR organization.staff_admin_id = staff.id),
         COALESCE(organization.web_proxy_management_enabled, false)
    INTO v_admin, v_enabled
  FROM public.org_staff AS staff
  JOIN public.org_organization AS organization ON organization.id = staff.organization_id
  WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id
    AND COALESCE(staff.is_active, false) AND staff.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proxy_staff_invalid';
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION 'proxy_management_disabled';
  END IF;

  IF p_action = 'list' THEN
    RETURN jsonb_build_object(
      'proxies', private.aka_agent_proxy_list_json(p_organization_id, p_staff_id, v_admin, NULL),
      'isOrgAdmin', v_admin, 'today', v_today, 'checkMode', v_mode);

  ELSIF p_action = 'get' THEN
    v_id := private.aka_agent_proxy_positive_id(v_payload -> 'proxyId');
    v_item := private.aka_agent_proxy_list_json(p_organization_id, p_staff_id, v_admin, ARRAY[v_id]) -> 0;
    IF v_item IS NULL THEN RAISE EXCEPTION 'proxy_not_found'; END IF;
    RETURN jsonb_build_object('proxy', v_item, 'isOrgAdmin', v_admin, 'today', v_today, 'checkMode', v_mode);

  ELSIF p_action = 'summary' THEN
    -- API ghép: attention = expiring + (khách thấy kết quả kiểm tra ? failedOnly : 0).
    SELECT count(*)::integer,
      count(*) FILTER (WHERE proxy.is_active AND proxy.expires_on IS NOT NULL AND proxy.expires_on <= v_today + 3)::integer,
      count(*) FILTER (WHERE proxy.is_active AND NOT (proxy.expires_on IS NOT NULL AND proxy.expires_on <= v_today + 3)
        AND checks.status = 'failed'
        AND checks.endpoint_hash IS NOT DISTINCT FROM
            private.aka_agent_proxy_endpoint_hash(proxy.protocol, proxy.host, proxy.port, proxy.username, proxy.password))::integer
      INTO v_count, v_total_usage, v_desktop_usage
    FROM public.auto_proxies AS proxy
    LEFT JOIN public.auto_proxy_checks AS checks ON checks.proxy_id = proxy.id
    WHERE proxy.organization_id = p_organization_id AND NOT proxy.is_delete;
    RETURN jsonb_build_object('total', v_count, 'expiring', v_total_usage, 'failedOnly', v_desktop_usage, 'checkMode', v_mode);

  ELSIF p_action = 'accounts' THEN
    v_id := private.aka_agent_proxy_positive_id(v_payload -> 'proxyId');
    IF NOT EXISTS (SELECT 1 FROM public.auto_proxies AS proxy WHERE proxy.id = v_id
                   AND proxy.organization_id = p_organization_id AND NOT proxy.is_delete) THEN
      RAISE EXCEPTION 'proxy_not_found';
    END IF;
    RETURN jsonb_build_object(
      'mine', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', account.id, 'name', account.name, 'platform', account.flatform_type,
          'runtime', CASE WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
              AND COALESCE(account.is_zalo_server, false) AND NOT COALESCE(account.is_zalo_show_web, false)
            THEN 'server' ELSE 'desktop' END,
          'status', account.status, 'loginStatus', account.login_status) ORDER BY account.name, account.id)
        FROM public.auto_accounts AS account
        WHERE account.proxy_id = v_id AND account.staff_id = p_staff_id
          AND account.organization_id = p_organization_id AND NOT COALESCE(account.is_delete, false)), '[]'::jsonb),
      'others', COALESCE((SELECT jsonb_agg(jsonb_build_object('staffId', grouped.staff_id,
          'name', COALESCE(NULLIF(btrim(staff.name), ''), 'Nhân viên #' || grouped.staff_id),
          'count', grouped.n) ORDER BY grouped.n DESC, grouped.staff_id)
        FROM (SELECT account.staff_id, count(*)::integer AS n FROM public.auto_accounts AS account
              WHERE account.proxy_id = v_id AND account.staff_id IS DISTINCT FROM p_staff_id
                AND NOT COALESCE(account.is_delete, false)
              GROUP BY account.staff_id) AS grouped
        LEFT JOIN public.org_staff AS staff ON staff.id = grouped.staff_id), '[]'::jsonb));

  ELSIF p_action = 'can_assign' THEN
    -- API hỏi trước khi tạo/sửa tài khoản: proxy gắn được cho tài khoản của nhân viên này không.
    v_id := private.aka_agent_proxy_positive_id(v_payload -> 'proxyId');
    IF jsonb_typeof(v_payload -> 'server') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'proxy_invalid_payload'; END IF;
    SELECT * INTO v_proxy FROM public.auto_proxies AS proxy
    WHERE proxy.id = v_id AND proxy.organization_id = p_organization_id AND NOT proxy.is_delete;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'proxy_not_found', 'ownProxy', false);
    END IF;
    IF NOT v_proxy.is_active THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'proxy_unavailable', 'ownProxy', v_proxy.staff_id = p_staff_id);
    END IF;
    IF v_proxy.staff_id = p_staff_id THEN
      RETURN jsonb_build_object('ok', true, 'reason', NULL, 'ownProxy', true);
    END IF;
    IF NOT private.aka_agent_proxy_shared_runtime_ready(p_staff_id, (v_payload ->> 'server')::boolean) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'proxy_shared_runtime_not_ready', 'ownProxy', false);
    END IF;
    RETURN jsonb_build_object('ok', true, 'reason', NULL, 'ownProxy', false);

  ELSIF p_action = 'create' THEN
    v_id := private.aka_agent_proxy_insert(p_organization_id, p_staff_id, v_payload -> 'proxy');
    RETURN jsonb_build_object('proxy', private.aka_agent_proxy_list_json(p_organization_id, p_staff_id, v_admin, ARRAY[v_id]) -> 0);

  ELSIF p_action = 'create_many' THEN
    IF jsonb_typeof(v_payload -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(v_payload -> 'items') = 0
       OR jsonb_array_length(v_payload -> 'items') > 200 THEN
      RAISE EXCEPTION 'proxy_invalid_payload';
    END IF;
    FOR v_item, v_index IN
      SELECT element.value, (element.ordinality - 1)::integer
      FROM jsonb_array_elements(v_payload -> 'items') WITH ORDINALITY AS element(value, ordinality)
    LOOP
      BEGIN
        v_done := v_done || private.aka_agent_proxy_insert(p_organization_id, p_staff_id, v_item);
      EXCEPTION WHEN raise_exception THEN
        v_skipped := v_skipped || jsonb_build_object('index', v_index,
          'reason', CASE WHEN SQLERRM = 'proxy_duplicate' THEN 'duplicate'
                         WHEN SQLERRM = 'proxy_name_taken' THEN 'name_taken' ELSE 'invalid' END,
          'existingName', CASE WHEN SQLERRM = 'proxy_duplicate' THEN (
            SELECT proxy.name FROM public.auto_proxies AS proxy
            WHERE proxy.organization_id = p_organization_id AND NOT proxy.is_delete
              AND lower(proxy.host) = lower(btrim(COALESCE(v_item ->> 'host', '')))
              AND proxy.port::text = COALESCE(v_item ->> 'port', '')
              AND COALESCE(proxy.username, '') = COALESCE(NULLIF(btrim(COALESCE(v_item ->> 'username', '')), ''), '')
            ORDER BY proxy.id LIMIT 1) END);
      END;
    END LOOP;
    RETURN jsonb_build_object('created', to_jsonb(v_done), 'skipped', v_skipped);

  ELSIF p_action = 'update' THEN
    v_id := private.aka_agent_proxy_positive_id(v_payload -> 'proxyId');
    v_patch := v_payload -> 'patch';
    IF v_patch IS NULL OR jsonb_typeof(v_patch) <> 'object' OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_patch) AS patch_key(name)
        WHERE patch_key.name NOT IN ('name', 'protocol', 'host', 'port', 'username', 'password', 'expiresOn', 'note', 'isActive')) THEN
      RAISE EXCEPTION 'proxy_invalid_payload';
    END IF;
    BEGIN
      v_expected := (v_payload ->> 'expectedUpdatedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'proxy_invalid_payload';
    END;
    IF v_expected IS NULL THEN RAISE EXCEPTION 'proxy_invalid_payload'; END IF;
    -- Cùng khoá với create_control_zalo_account_atomic và trigger gắn proxy cho tài khoản.
    PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-proxy:' || v_id::text, 0));
    SELECT * INTO v_proxy FROM public.auto_proxies AS proxy
    WHERE proxy.id = v_id AND proxy.organization_id = p_organization_id AND NOT proxy.is_delete
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'proxy_not_found'; END IF;
    IF NOT (v_admin OR v_proxy.staff_id = p_staff_id) THEN RAISE EXCEPTION 'proxy_forbidden'; END IF;
    IF v_proxy.updated_at IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'proxy_version_conflict'; END IF;

    v_name := CASE WHEN v_patch ? 'name' THEN private.aka_agent_proxy_check_field('name', v_patch -> 'name') ELSE v_proxy.name END;
    v_protocol := CASE WHEN v_patch ? 'protocol' THEN private.aka_agent_proxy_check_field('protocol', v_patch -> 'protocol') ELSE v_proxy.protocol END;
    v_host := CASE WHEN v_patch ? 'host' THEN private.aka_agent_proxy_check_field('host', v_patch -> 'host') ELSE v_proxy.host END;
    v_port := CASE WHEN v_patch ? 'port' THEN private.aka_agent_proxy_check_field('port', v_patch -> 'port')::integer ELSE v_proxy.port END;
    IF v_port IS NULL THEN RAISE EXCEPTION 'proxy_invalid_port'; END IF;
    v_username := CASE WHEN v_patch ? 'username' THEN private.aka_agent_proxy_check_field('username', v_patch -> 'username') ELSE v_proxy.username END;
    v_password := CASE WHEN v_patch ? 'password' THEN private.aka_agent_proxy_check_field('password', v_patch -> 'password') ELSE v_proxy.password END;
    v_note := CASE WHEN v_patch ? 'note' THEN private.aka_agent_proxy_check_field('note', v_patch -> 'note') ELSE v_proxy.note END;
    v_expires := CASE WHEN v_patch ? 'expiresOn' THEN private.aka_agent_proxy_parse_date(v_patch, 'expiresOn') ELSE v_proxy.expires_on END;
    IF v_patch ? 'isActive' THEN
      IF jsonb_typeof(v_patch -> 'isActive') <> 'boolean' THEN RAISE EXCEPTION 'proxy_invalid_payload'; END IF;
      v_active := (v_patch ->> 'isActive')::boolean;
    ELSE
      v_active := v_proxy.is_active;
    END IF;

    v_endpoint_changed := v_protocol IS DISTINCT FROM v_proxy.protocol OR lower(v_host) IS DISTINCT FROM lower(v_proxy.host)
      OR v_port IS DISTINCT FROM v_proxy.port OR COALESCE(v_username, '') IS DISTINCT FROM COALESCE(v_proxy.username, '')
      OR COALESCE(v_password, '') IS DISTINCT FROM COALESCE(v_proxy.password, '');
    SELECT count(*)::integer,
           count(*) FILTER (WHERE NOT (lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
             AND COALESCE(account.is_zalo_server, false) AND NOT COALESCE(account.is_zalo_show_web, false)))::integer
      INTO v_total_usage, v_desktop_usage
    FROM public.auto_accounts AS account
    WHERE account.proxy_id = v_id AND NOT COALESCE(account.is_delete, false);
    IF v_endpoint_changed AND v_desktop_usage > 0 THEN RAISE EXCEPTION 'proxy_endpoint_locked'; END IF;
    IF NOT v_active AND v_proxy.is_active AND v_total_usage > 0 THEN RAISE EXCEPTION 'proxy_in_use'; END IF;
    IF lower(v_name) IS DISTINCT FROM lower(v_proxy.name) AND EXISTS (
        SELECT 1 FROM public.auto_proxies AS proxy WHERE proxy.organization_id = p_organization_id
          AND NOT proxy.is_delete AND proxy.id <> v_id AND lower(proxy.name) = lower(v_name)) THEN
      RAISE EXCEPTION 'proxy_name_taken';
    END IF;
    IF (lower(v_host) IS DISTINCT FROM lower(v_proxy.host) OR v_port IS DISTINCT FROM v_proxy.port
        OR COALESCE(v_username, '') IS DISTINCT FROM COALESCE(v_proxy.username, '')) AND EXISTS (
        SELECT 1 FROM public.auto_proxies AS proxy WHERE proxy.organization_id = p_organization_id
          AND NOT proxy.is_delete AND proxy.id <> v_id AND lower(proxy.host) = lower(v_host)
          AND proxy.port = v_port AND COALESCE(proxy.username, '') = COALESCE(v_username, '')) THEN
      RAISE EXCEPTION 'proxy_duplicate';
    END IF;
    BEGIN
      UPDATE public.auto_proxies AS proxy SET
        name = v_name, protocol = v_protocol, host = v_host, port = v_port, username = v_username,
        password = v_password, note = v_note, expires_on = v_expires, is_active = v_active, updated_at = now()
      WHERE proxy.id = v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'proxy_name_taken';
    END;
    IF v_endpoint_changed OR (v_active AND NOT v_proxy.is_active) THEN
      INSERT INTO public.auto_proxy_checks AS checks (proxy_id, status, next_check_at, updated_at)
      VALUES (v_id, 'pending', now(), now())
      ON CONFLICT (proxy_id) DO UPDATE SET
        status = CASE WHEN v_endpoint_changed THEN 'pending' ELSE checks.status END,
        consecutive_failures = 0, failing_since = NULL, error_code = CASE WHEN v_endpoint_changed THEN NULL ELSE checks.error_code END,
        next_check_at = now(), lease_token = NULL, lease_until = NULL, updated_at = now();
    END IF;
    RETURN jsonb_build_object('proxy', private.aka_agent_proxy_list_json(p_organization_id, p_staff_id, v_admin, ARRAY[v_id]) -> 0);

  ELSIF p_action = 'set_expiry' THEN
    v_ids := private.aka_agent_proxy_id_list(v_payload -> 'proxyIds', 200);
    v_set_expiry := v_payload ? 'expiresOn';
    IF v_set_expiry = (v_payload ? 'addDays') THEN RAISE EXCEPTION 'proxy_invalid_payload'; END IF;
    IF v_set_expiry THEN
      v_expires := private.aka_agent_proxy_parse_date(v_payload, 'expiresOn');
    ELSE
      IF jsonb_typeof(v_payload -> 'addDays') <> 'number' OR (v_payload ->> 'addDays') !~ '^\d{1,4}$'
         OR (v_payload ->> 'addDays')::integer NOT BETWEEN 1 AND 3650 THEN
        RAISE EXCEPTION 'proxy_invalid_expiry';
      END IF;
      v_add_days := (v_payload ->> 'addDays')::integer;
    END IF;
    FOR v_proxy IN
      SELECT * FROM public.auto_proxies AS proxy
      WHERE proxy.id = ANY (v_ids) AND proxy.organization_id = p_organization_id AND NOT proxy.is_delete
      ORDER BY proxy.id FOR UPDATE
    LOOP
      IF NOT (v_admin OR v_proxy.staff_id = p_staff_id) THEN
        v_forbidden := v_forbidden || v_proxy.id;
        CONTINUE;
      END IF;
      UPDATE public.auto_proxies AS proxy SET
        expires_on = CASE WHEN v_set_expiry THEN v_expires
          ELSE (CASE WHEN proxy.expires_on IS NULL OR proxy.expires_on < v_today THEN v_today ELSE proxy.expires_on END) + v_add_days END,
        updated_at = now()
      WHERE proxy.id = v_proxy.id;
      v_done := v_done || v_proxy.id;
    END LOOP;
    -- Id không thuộc tổ chức hoặc đã xoá: báo như không có quyền, không lộ proxy của tổ chức khác.
    v_forbidden := v_forbidden || ARRAY(SELECT unnest(v_ids) EXCEPT SELECT unnest(v_done || v_forbidden));
    RETURN jsonb_build_object('updated', to_jsonb(v_done), 'forbidden', to_jsonb(v_forbidden), 'inUse', '[]'::jsonb);

  ELSIF p_action = 'delete' THEN
    v_ids := private.aka_agent_proxy_id_list(v_payload -> 'proxyIds', 200);
    FOR v_id IN SELECT unnest(v_ids) ORDER BY 1 LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-proxy:' || v_id::text, 0));
      SELECT * INTO v_proxy FROM public.auto_proxies AS proxy
      WHERE proxy.id = v_id AND proxy.organization_id = p_organization_id AND NOT proxy.is_delete
      FOR UPDATE;
      IF NOT FOUND OR NOT (v_admin OR v_proxy.staff_id = p_staff_id) THEN
        v_forbidden := v_forbidden || v_id;
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.auto_accounts AS account
                 WHERE account.proxy_id = v_id AND NOT COALESCE(account.is_delete, false)) THEN
        v_in_use := v_in_use || v_id;
        CONTINUE;
      END IF;
      UPDATE public.auto_proxies AS proxy SET is_delete = true, updated_at = now() WHERE proxy.id = v_id;
      v_done := v_done || v_id;
    END LOOP;
    RETURN jsonb_build_object('updated', to_jsonb(v_done), 'forbidden', to_jsonb(v_forbidden), 'inUse', to_jsonb(v_in_use));

  ELSIF p_action = 'reassign' THEN
    v_id := private.aka_agent_proxy_positive_id(v_payload -> 'fromProxyId');
    v_ids := private.aka_agent_proxy_id_list(v_payload -> 'accountIds', 500);
    IF NOT EXISTS (SELECT 1 FROM public.auto_proxies AS proxy WHERE proxy.id = v_id
                   AND proxy.organization_id = p_organization_id) THEN
      RAISE EXCEPTION 'proxy_not_found';
    END IF;
    IF jsonb_typeof(v_payload -> 'toProxyId') IS DISTINCT FROM 'null' AND v_payload ? 'toProxyId' THEN
      SELECT * INTO v_target FROM public.auto_proxies AS proxy
      WHERE proxy.id = private.aka_agent_proxy_positive_id(v_payload -> 'toProxyId')
        AND proxy.organization_id = p_organization_id AND NOT proxy.is_delete AND proxy.is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'proxy_unavailable'; END IF;
      IF v_target.id = v_id THEN RAISE EXCEPTION 'proxy_invalid_payload'; END IF;
    ELSIF NOT (v_payload ? 'toProxyId') THEN
      RAISE EXCEPTION 'proxy_invalid_payload';
    END IF;
    FOR v_account IN
      SELECT requested.id AS requested_id, account.id, account.status
      FROM unnest(v_ids) AS requested(id)
      LEFT JOIN public.auto_accounts AS account ON account.id = requested.id
        AND account.staff_id = p_staff_id AND account.organization_id = p_organization_id
        AND NOT COALESCE(account.is_delete, false) AND account.proxy_id = v_id
      ORDER BY requested.id
    LOOP
      IF v_account.id IS NULL THEN
        v_skipped := v_skipped || jsonb_build_object('accountId', v_account.requested_id, 'reason', 'not_found');
        CONTINUE;
      END IF;
      -- Đổi proxy giữa lượt chạy làm phiên đang hoạt động bị ngắt giữa chừng.
      SELECT account.status INTO v_account.status FROM public.auto_accounts AS account
      WHERE account.id = v_account.id FOR UPDATE;
      IF v_account.status = 'đang chạy' THEN
        v_skipped := v_skipped || jsonb_build_object('accountId', v_account.id, 'reason', 'running');
        CONTINUE;
      END IF;
      BEGIN
        UPDATE public.auto_accounts AS account SET proxy_id = v_target.id, updated_at = now()
        WHERE account.id = v_account.id AND account.proxy_id = v_id;
        v_done := v_done || v_account.id;
      EXCEPTION WHEN raise_exception THEN
        v_skipped := v_skipped || jsonb_build_object('accountId', v_account.id,
          'reason', CASE WHEN SQLERRM = 'proxy_shared_runtime_not_ready' THEN 'shared_runtime_not_ready' ELSE 'proxy_unavailable' END);
      END;
    END LOOP;
    RETURN jsonb_build_object('moved', to_jsonb(v_done), 'skipped', v_skipped);

  ELSIF p_action = 'check_now' THEN
    IF v_mode = 'off' THEN RAISE EXCEPTION 'proxy_check_disabled'; END IF;
    v_id := private.aka_agent_proxy_positive_id(v_payload -> 'proxyId');
    SELECT * INTO v_proxy FROM public.auto_proxies AS proxy
    WHERE proxy.id = v_id AND proxy.organization_id = p_organization_id AND NOT proxy.is_delete;
    IF NOT FOUND THEN RAISE EXCEPTION 'proxy_not_found'; END IF;
    IF NOT v_proxy.is_active THEN RAISE EXCEPTION 'proxy_unavailable'; END IF;
    INSERT INTO public.auto_proxy_checks AS checks (proxy_id, status, next_check_at, updated_at)
    VALUES (v_id, 'pending', now(), now())
    ON CONFLICT (proxy_id) DO NOTHING;
    SELECT CEIL(EXTRACT(EPOCH FROM (checks.requested_at + interval '30 seconds' - now())))::integer INTO v_wait
    FROM public.auto_proxy_checks AS checks WHERE checks.proxy_id = v_id FOR UPDATE;
    IF v_wait IS NOT NULL AND v_wait > 0 THEN
      RAISE EXCEPTION 'proxy_check_rate_limited' USING DETAIL = v_wait::text;
    END IF;
    UPDATE public.auto_proxy_checks AS checks SET requested_at = now(), updated_at = now() WHERE checks.proxy_id = v_id;
    RETURN jsonb_build_object('proxyId', v_id, 'mode', v_mode,
      'endpointHash', private.aka_agent_proxy_endpoint_hash(v_proxy.protocol, v_proxy.host, v_proxy.port, v_proxy.username, v_proxy.password),
      'protocol', v_proxy.protocol, 'host', v_proxy.host, 'port', v_proxy.port,
      'username', NULLIF(v_proxy.username, ''), 'password', NULLIF(v_proxy.password, ''));

  ELSIF p_action = 'check_all' THEN
    IF v_mode = 'off' THEN RAISE EXCEPTION 'proxy_check_disabled'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-proxy-check-all:' || p_organization_id::text, 0));
    SELECT CEIL(EXTRACT(EPOCH FROM (max(checks.bulk_requested_at) + interval '10 minutes' - now())))::integer INTO v_wait
    FROM public.auto_proxy_checks AS checks
    JOIN public.auto_proxies AS proxy ON proxy.id = checks.proxy_id
    WHERE proxy.organization_id = p_organization_id;
    IF v_wait IS NOT NULL AND v_wait > 0 THEN
      RETURN jsonb_build_object('queued', 0, 'retryAfterSeconds', v_wait);
    END IF;
    INSERT INTO public.auto_proxy_checks AS checks (proxy_id, status, next_check_at, bulk_requested_at, updated_at)
    SELECT proxy.id, 'pending', now(), now(), now() FROM public.auto_proxies AS proxy
    WHERE proxy.organization_id = p_organization_id AND NOT proxy.is_delete AND proxy.is_active
    ON CONFLICT (proxy_id) DO UPDATE SET next_check_at = now(), bulk_requested_at = now(), updated_at = now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('queued', v_count, 'retryAfterSeconds', 0);
  END IF;

  RAISE EXCEPTION 'proxy_invalid_action';
END;
$function$;

-- 11. RPC cho bộ kiểm tra trong API (service_role).
-- claim: nhận tối đa `limit` proxy tới hạn của tổ chức đã bật cờ, kèm mật khẩu để kết nối, giữ bằng lease.
-- report: ghi kết quả. Lần hỏng đầu của lượt hằng ngày chỉ hẹn thử lại sau 2 phút; hỏng lần hai (hoặc khách bấm
-- Kiểm tra) mới ghi 'failed'. Proxy bị sửa trong lúc kiểm tra (hash khác) thì bỏ kết quả và kiểm tra lại ngay.
CREATE FUNCTION public.aka_agent_proxy_check_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_mode text := private.aka_agent_proxy_check_mode();
  v_limit integer;
  v_lease integer;
  v_items jsonb;
  v_result jsonb;
  v_id bigint;
  v_proxy public.auto_proxies%ROWTYPE;
  v_check public.auto_proxy_checks%ROWTYPE;
  v_hash text;
  v_outcome text;
  v_manual boolean;
  v_error text;
  v_latency integer;
  v_exit_ip text;
  v_retry integer;
  v_failures integer;
  v_applied integer := 0;
  v_stale integer := 0;
BEGIN
  IF jsonb_typeof(v_payload) <> 'object' THEN RAISE EXCEPTION 'proxy_invalid_payload'; END IF;

  IF p_action = 'claim' THEN
    IF v_mode = 'off' THEN
      RETURN jsonb_build_object('mode', v_mode, 'items', '[]'::jsonb);
    END IF;
    v_limit := least(greatest(COALESCE(CASE WHEN (v_payload ->> 'limit') ~ '^\d{1,4}$' THEN (v_payload ->> 'limit')::integer END, 20), 1), 50);
    v_lease := least(greatest(COALESCE(CASE WHEN (v_payload ->> 'leaseSeconds') ~ '^\d{1,5}$' THEN (v_payload ->> 'leaseSeconds')::integer END, 180), 30), 600);
    -- Một lượt nhận tại một thời điểm, nên nhiều máy API không nhận trùng proxy.
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-proxy-check-claim', 0));
    WITH due AS (
      SELECT proxy.id, proxy.protocol, proxy.host, proxy.port, proxy.username, proxy.password,
        private.aka_agent_proxy_endpoint_hash(proxy.protocol, proxy.host, proxy.port, proxy.username, proxy.password) AS hash,
        checks.next_check_at
      FROM public.auto_proxies AS proxy
      JOIN public.org_organization AS organization
        ON organization.id = proxy.organization_id AND organization.web_proxy_management_enabled
      LEFT JOIN public.auto_proxy_checks AS checks ON checks.proxy_id = proxy.id
      WHERE NOT proxy.is_delete AND proxy.is_active
        -- Sửa proxy trên Web đặt next_check_at = now(); sửa trên Desktop thì danh sách hiện "Chưa kiểm tra" tới lượt kế tiếp.
        AND (checks.proxy_id IS NULL OR (
          checks.next_check_at <= now() AND (checks.lease_until IS NULL OR checks.lease_until < now())))
      ORDER BY checks.next_check_at NULLS FIRST, proxy.id
      LIMIT v_limit
    ), leased AS (
      INSERT INTO public.auto_proxy_checks AS checks (proxy_id, status, next_check_at, lease_token, lease_until, updated_at)
      SELECT due.id, 'pending', now(), gen_random_uuid(), now() + make_interval(secs => v_lease), now() FROM due
      ON CONFLICT (proxy_id) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until, updated_at = now()
      RETURNING checks.proxy_id, checks.lease_token
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('proxyId', due.id, 'leaseToken', leased.lease_token, 'endpointHash', due.hash,
        'protocol', due.protocol, 'host', due.host, 'port', due.port,
        'username', NULLIF(due.username, ''), 'password', NULLIF(due.password, ''))
      ORDER BY due.next_check_at NULLS FIRST, due.id), '[]'::jsonb)
      INTO v_items
    FROM due JOIN leased ON leased.proxy_id = due.id;
    RETURN jsonb_build_object('mode', v_mode, 'items', v_items);

  ELSIF p_action = 'report' THEN
    IF jsonb_typeof(v_payload -> 'results') IS DISTINCT FROM 'array' OR jsonb_array_length(v_payload -> 'results') > 200 THEN
      RAISE EXCEPTION 'proxy_invalid_payload';
    END IF;
    FOR v_result IN SELECT element FROM jsonb_array_elements(v_payload -> 'results') AS element LOOP
      IF jsonb_typeof(v_result) <> 'object' OR jsonb_typeof(v_result -> 'proxyId') <> 'number'
         OR (v_result ->> 'proxyId') !~ '^[1-9]\d{0,17}$'
         OR (v_result ->> 'outcome') NOT IN ('ok', 'failed', 'local', 'retry') THEN
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;
      v_id := (v_result ->> 'proxyId')::bigint;
      v_outcome := v_result ->> 'outcome';
      v_manual := jsonb_typeof(v_result -> 'manual') = 'boolean' AND (v_result ->> 'manual')::boolean;
      v_error := v_result ->> 'errorCode';
      IF v_error IS NOT NULL AND v_error NOT IN ('auth_failed', 'timeout', 'refused', 'dns_not_found', 'proxy_error',
          'tls_error', 'unreachable', 'local_address', 'ip_allowlist') THEN
        v_error := CASE WHEN v_outcome = 'local' THEN 'local_address' ELSE 'proxy_error' END;
      END IF;
      v_latency := CASE WHEN (v_result ->> 'latencyMs') ~ '^\d{1,6}$' THEN least((v_result ->> 'latencyMs')::integer, 600000) END;
      v_exit_ip := CASE WHEN char_length(COALESCE(v_result ->> 'exitIp', '')) BETWEEN 1 AND 64 THEN v_result ->> 'exitIp' END;
      v_retry := least(greatest(COALESCE(CASE WHEN (v_result ->> 'retryAfterSeconds') ~ '^\d{1,6}$'
        THEN (v_result ->> 'retryAfterSeconds')::integer END, 900), 60), 86400);

      SELECT * INTO v_proxy FROM public.auto_proxies AS proxy WHERE proxy.id = v_id AND NOT proxy.is_delete;
      IF NOT FOUND THEN
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.auto_proxy_checks (proxy_id, status, next_check_at, updated_at)
      VALUES (v_id, 'pending', now(), now()) ON CONFLICT (proxy_id) DO NOTHING;
      SELECT * INTO v_check FROM public.auto_proxy_checks AS checks WHERE checks.proxy_id = v_id FOR UPDATE;
      IF NOT v_manual AND v_check.lease_token IS DISTINCT FROM
         (CASE WHEN (v_result ->> 'leaseToken') ~ '^[0-9a-fA-F-]{36}$' THEN (v_result ->> 'leaseToken')::uuid END) THEN
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;
      v_hash := private.aka_agent_proxy_endpoint_hash(v_proxy.protocol, v_proxy.host, v_proxy.port, v_proxy.username, v_proxy.password);
      IF v_hash IS DISTINCT FROM v_result ->> 'endpointHash' THEN
        UPDATE public.auto_proxy_checks SET lease_token = NULL, lease_until = NULL, next_check_at = now(), updated_at = now()
        WHERE proxy_id = v_id;
        v_stale := v_stale + 1;
        CONTINUE;
      END IF;

      IF v_outcome = 'ok' THEN
        UPDATE public.auto_proxy_checks SET status = 'ok', checked_at = now(), last_ok_at = now(), failing_since = NULL,
          latency_ms = v_latency, exit_ip = v_exit_ip, error_code = NULL, consecutive_failures = 0,
          next_check_at = private.aka_agent_proxy_next_daily(v_id, now()), endpoint_hash = v_hash,
          lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      ELSIF v_outcome = 'local' THEN
        UPDATE public.auto_proxy_checks SET status = 'local', checked_at = now(), failing_since = NULL,
          latency_ms = NULL, exit_ip = NULL, error_code = COALESCE(v_error, 'local_address'), consecutive_failures = 0,
          next_check_at = private.aka_agent_proxy_next_daily(v_id, now()), endpoint_hash = v_hash,
          lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      ELSIF v_outcome = 'failed' THEN
        v_failures := CASE WHEN v_check.endpoint_hash IS NOT DISTINCT FROM v_hash THEN v_check.consecutive_failures ELSE 0 END + 1;
        UPDATE public.auto_proxy_checks SET
          status = CASE WHEN v_manual OR v_failures >= 2 THEN 'failed'
                        WHEN v_check.endpoint_hash IS NOT DISTINCT FROM v_hash THEN status ELSE 'pending' END,
          checked_at = now(),
          failing_since = CASE WHEN v_check.endpoint_hash IS NOT DISTINCT FROM v_hash THEN COALESCE(failing_since, now()) ELSE now() END,
          latency_ms = NULL, exit_ip = NULL, error_code = COALESCE(v_error, 'proxy_error'), consecutive_failures = v_failures,
          next_check_at = CASE WHEN v_manual OR v_failures >= 2 THEN private.aka_agent_proxy_next_daily(v_id, now())
                               ELSE now() + interval '2 minutes' END,
          endpoint_hash = v_hash, lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      ELSE
        UPDATE public.auto_proxy_checks SET next_check_at = now() + make_interval(secs => v_retry),
          lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE proxy_id = v_id;
      END IF;
      v_applied := v_applied + 1;
    END LOOP;
    RETURN jsonb_build_object('applied', v_applied, 'stale', v_stale);
  END IF;

  RAISE EXCEPTION 'proxy_invalid_action';
END;
$function$;

-- 12. Quyền: hàm public chỉ service_role; hàm private không cấp cho ai (gọi qua SECURITY DEFINER của postgres).
REVOKE ALL ON FUNCTION public.aka_agent_control_proxies(bigint, bigint, text, jsonb) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION public.aka_agent_proxy_check_worker(text, jsonb) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_proxies(bigint, bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_proxy_check_worker(text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_endpoint_hash(text, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_check_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_next_daily(bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_parse_date(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_positive_id(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_id_list(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_check_field(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_shared_runtime_ready(bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_guard_account_proxy_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_list_json(bigint, bigint, boolean, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_insert(bigint, bigint, jsonb) FROM PUBLIC;

-- 13. Postflight.
DO $postflight$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_organization'
                 AND column_name = 'web_proxy_management_enabled' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION 'V509 postflight: thiếu cột cờ tổ chức';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_organization WHERE web_proxy_management_enabled) THEN
    RAISE EXCEPTION 'V509 postflight: migration không được tự bật cờ cho tổ chức nào';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auto_proxies') <> 5 THEN
    RAISE EXCEPTION 'V509 postflight: số policy của auto_proxies sai';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    FOREACH v_fn IN ARRAY ARRAY['public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'public.aka_agent_proxy_check_worker(text,jsonb)'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'V509 postflight: % còn EXECUTE %', v_role, v_fn;
      END IF;
    END LOOP;
    IF has_table_privilege(v_role, 'public.auto_proxy_checks', 'SELECT') THEN
      RAISE EXCEPTION 'V509 postflight: % đọc được auto_proxy_checks', v_role;
    END IF;
    IF has_function_privilege(v_role, 'private.aka_agent_proxy_list_json(bigint,bigint,boolean,bigint[])', 'EXECUTE') THEN
      RAISE EXCEPTION 'V509 postflight: % còn EXECUTE hàm private', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_proxy_check_worker(text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V509 postflight: service_role thiếu EXECUTE';
  END IF;
  IF private.aka_agent_proxy_check_mode() <> 'off'
     OR private.aka_agent_proxy_shared_runtime_ready(0, true) OR private.aka_agent_proxy_shared_runtime_ready(0, false) THEN
    RAISE EXCEPTION 'V509 postflight: cài đặt mặc định sai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_accounts'::regclass
                 AND tgname = 'trg_account_proxy_scope_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'V509 postflight: thiếu trigger trên auto_accounts';
  END IF;
END;
$postflight$;

COMMIT;
