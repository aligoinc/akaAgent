-- V511 phần 2/3: ÁP BẰNG SUPABASE SQL EDITOR, MỘT LẦN DÁN (bước 2/3).
-- Sinh bằng scripts/build-v511-guarded-apply-sql.py; đừng sửa tay. Production akachat (cgjbsmqtfhqvttudyjzq).
-- Thứ tự: p1 -> p2 -> p3, ngoài giờ cao điểm. KHÔNG bật cờ tổ chức nào (postflight p1 từ chối nếu có tổ chức bật).
-- Một giao dịch: chốt sổ migration -> nguyên văn migrations/migration_v511_web_proxy_management_p2.sql (md5 b2b7b4c2f6c77a45606d655aceb3ddec, gồm kiểm tra trước/sau)
-- -> ghi sổ migration đúng nội dung file -> COMMIT. Kiểm nào không đạt thì báo lỗi và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có status = 'applied' và md5_khop_file = true.
-- V511 phần 2/3: RPC quản lý proxy theo tổ chức cho Web (aka_agent_control_proxies). Cần phần 1; phần 3 thêm RPC
-- cho bộ kiểm tra trong API. Hợp đồng, rollout, gỡ: docs/WEB_PROXY_MANAGEMENT_V511.md.
BEGIN;
DO $aka_guarded_ledger_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p2') THEN
    RAISE EXCEPTION 'migration_v511_web_proxy_management_p2: đã có trong sổ migration, không chạy lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p1') THEN
    RAISE EXCEPTION 'migration_v511_web_proxy_management_p2: chưa thấy migration_v511_web_proxy_management_p1 trong sổ migration; dán đúng thứ tự';
  END IF;
END
$aka_guarded_ledger_guard$;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'V511 phải chạy bằng postgres';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p2') THEN
    RAISE EXCEPTION 'V511 phần 2 đã có trong sổ migration, không chạy lại';
  END IF;
  -- Phần 1 phải xong: đủ bảng, trigger, hàm phụ mà phần 2 dùng.
  IF to_regclass('public.auto_proxy_checks') IS NULL
     OR to_regprocedure('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)') IS NULL
     OR to_regprocedure('private.aka_agent_proxy_check_field(text,jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_accounts'::regclass AND tgname = 'trg_account_proxy_scope_guard') THEN
    RAISE EXCEPTION 'V511 phần 2: chưa apply phần 1';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE (n.nspname = 'public' AND p.proname IN ('aka_agent_control_proxies', 'aka_agent_proxy_check_worker'))
                OR (n.nspname = 'private' AND p.proname IN ('aka_agent_proxy_list_json', 'aka_agent_proxy_insert'))) THEN
    RAISE EXCEPTION 'V511 phần 2: đối tượng đích đã tồn tại, kiểm tra trước, không ghi đè';
  END IF;
END;
$preflight$;

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

