-- v476: Web/PWA và app iOS quản lý chiến dịch Facebook chạy trên app Desktop
-- (xem danh sách, panel chi tiết, tiến trình; dừng/tiếp tục; xoá khi app không giữ lượt).
-- Không tạo/sửa chiến dịch Facebook từ Web: RPC tạo/sửa/thêm data/đổi trạng thái dòng
-- vẫn từ chối tài khoản Facebook như cũ.
--
-- 1. Token phạm vi mới 'facebook' trong p_platforms (tài khoản auto_accounts.flatform_type
--    = 'facebook', luôn chạy trên app Desktop). Caller không gửi token này nhận kết quả
--    giống hệt trước: trang chiến dịch, snapshot tài khoản, tiến trình Desktop.
--    Trang chiến dịch coi Facebook là nơi chạy 'desktop' (lọc runtimeTargets).
--    Tiến trình Desktop trả accountType 'facebook'. Snapshot trả desktopPresence cả khi
--    phiên chỉ có token 'facebook'.
-- 2. Dừng/tiếp tục (aka_agent_control_set_desktop_campaign_status) và xoá
--    (delete_control_campaign_atomic) nhận chiến dịch Facebook với cùng luật Zalo Desktop:
--    dừng ghi DB ngay, app dừng sau mục tiêu đang xử lý; tiếp tục và xoá bị chặn khi
--    app còn giữ claim/unit lease (lease mồ côi khóa cổng bảo trì sau 00:00).
-- 3. Xác thực phiên Control trả thêm capabilities.facebook (gói sản phẩm 3/10 còn hạn theo
--    ngày Việt Nam) và web_facebook_campaigns (chính sách). Tổ chức chỉ có gói Facebook
--    vào Web/PWA/iOS chỉ khi chính sách bật rõ facebookOnlyLogin.
-- 4. Chính sách auto_system_settings 'web.facebook_campaigns', mặc định tắt.
--
-- Canonical ở repo akaAgent; repo WebApp không sao chép. Định nghĩa nguồn được kiểm bằng
-- md5 trước khi vá (6 hàm đang ở bản V461/V464 trên production); lệch bản live thì dừng.
-- CREATE OR REPLACE nên PostgREST nạp lại schema: chỉ apply ngoài giờ cao điểm.
-- Rollback: migrations/snapshots/web-facebook-campaigns-v476/rollback.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Chính sách bật tính năng (mặc định tắt; bật bằng cách sửa value, không cần deploy).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES (
  'web.facebook_campaigns',
  '{"enabled":false,"organizationIds":null,"facebookOnlyLogin":false}',
  'Web/PWA và app iOS quản lý chiến dịch Facebook chạy trên app Desktop (xem, dừng/tiếp tục, xoá; không tạo/sửa). enabled: bật tính năng; organizationIds: null = mọi tổ chức, mảng số = chỉ các tổ chức này; facebookOnlyLogin: cho tổ chức chỉ có gói Facebook (không Zalo/SMS) đăng nhập Web/PWA/iOS.',
  false,
  true
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.aka_agent_web_facebook_campaigns_policy(p_organization_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text;
  v_value jsonb;
  v_orgs jsonb;
  v_enabled boolean := false;
BEGIN
  IF p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RETURN jsonb_build_object('enabled', false, 'facebookOnlyLogin', false);
  END IF;
  SELECT setting.value INTO v_raw
  FROM public.auto_system_settings AS setting
  WHERE setting.key = 'web.facebook_campaigns'
    AND setting.is_active IS TRUE
    AND setting.is_secret IS NOT TRUE;
  -- Lỗi cấu hình luôn đóng tính năng, không làm hỏng xác thực.
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN jsonb_build_object('enabled', false, 'facebookOnlyLogin', false);
  END IF;
  v_value := v_raw::jsonb;
  IF jsonb_typeof(v_value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean' THEN
    RETURN jsonb_build_object('enabled', false, 'facebookOnlyLogin', false);
  END IF;
  v_enabled := (v_value->>'enabled')::boolean;
  v_orgs := v_value->'organizationIds';
  IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
    v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'facebookOnlyLogin', v_enabled
      AND jsonb_typeof(v_value->'facebookOnlyLogin') = 'boolean'
      AND (v_value->>'facebookOnlyLogin')::boolean
  );
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_web_facebook_campaigns_policy(bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_facebook_campaigns_policy(p_organization_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT private.aka_agent_web_facebook_campaigns_policy(p_organization_id)
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_web_facebook_campaigns_policy(bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_web_facebook_campaigns_policy(bigint) TO service_role;

-- 2. Vá định nghĩa live đã kiểm md5. Mỗi phép thay phải khớp đúng số lần.
CREATE OR REPLACE FUNCTION pg_temp.v476_replace(
  p_definition text, p_old text, p_new text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  v_count := (length(p_definition) - length(replace(p_definition, p_old, ''))) / greatest(length(p_old), 1);
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v476_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN replace(p_definition, p_old, p_new);
END
$helper$;

DO $migration$
DECLARE
  specs constant jsonb := $specs$[
    {"signature":"public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])",
     "source":"a2bc3f7cae264e647ac576c9895e840f","target":"367cf7ba9d72aff72c4907586cf1c3ba"},
    {"signature":"public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)",
     "source":"6b148777006903e4830925c55616820b","target":"db8942b09904e535987b94745b159ca3"},
    {"signature":"public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)",
     "source":"214999ca7a2830b2a0b85389a0325fbf","target":"6030f0d9c8429e36955a405920f751f9"},
    {"signature":"public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)",
     "source":"ea05f7ca98ceb9c8794c447abe79dc7c","target":"87f7002ac924f647896a7635663562b5"},
    {"signature":"public.delete_control_campaign_atomic(bigint,bigint,bigint)",
     "source":"4cfcad941c3acf22e674a77b203d086d","target":"2af929cc5e02683e5e9dc16a48cc9bac"},
    {"signature":"public.aka_agent_authenticate_control_session(text)",
     "source":"2c10aa78ac5e4ab8069c741b356e88c8","target":"692e2a068ce51377f6bd71fec20a8b0c"}
  ]$specs$::jsonb;
  r record;
  f oid;
  checksum text;
  d text;
  attrs jsonb;
  patched jsonb := '{}'::jsonb;
  mismatches text[] := ARRAY[]::text[];
  pending integer := 0;
BEGIN
  -- Preflight toàn bộ trước khi sửa hàm đầu tiên; giữ owner/security/config/ACL.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL THEN RAISE EXCEPTION 'v476_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source, r.target) THEN
      RAISE EXCEPTION 'v476_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION 'v476_unexpected_owner:%', r.signature;
    END IF;
  END LOOP;

  -- Dựng toàn bộ bản đích trước (chưa EXECUTE), kiểm md5 đích của mọi hàm cùng lúc.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    d := pg_get_functiondef(f);
    CONTINUE WHEN md5(d) = r.target;

    IF r.signature LIKE 'public.aka_agent_control_campaign_page(%' THEN
      d := pg_temp.v476_replace(d,
        '      CASE WHEN a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE THEN ''desktop'' ELSE ''web'' END AS runtime_target,',
        '      CASE WHEN a.flatform_type = ''facebook'' OR (a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE) THEN ''desktop'' ELSE ''web'' END AS runtime_target,',
        1, 'page_runtime_target');
      d := pg_temp.v476_replace(d,
        '      AND (a.flatform_type = ''sms'' OR (a.flatform_type = ''zalo'' AND ((''zalo'' = ANY(p_platforms)',
        '      AND (a.flatform_type = ''sms'' OR (a.flatform_type = ''facebook'' AND ''facebook'' = ANY(p_platforms)) OR (a.flatform_type = ''zalo'' AND ((''zalo'' = ANY(p_platforms)',
        1, 'page_scope');

    ELSIF r.signature LIKE 'public.aka_agent_control_account_snapshot(%' THEN
      d := pg_temp.v476_replace(d,
        'AND (a.flatform_type=''sms'' OR (a.flatform_type=''zalo'' AND ((''zalo''=ANY(p_platforms)',
        'AND (a.flatform_type=''sms'' OR (a.flatform_type=''facebook'' AND ''facebook''=ANY(p_platforms)) OR (a.flatform_type=''zalo'' AND ((''zalo''=ANY(p_platforms)',
        3, 'snapshot_scope');
      d := pg_temp.v476_replace(d,
        '  IF p_view IN (''accounts'',''campaigns'') AND p_platforms && ARRAY[''zalo_qr'',''zalo_web'']::text[] THEN',
        '  IF p_view IN (''accounts'',''campaigns'') AND p_platforms && ARRAY[''zalo_qr'',''zalo_web'',''facebook'']::text[] THEN',
        1, 'snapshot_presence');

    ELSIF r.signature LIKE 'public.aka_agent_control_desktop_activity(%' THEN
      d := pg_temp.v476_replace(d,
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'']::text[]) THEN',
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'', ''facebook'']::text[]) THEN',
        1, 'activity_gate');
      d := pg_temp.v476_replace(d,
        '    SELECT c.id, c.name, c.account_id, a.name AS account_name, a.is_zalo_show_web IS TRUE AS is_browser' || E'\n',
        '    SELECT c.id, c.name, c.account_id, a.name AS account_name, a.is_zalo_show_web IS TRUE AS is_browser,' || E'\n'
        || '      a.flatform_type = ''facebook'' AS is_facebook' || E'\n',
        1, 'activity_columns');
      d := pg_temp.v476_replace(d,
        '      AND a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE' || E'\n'
        || '      AND ((''zalo_qr'' = ANY(p_platforms) AND a.is_zalo_show_web IS NOT TRUE)' || E'\n'
        || '        OR (''zalo_web'' = ANY(p_platforms) AND a.is_zalo_show_web IS TRUE))' || E'\n',
        '      AND ((a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE' || E'\n'
        || '      AND ((''zalo_qr'' = ANY(p_platforms) AND a.is_zalo_show_web IS NOT TRUE)' || E'\n'
        || '        OR (''zalo_web'' = ANY(p_platforms) AND a.is_zalo_show_web IS TRUE)))' || E'\n'
        || '        OR (''facebook'' = ANY(p_platforms) AND a.flatform_type = ''facebook''))' || E'\n',
        1, 'activity_scope');
      d := pg_temp.v476_replace(d,
        '      ''accountType'', CASE WHEN s.is_browser THEN ''zalo_browser'' ELSE ''zalo_qr'' END,',
        '      ''accountType'', CASE WHEN s.is_facebook THEN ''facebook'' WHEN s.is_browser THEN ''zalo_browser'' ELSE ''zalo_qr'' END,',
        1, 'activity_account_type');

    ELSIF r.signature LIKE 'public.aka_agent_control_set_desktop_campaign_status(%' THEN
      -- Chiến dịch Facebook cũng chạy trên app Desktop: cùng luật dừng ở ranh giới/lease.
      d := pg_temp.v476_replace(d,
        '    AND account.flatform_type = ''zalo''' || E'\n'
        || '    AND COALESCE(account.is_zalo_server, false) = false' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        '    AND (account.flatform_type = ''facebook''' || E'\n'
        || '      OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        1, 'status_scope');

    ELSIF r.signature LIKE 'public.delete_control_campaign_atomic(%' THEN
      d := pg_temp.v476_replace(d,
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR account.flatform_type = ''facebook''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        2, 'delete_scope');
      d := pg_temp.v476_replace(d,
        '      AND account.flatform_type = ''zalo''' || E'\n'
        || '      AND COALESCE(account.is_zalo_server, false) = false' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        '      AND (account.flatform_type = ''facebook''' || E'\n'
        || '        OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        1, 'delete_desktop_lease');

    ELSIF r.signature LIKE 'public.aka_agent_authenticate_control_session(%' THEN
      d := pg_temp.v476_replace(d,
        '  v_web_desktop_policy jsonb := ''{}''::jsonb;' || E'\n',
        '  v_web_desktop_policy jsonb := ''{}''::jsonb;' || E'\n'
        || '  v_facebook_enabled boolean := false;' || E'\n'
        || '  v_web_facebook_policy jsonb := ''{}''::jsonb;' || E'\n',
        1, 'session_declare');
      -- Cùng luật gói còn hạn như SMS: chưa xoá, hạn tới hết ngày Việt Nam.
      d := pg_temp.v476_replace(d,
        '  v_sms_enabled := v_sms_package.id IS NOT NULL;' || E'\n',
        '  v_sms_enabled := v_sms_package.id IS NOT NULL;' || E'\n'
        || '  v_facebook_enabled := EXISTS (' || E'\n'
        || '    SELECT 1 FROM public.org_organization_product AS entitlement' || E'\n'
        || '    WHERE entitlement.organization_id = v_staff.organization_id' || E'\n'
        || '      AND entitlement.is_deleted = false' || E'\n'
        || '      AND entitlement.product_id IN (3, 10)' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n',
        1, 'session_facebook');
      d := pg_temp.v476_replace(d,
        '  v_web_desktop_policy := private.aka_agent_web_desktop_accounts_policy(v_staff.organization_id);' || E'\n',
        '  v_web_desktop_policy := private.aka_agent_web_desktop_accounts_policy(v_staff.organization_id);' || E'\n'
        || '  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);' || E'\n',
        1, 'session_policy');
      d := pg_temp.v476_replace(d,
        '    AND COALESCE((v_web_desktop_policy->>''desktopOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        '    AND COALESCE((v_web_desktop_policy->>''desktopOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) AND NOT (' || E'\n'
        || '    -- Tổ chức chỉ có gói Facebook (chạy trên app Desktop) vào Web/PWA/iOS khi chính sách bật rõ facebookOnlyLogin.' || E'\n'
        || '    v_facebook_enabled' || E'\n'
        || '    AND v_session.client_type IN (''web'', ''pwa'', ''native'')' || E'\n'
        || '    AND COALESCE((v_web_facebook_policy->>''facebookOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        1, 'session_gate');
      d := pg_temp.v476_replace(d,
        '      ''sms'', v_sms_enabled' || E'\n' || '    ),' || E'\n',
        '      ''sms'', v_sms_enabled,' || E'\n' || '      ''facebook'', v_facebook_enabled' || E'\n' || '    ),' || E'\n',
        1, 'session_capabilities');
      d := pg_temp.v476_replace(d,
        '    ''web_desktop_accounts'', v_web_desktop_policy,' || E'\n',
        '    ''web_desktop_accounts'', v_web_desktop_policy,' || E'\n'
        || '    ''web_facebook_campaigns'', v_web_facebook_policy,' || E'\n',
        1, 'session_output');
    END IF;

    IF md5(d) IS DISTINCT FROM r.target THEN
      mismatches := mismatches || (r.signature || '=' || md5(d));
    END IF;
    patched := patched || jsonb_build_object(r.signature, d);
    pending := pending + 1;
  END LOOP;
  IF cardinality(mismatches) > 0 THEN
    RAISE EXCEPTION 'v476_target_checksum_mismatch:%', array_to_string(mismatches, ' ');
  END IF;
  -- v476:apply-begin (scripts/build-v476-sql.py thay đoạn tới apply-end trong script so sánh chỉ đọc)
  IF pending = 0 THEN
    RAISE NOTICE 'v476 đã được apply trước đó; không đổi gì.';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    CONTINUE WHEN NOT patched ? r.signature;
    f := to_regprocedure(r.signature);
    SELECT jsonb_build_object('secdef', p.prosecdef, 'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text)
    INTO attrs FROM pg_proc p WHERE p.oid = f;
    EXECUTE patched->>r.signature;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid = f
        AND jsonb_build_object('secdef', p.prosecdef, 'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text) = attrs
    ) THEN
      RAISE EXCEPTION 'v476_attributes_changed:%', r.signature;
    END IF;
  END LOOP;

  -- Postflight: mọi hàm ở bản đích; hàm Control mới chỉ service_role, helper private chỉ owner.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.signature))) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v476_postflight_failed:%', r.signature;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE')
    OR has_function_privilege('aka_agent_chat_api', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE')
    OR has_function_privilege('anon', 'private.aka_agent_web_facebook_campaigns_policy(bigint)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.aka_agent_web_facebook_campaigns_policy(bigint)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.aka_agent_web_facebook_campaigns_policy(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v476_unexpected_new_function_acl';
  END IF;
  -- v476:apply-end
END
$migration$;

-- Không reload schema thủ công: giữ cơ chế event trigger DDL hiện có.
COMMIT;