-- 12. Quyền: hàm public chỉ service_role; hàm private không cấp cho ai (gọi qua SECURITY DEFINER của postgres).
REVOKE ALL ON FUNCTION public.aka_agent_control_proxies(bigint, bigint, text, jsonb) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_proxies(bigint, bigint, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_list_json(bigint, bigint, boolean, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_insert(bigint, bigint, jsonb) FROM PUBLIC;

DO $postflight$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF has_function_privilege(v_role, 'public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'EXECUTE')
       OR has_function_privilege(v_role, 'private.aka_agent_proxy_list_json(bigint,bigint,boolean,bigint[])', 'EXECUTE')
       OR has_function_privilege(v_role, 'private.aka_agent_proxy_insert(bigint,bigint,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'V511 p2 postflight: % còn EXECUTE hàm mới', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V511 p2 postflight: service_role thiếu EXECUTE';
  END IF;
END;
$postflight$;


-- ===== Ghi sổ migration (cùng giao dịch): statements[1] = nguyên văn migrations/migration_v511_web_proxy_management_p2.sql =====
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT to_char(greatest(clock_timestamp() AT TIME ZONE 'UTC',
                        max(to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp) + interval '1 second'),
               'YYYYMMDDHH24MISS'), 'migration_v511_web_proxy_management_p2', ARRAY[$aka_ledger_src_v511_web_proxy_management_p2$-- V511 phần 2/3: RPC quản lý proxy theo tổ chức cho Web (aka_agent_control_proxies). Cần phần 1; phần 3 thêm RPC
-- cho bộ kiểm tra trong API. Hợp đồng, rollout, gỡ: docs/WEB_PROXY_MANAGEMENT_V511.md.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'V511 phải chạy bằng postgres';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p2') THEN
    RAISE EXCEPTION 'V511 phần 2 đã có trong sổ migration, không chạy lại';
  END IF;
  -- Phần 1 phải xong: đủ bảng, trigger, hàm phụ mà phần 2 dùng.
  IF to_regclass('public.auto_proxy_checks') IS NULL
     OR to_regprocedure('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)') IS NULL
     OR to_regprocedure('private.aka_agent_proxy_check_field(text,jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_accounts'::regclass AND tgname = 'trg_account_proxy_scope_guard') THEN
    RAISE EXCEPTION 'V511 phần 2: chưa apply phần 1';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE (n.nspname = 'public' AND p.proname IN ('aka_agent_control_proxies', 'aka_agent_proxy_check_worker'))
                OR (n.nspname = 'private' AND p.proname IN ('aka_agent_proxy_list_json', 'aka_agent_proxy_insert'))) THEN
    RAISE EXCEPTION 'V511 phần 2: đối tượng đích đã tồn tại, kiểm tra trước, không ghi đè';
  END IF;
END;
$preflight$;

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

-- 12. Quyền: hàm public chỉ service_role; hàm private không cấp cho ai (gọi qua SECURITY DEFINER của postgres).
REVOKE ALL ON FUNCTION public.aka_agent_control_proxies(bigint, bigint, text, jsonb) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_proxies(bigint, bigint, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_list_json(bigint, bigint, boolean, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_proxy_insert(bigint, bigint, jsonb) FROM PUBLIC;

DO $postflight$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF has_function_privilege(v_role, 'public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'EXECUTE')
       OR has_function_privilege(v_role, 'private.aka_agent_proxy_list_json(bigint,bigint,boolean,bigint[])', 'EXECUTE')
       OR has_function_privilege(v_role, 'private.aka_agent_proxy_insert(bigint,bigint,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'V511 p2 postflight: % còn EXECUTE hàm mới', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_control_proxies(bigint,bigint,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V511 p2 postflight: service_role thiếu EXECUTE';
  END IF;
END;
$postflight$;

COMMIT;
$aka_ledger_src_v511_web_proxy_management_p2$]
FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{14}$';

DO $aka_guarded_ledger_check$
BEGIN
  IF (SELECT md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE name = 'migration_v511_web_proxy_management_p2')
     IS DISTINCT FROM 'b2b7b4c2f6c77a45606d655aceb3ddec' THEN
    RAISE EXCEPTION 'migration_v511_web_proxy_management_p2: md5 sổ migration không khớp file';
  END IF;
END
$aka_guarded_ledger_check$;

COMMIT;

SELECT 'applied' AS status, version, name, md5(statements[1]) AS ledger_md5,
       md5(statements[1]) = 'b2b7b4c2f6c77a45606d655aceb3ddec' AS md5_khop_file,
       to_char((make_timestamp(substr(version, 1, 4)::int, substr(version, 5, 2)::int, substr(version, 7, 2)::int,
                               substr(version, 9, 2)::int, substr(version, 11, 2)::int, substr(version, 13, 2)::numeric)
                AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI:SS') AS gio_vn
FROM supabase_migrations.schema_migrations
WHERE name = 'migration_v511_web_proxy_management_p2';
