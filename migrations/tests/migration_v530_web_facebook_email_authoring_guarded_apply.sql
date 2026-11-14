-- v530 ÁP BẰNG SUPABASE SQL EDITOR — MỘT LẦN DÁN. File sinh tự động bởi
-- scripts/build-v530-sql.py; đừng sửa tay.
-- Một giao dịch: so sánh chỉ đọc → chốt chặn → migration v530 → ghi lịch sử migration.
-- Kiểm nào không đạt thì báo lỗi 'v530_...' và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có dòng cuối 'applied'. Chỉ chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL statement_timeout = '110s';

-- Đã apply rồi thì dừng ngay, không chạy lại.
DO $preguard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v530_web_facebook_email_authoring')
     OR to_regprocedure('public.aka_agent_control_web_email_campaigns_policy(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'v530_guard_failed: v530 đã được apply trước đó, không chạy lại';
  END IF;
END
$preguard$;

CREATE TEMP TABLE IF NOT EXISTS v530_cmp (
  seq bigserial, check_name text, staff_id bigint, organization_id bigint,
  ok boolean, old_ms numeric, new_ms numeric, detail text
);
TRUNCATE v530_cmp;

DO $preflight$
DECLARE
  r record;
  f oid;
BEGIN
  FOR r IN SELECT * FROM jsonb_to_recordset($new_functions$[
    {"signature":"private.aka_agent_web_email_campaigns_policy(bigint)","target":"2d131332e8d0fa54b4669f51a8fe92d8"},
    {"signature":"public.aka_agent_control_web_email_campaigns_policy(bigint)","target":"70616ad6489372725cca33b09da41852"},
    {"signature":"private.aka_agent_control_assert_campaign_inputs(text,jsonb)","target":"80972291d75cec5383aab3a28838b7b6"},
    {"signature":"private.aka_agent_control_assert_secondary_account(bigint,bigint,text,text,bigint,bigint)","target":"fa594cff527fcf2f553c9f376d67dc41"},
    {"signature":"private.aka_agent_control_normalize_email_session(jsonb,text)","target":"7068bce7f45562f1f4ebcb2fb902a89b"},
    {"signature":"private.aka_agent_control_email_account_view(public.auto_accounts)","target":"c6c2b3218cf5946c7d4fa3cc23d0f429"},
    {"signature":"public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)","target":"496a0182daaa9c944119a9744fcf41eb"},
    {"signature":"public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)","target":"6f0f9fefac37de258d34c55deebd2cfd"},
    {"signature":"public.delete_control_email_account_atomic(bigint,bigint,bigint)","target":"b912bdab82a4669569b184e46f166da0"},
    {"signature":"public.aka_agent_control_email_account_session(bigint,bigint,bigint)","target":"2ee2b490a2f9224a9d8ac63a1683040f"},
    {"signature":"public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)","target":"84182eb3960fd1952037e80e183036fa"},
    {"signature":"public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])","target":"2e3bf66477ad78cf90eba64e1626e8d2"}
  ]$new_functions$::jsonb) AS x(signature text, target text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NOT NULL AND md5(pg_get_functiondef(f)) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v530_unexpected_existing_function:%:%', r.signature, md5(pg_get_functiondef(f));
    END IF;
  END LOOP;
  IF to_regclass('public.auto_staff_device_presence') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass
      AND attname = 'secondary_account_id' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_accounts'::regclass
      AND attname = 'email_session_last_error' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_account_groups'::regclass
      AND attname = 'flatform_type' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaign_actions'::regclass
      AND attname = 'allow_secondary_account' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v530_schema_missing';
  END IF;
  -- RPC ghi từng khoá của Desktop là SECURITY INVOKER: phiên Desktop phải có sẵn quyền cột cần dùng.
  IF NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'UPDATE')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'UPDATE')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'SELECT')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'SELECT')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'v530_desktop_column_privileges_missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION pg_temp.v530_replace(
  p_definition text, p_old text, p_new text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  v_count := (length(p_definition) - length(replace(p_definition, p_old, ''))) / greatest(length(p_old), 1);
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v530_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN replace(p_definition, p_old, p_new);
END
$helper$;

DO $migration$
DECLARE
  specs constant jsonb := $specs$[
    {"signature":"private.aka_agent_web_facebook_campaigns_policy(bigint)",
     "source":"592f487518ef14f3bef6f0c7177f2ab5","target":"a49d994aa8f5847a0ccd35e4017504f1"},
    {"signature":"public.aka_agent_authenticate_control_session(text)",
     "source":"692e2a068ce51377f6bd71fec20a8b0c","target":"8012506f60ad1f00aab2b60f7bbec48c"},
    {"signature":"public.aka_agent_authenticate_control_session_chat_v2(text)",
     "source":"61e874b9b47b827d78e16c71bc9ef687","target":"e481b2473aa9dda34f91092b98ffdfbe"},
    {"signature":"public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])",
     "source":"367cf7ba9d72aff72c4907586cf1c3ba","target":"719fcf458eabe2b16fe536de07079c77"},
    {"signature":"public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)",
     "source":"db8942b09904e535987b94745b159ca3","target":"fac3ecfdf45dff239c319656a7365a7c"},
    {"signature":"public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)",
     "source":"6030f0d9c8429e36955a405920f751f9","target":"ed7f9d447f72019feca71d717fd4e1bd"},
    {"signature":"public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)",
     "source":"87f7002ac924f647896a7635663562b5","target":"2d3fbc42cc31e57138cdc99554af9254"},
    {"signature":"public.delete_control_campaign_atomic(bigint,bigint,bigint)",
     "source":"2af929cc5e02683e5e9dc16a48cc9bac","target":"2ede03119ec482102e1647c0b1bae220"},
    {"signature":"public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)",
     "source":"61a6b5c855fbcf86cafaf3c3c7ce6f0a","target":"252ae351970aa1c0b19d356faad94540"},
    {"signature":"public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)",
     "source":"a86278195e18d1ef8d0091b41d1d0c5b","target":"0d5eb4e8e8d8d0545daf3b4b82307c30"},
    {"signature":"public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)",
     "source":"d283261c5e77558d10f5df86cd4d1127","target":"5fa5bcfd31f69db8114b82f3ade9b4a5"}
  ]$specs$::jsonb;
  -- Hàm không sửa nhưng hành vi v530 dựa vào: _v2 gọi create_control_campaign; bản theo config_version gọi
  -- update_control_campaign_atomic; trang lịch sử chạy đã nhận token theo flatform_type; wrapper chính sách
  -- Facebook gọi helper private.
  dependencies constant jsonb := $dependencies$[
    {"signature":"public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)","md5":"661579fa2e8b6571f429079dd0b89c0a"},
    {"signature":"public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)","md5":"3e1e2f8b67697d36b3c8c3830586a6c2"},
    {"signature":"public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)","md5":"26875e2b1652ca56cc8e59460df8cae1"},
    {"signature":"public.aka_agent_control_web_facebook_campaigns_policy(bigint)","md5":"7f487421358f987502dc2bc6405dae0b"}
  ]$dependencies$::jsonb;
  c_facebook_policy constant text := $facebook_policy$CREATE OR REPLACE FUNCTION private.aka_agent_web_facebook_campaigns_policy(p_organization_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text;
  v_value jsonb;
  v_orgs jsonb;
  v_enabled boolean := false;
  v_authoring jsonb;
  v_authoring_orgs jsonb;
  v_action_ids jsonb;
  v_authoring_enabled boolean := false;
  c_closed constant jsonb := '{"enabled":false,"facebookOnlyLogin":false,"authoring":{"enabled":false,"actionIds":[]}}';
BEGIN
  IF p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RETURN c_closed;
  END IF;
  SELECT setting.value INTO v_raw
  FROM public.auto_system_settings AS setting
  WHERE setting.key = 'web.facebook_campaigns'
    AND setting.is_active IS TRUE
    AND setting.is_secret IS NOT TRUE;
  -- Lỗi cấu hình luôn đóng tính năng, không làm hỏng xác thực.
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN c_closed;
  END IF;
  v_value := v_raw::jsonb;
  IF jsonb_typeof(v_value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean' THEN
    RETURN c_closed;
  END IF;
  v_enabled := (v_value->>'enabled')::boolean;
  v_orgs := v_value->'organizationIds';
  IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
    v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
  END IF;
  -- V530: nhánh soạn (tạo/sửa trên Web/iOS), lọc tiếp trong tập tổ chức đã qua organizationIds ngoài.
  -- authoring.actionIds: thiếu/null = mọi loại API hỗ trợ; mảng chuỗi khác rỗng = chỉ các loại đó; sai kiểu = tắt.
  v_authoring := v_value->'authoring';
  IF v_enabled AND jsonb_typeof(v_authoring) = 'object'
     AND jsonb_typeof(v_authoring->'enabled') = 'boolean' THEN
    v_authoring_enabled := (v_authoring->>'enabled')::boolean;
    v_authoring_orgs := v_authoring->'organizationIds';
    IF v_authoring_enabled AND v_authoring_orgs IS NOT NULL AND jsonb_typeof(v_authoring_orgs) <> 'null' THEN
      v_authoring_enabled := jsonb_typeof(v_authoring_orgs) = 'array' AND v_authoring_orgs @> to_jsonb(p_organization_id);
    END IF;
    v_action_ids := v_authoring->'actionIds';
    IF jsonb_typeof(v_action_ids) = 'null' THEN
      v_action_ids := NULL;
    END IF;
    IF v_authoring_enabled AND v_action_ids IS NOT NULL THEN
      v_authoring_enabled := CASE WHEN jsonb_typeof(v_action_ids) = 'array' THEN
        jsonb_array_length(v_action_ids) > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_action_ids) AS item(value)
          WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string' OR btrim(item.value #>> '{}') = ''
        ) ELSE false END;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'facebookOnlyLogin', v_enabled
      AND jsonb_typeof(v_value->'facebookOnlyLogin') = 'boolean'
      AND (v_value->>'facebookOnlyLogin')::boolean,
    'authoring', jsonb_build_object(
      'enabled', v_authoring_enabled,
      'actionIds', CASE WHEN v_authoring_enabled THEN v_action_ids ELSE '[]'::jsonb END
    )
  );
END
$function$
$facebook_policy$;
  -- Chặn sửa khi app Desktop còn giữ lượt (hợp đồng mục 3.1).
  c_busy_guard constant text :=
    '  -- V530: chiến dịch chạy trên app Desktop (Facebook, Email, Zalo QR/trình duyệt) còn claim/unit lease và' || E'\n'
    || '  -- app Desktop của nhân viên còn báo hoạt động 2 phút gần nhất: bộ chạy có thể ghi lại cả khối extra_settings' || E'\n'
    || '  -- từ bản trong RAM, nên chưa cho sửa. App đã tắt (lease mồ côi) thì cho sửa.' || E'\n'
    || '  IF (v_campaign.runtime_claim_token IS NOT NULL OR v_campaign.runtime_unit_token IS NOT NULL)' || E'\n'
    || '    AND EXISTS (' || E'\n'
    || '      SELECT 1 FROM public.auto_accounts AS runtime_account' || E'\n'
    || '      WHERE runtime_account.id = v_campaign.account_id' || E'\n'
    || '        AND (runtime_account.flatform_type IN (''facebook'', ''email'')' || E'\n'
    || '          OR (runtime_account.flatform_type = ''zalo'' AND COALESCE(runtime_account.is_zalo_server, false) = false))' || E'\n'
    || '    )' || E'\n'
    || '    AND EXISTS (' || E'\n'
    || '      SELECT 1 FROM public.auto_staff_device_presence AS presence' || E'\n'
    || '      WHERE presence.staff_id = v_campaign.staff_id' || E'\n'
    || '        AND presence.ended_at IS NULL' || E'\n'
    || '        AND presence.last_seen_at >= now() - interval ''2 minutes''' || E'\n'
    || '    ) THEN' || E'\n'
    || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'', ''desktop_runtime_busy'', true);' || E'\n'
    || '  END IF;' || E'\n';
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
    IF f IS NULL THEN RAISE EXCEPTION 'v530_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source, r.target) THEN
      RAISE EXCEPTION 'v530_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION 'v530_unexpected_owner:%', r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_to_recordset(dependencies) AS x(signature text, md5 text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL OR md5(pg_get_functiondef(f)) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'v530_dependency_changed:%:%', r.signature, CASE WHEN f IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(f)) END;
    END IF;
  END LOOP;

  -- Dựng toàn bộ bản đích trước (chưa EXECUTE), kiểm md5 đích của mọi hàm cùng lúc.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    d := pg_get_functiondef(f);
    CONTINUE WHEN md5(d) = r.target;

    IF r.signature LIKE 'private.aka_agent_web_facebook_campaigns_policy(%' THEN
      d := c_facebook_policy;

    ELSIF r.signature LIKE 'public.aka_agent_authenticate_control_session(%'
       OR r.signature LIKE 'public.aka_agent_authenticate_control_session_chat_v2(%' THEN
      -- Hai thân giữ giống nhau ngoài nhánh phạm vi Chat (V490): cùng bốn phép thay.
      d := pg_temp.v530_replace(d,
        '  v_web_facebook_policy jsonb := ''{}''::jsonb;' || E'\n',
        '  v_web_facebook_policy jsonb := ''{}''::jsonb;' || E'\n'
        || '  v_email_enabled boolean := false;' || E'\n'
        || '  v_web_email_policy jsonb := ''{}''::jsonb;' || E'\n',
        1, 'session_declare');
      -- Cùng luật gói còn hạn như SMS/Facebook: chưa xoá, hạn tới hết ngày Việt Nam.
      d := pg_temp.v530_replace(d,
        '      AND entitlement.product_id IN (3, 10)' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n',
        '      AND entitlement.product_id IN (3, 10)' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n'
        || '  v_email_enabled := EXISTS (' || E'\n'
        || '    SELECT 1 FROM public.org_organization_product AS entitlement' || E'\n'
        || '    WHERE entitlement.organization_id = v_staff.organization_id' || E'\n'
        || '      AND entitlement.is_deleted = false' || E'\n'
        || '      AND entitlement.product_id = 13' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n',
        1, 'session_email');
      d := pg_temp.v530_replace(d,
        '  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);' || E'\n',
        '  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);' || E'\n'
        || '  v_web_email_policy := private.aka_agent_web_email_campaigns_policy(v_staff.organization_id);' || E'\n',
        1, 'session_policy');
      d := pg_temp.v530_replace(d,
        '    AND COALESCE((v_web_facebook_policy->>''facebookOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        '    AND COALESCE((v_web_facebook_policy->>''facebookOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) AND NOT (' || E'\n'
        || '    -- Tổ chức chỉ có gói Email (chạy trên app Desktop) vào Web/PWA/iOS khi chính sách bật rõ emailOnlyLogin.' || E'\n'
        || '    v_email_enabled' || E'\n'
        || '    AND v_session.client_type IN (''web'', ''pwa'', ''native'')' || E'\n'
        || '    AND COALESCE((v_web_email_policy->>''emailOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        1, 'session_gate');
      d := pg_temp.v530_replace(d,
        '      ''facebook'', v_facebook_enabled' || E'\n' || '    ),' || E'\n',
        '      ''facebook'', v_facebook_enabled,' || E'\n' || '      ''email'', v_email_enabled' || E'\n' || '    ),' || E'\n',
        1, 'session_capabilities');
      d := pg_temp.v530_replace(d,
        '    ''web_facebook_campaigns'', v_web_facebook_policy,' || E'\n',
        '    ''web_facebook_campaigns'', v_web_facebook_policy,' || E'\n'
        || '    ''web_email_campaigns'', v_web_email_policy,' || E'\n',
        1, 'session_output');

    ELSIF r.signature LIKE 'public.aka_agent_control_campaign_page(%' THEN
      d := pg_temp.v530_replace(d,
        'CASE WHEN a.flatform_type = ''facebook'' OR (a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE) THEN ''desktop''',
        'CASE WHEN a.flatform_type IN (''facebook'', ''email'') OR (a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE) THEN ''desktop''',
        1, 'page_runtime_target');
      d := pg_temp.v530_replace(d,
        '(a.flatform_type = ''facebook'' AND ''facebook'' = ANY(p_platforms))',
        '(a.flatform_type = ''facebook'' AND ''facebook'' = ANY(p_platforms)) OR (a.flatform_type = ''email'' AND ''email'' = ANY(p_platforms))',
        1, 'page_scope');

    ELSIF r.signature LIKE 'public.aka_agent_control_account_snapshot(%' THEN
      d := pg_temp.v530_replace(d,
        '(a.flatform_type=''facebook'' AND ''facebook''=ANY(p_platforms))',
        '(a.flatform_type=''facebook'' AND ''facebook''=ANY(p_platforms)) OR (a.flatform_type=''email'' AND ''email''=ANY(p_platforms))',
        3, 'snapshot_scope');
      d := pg_temp.v530_replace(d,
        'p_platforms && ARRAY[''zalo_qr'',''zalo_web'',''facebook'']::text[] THEN',
        'p_platforms && ARRAY[''zalo_qr'',''zalo_web'',''facebook'',''email'']::text[] THEN',
        1, 'snapshot_presence');

    ELSIF r.signature LIKE 'public.aka_agent_control_desktop_activity(%' THEN
      d := pg_temp.v530_replace(d,
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'', ''facebook'']::text[]) THEN',
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'', ''facebook'', ''email'']::text[]) THEN',
        1, 'activity_gate');
      d := pg_temp.v530_replace(d,
        '      a.flatform_type = ''facebook'' AS is_facebook' || E'\n',
        '      a.flatform_type = ''facebook'' AS is_facebook,' || E'\n'
        || '      a.flatform_type = ''email'' AS is_email' || E'\n',
        1, 'activity_columns');
      d := pg_temp.v530_replace(d,
        '        OR (''facebook'' = ANY(p_platforms) AND a.flatform_type = ''facebook''))' || E'\n',
        '        OR (''facebook'' = ANY(p_platforms) AND a.flatform_type = ''facebook'')' || E'\n'
        || '        OR (''email'' = ANY(p_platforms) AND a.flatform_type = ''email''))' || E'\n',
        1, 'activity_scope');
      d := pg_temp.v530_replace(d,
        '''accountType'', CASE WHEN s.is_facebook THEN ''facebook'' WHEN s.is_browser',
        '''accountType'', CASE WHEN s.is_facebook THEN ''facebook'' WHEN s.is_email THEN ''email'' WHEN s.is_browser',
        1, 'activity_account_type');

    ELSIF r.signature LIKE 'public.aka_agent_control_set_desktop_campaign_status(%' THEN
      -- Email cũng chạy trên app Desktop: cùng luật dừng ở ranh giới/lease như Facebook và Zalo Desktop.
      d := pg_temp.v530_replace(d,
        '    AND (account.flatform_type = ''facebook''' || E'\n'
        || '      OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        '    AND (account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '      OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        1, 'status_scope');

    ELSIF r.signature LIKE 'public.delete_control_campaign_atomic(%' THEN
      d := pg_temp.v530_replace(d,
        '      OR account.flatform_type = ''facebook''' || E'\n',
        '      OR account.flatform_type IN (''facebook'', ''email'')' || E'\n',
        2, 'delete_scope');
      d := pg_temp.v530_replace(d,
        '      AND (account.flatform_type = ''facebook''' || E'\n'
        || '        OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        '      AND (account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '        OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        1, 'delete_desktop_lease');

    ELSIF r.signature LIKE 'public.create_control_campaign(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '''')), '''');' || E'\n',
        '  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '''')), '''');' || E'\n'
        || '  v_secondary_account_id bigint;' || E'\n',
        1, 'create_declare');
      -- Gọi lặp cùng khoá idempotency của chiến dịch Facebook/Email phải trả lại chiến dịch đã tạo.
      d := pg_temp.v530_replace(d,
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        1, 'create_replay_scope');
      d := pg_temp.v530_replace(d,
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        1, 'create_account_scope');
      d := pg_temp.v530_replace(d,
        '    AND action.flatform_type IN (''zalo'', ''sms'')' || E'\n',
        '    AND action.flatform_type IN (''zalo'', ''sms'', ''facebook'', ''email'')' || E'\n',
        1, 'create_action_scope');
      d := pg_temp.v530_replace(d,
        '  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN' || E'\n'
        || '    RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '  END IF;' || E'\n',
        '  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN' || E'\n'
        || '    RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '  END IF;' || E'\n'
        || '  -- V530: tài khoản phụ (chỉ Facebook, loại cho phép) và dòng data Facebook (uid) / Email (email hợp lệ).' || E'\n'
        || '  v_secondary_account_id := NULLIF(p_campaign->>''secondaryAccountId'', '''')::bigint;' || E'\n'
        || '  IF v_secondary_account_id IS NOT NULL THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_secondary_account(' || E'\n'
        || '      p_staff_id, p_organization_id, v_account_platform, v_action_id, v_account_id, v_secondary_account_id);' || E'\n'
        || '  END IF;' || E'\n'
        || '  IF v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'create_secondary_inputs');
      d := pg_temp.v530_replace(d,
        '    control_idempotency_key, created_at, updated_at' || E'\n' || '  ) VALUES (' || E'\n',
        '    control_idempotency_key, created_at, updated_at, secondary_account_id' || E'\n' || '  ) VALUES (' || E'\n',
        1, 'create_insert_columns');
      d := pg_temp.v530_replace(d,
        '    v_key,' || E'\n' || '    now(),' || E'\n' || '    now()' || E'\n' || '  ) RETURNING id INTO v_campaign_id;' || E'\n',
        '    v_key,' || E'\n' || '    now(),' || E'\n' || '    now(),' || E'\n' || '    v_secondary_account_id' || E'\n'
        || '  ) RETURNING id INTO v_campaign_id;' || E'\n',
        1, 'create_insert_values');

    ELSIF r.signature LIKE 'public.update_control_campaign_atomic(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_appended_inputs integer := 0;' || E'\n',
        '  v_appended_inputs integer := 0;' || E'\n'
        || '  v_secondary_account_id bigint;' || E'\n'
        || '  -- V530: khoá extra_settings do bộ chạy sở hữu; patch không ghi được (hợp đồng mục 3.2).' || E'\n'
        || '  v_runtime_owned_keys constant text[] := ARRAY[' || E'\n'
        || '    ''sourceLinkIndex'', ''contentRotationIndex'', ''postBumpRotationIndex'',' || E'\n'
        || '    ''postBumpCreatedCampaignIdsByAccount'', ''internalSmsCreatedCampaignIdsByAccount'',' || E'\n'
        || '    ''zaloFriendDataMaterializedAt'', ''zaloFriendMaterializedCount'',' || E'\n'
        || '    ''zaloBirthdayDataMaterializedDate'', ''zaloBirthdayMaterializedCount'',' || E'\n'
        || '    ''zaloFriendRecommendationDataMaterializedAt'', ''zaloFriendRecommendationMaterializedCount'',' || E'\n'
        || '    ''zaloCancelFriendRequestDataMaterializedAt'', ''zaloCancelFriendRequestMaterializedCount''' || E'\n'
        || '  ];' || E'\n',
        1, 'update_declare');
      d := pg_temp.v530_replace(d,
        '          account.flatform_type = ''sms''' || E'\n'
        || '          OR (' || E'\n'
        || '            account.flatform_type = ''zalo''' || E'\n',
        '          account.flatform_type = ''sms''' || E'\n'
        || '          OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '          OR (' || E'\n'
        || '            account.flatform_type = ''zalo''' || E'\n',
        2, 'update_campaign_scope');
      d := pg_temp.v530_replace(d,
        '              target_account.flatform_type = ''sms''' || E'\n'
        || '              OR (' || E'\n'
        || '                target_account.flatform_type = ''zalo''' || E'\n',
        '              target_account.flatform_type = ''sms''' || E'\n'
        || '              OR (target_account.flatform_type IN (''facebook'', ''email'') AND COALESCE(target_account.is_active, true) = true)' || E'\n'
        || '              OR (' || E'\n'
        || '                target_account.flatform_type = ''zalo''' || E'\n',
        2, 'update_reassign_scope');
      d := pg_temp.v530_replace(d,
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        1, 'update_patch_account_scope');
      d := pg_temp.v530_replace(d,
        '  IF v_campaign.status = ''đang chạy'' THEN' || E'\n'
        || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'');' || E'\n'
        || '  END IF;' || E'\n',
        '  IF v_campaign.status = ''đang chạy'' THEN' || E'\n'
        || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'');' || E'\n'
        || '  END IF;' || E'\n'
        || c_busy_guard,
        2, 'update_desktop_busy_guard');
      d := pg_temp.v530_replace(d,
        '    IF NOT FOUND THEN' || E'\n'
        || '      RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n',
        '    IF NOT FOUND THEN' || E'\n'
        || '      RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n'
        || E'\n'
        || '  -- V530: tài khoản phụ chỉ Facebook ở loại cho phép. Khoá patch ''secondary_account_id'': có = ghi, null = xoá.' || E'\n'
        || '  IF p_campaign_patch ? ''secondaryAccountId'' THEN' || E'\n'
        || '    RAISE EXCEPTION ''invalid_control_campaign_update_payload'';' || E'\n'
        || '  END IF;' || E'\n'
        || '  v_secondary_account_id := CASE WHEN p_campaign_patch ? ''secondary_account_id''' || E'\n'
        || '    THEN NULLIF(p_campaign_patch->>''secondary_account_id'', '''')::bigint ELSE v_campaign.secondary_account_id END;' || E'\n'
        || '  IF v_secondary_account_id IS NOT NULL AND (p_campaign_patch ? ''secondary_account_id''' || E'\n'
        || '    OR (v_account_platform IN (''facebook'', ''email'') AND (p_campaign_patch ? ''account_id'' OR p_campaign_patch ? ''action_id''))) THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_secondary_account(' || E'\n'
        || '      p_staff_id, p_organization_id, v_account_platform, v_target_action_id,' || E'\n'
        || '      CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE v_campaign.account_id END,' || E'\n'
        || '      v_secondary_account_id);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'update_secondary_account');
      d := pg_temp.v530_replace(d,
        '    IF v_current_input_count <> p_expected_input_count THEN' || E'\n'
        || '      RETURN jsonb_build_object(''updated'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n',
        '    IF v_current_input_count <> p_expected_input_count THEN' || E'\n'
        || '      RETURN jsonb_build_object(''updated'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n'
        || '  IF p_append_inputs IS NOT NULL AND v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_append_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'update_append_inputs');
      d := pg_temp.v530_replace(d,
        '    account_id = CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE campaign.account_id END,' || E'\n',
        '    account_id = CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE campaign.account_id END,' || E'\n'
        || '    secondary_account_id = CASE WHEN p_campaign_patch ? ''secondary_account_id'' THEN v_secondary_account_id ELSE campaign.secondary_account_id END,' || E'\n',
        1, 'update_set_secondary');
      d := pg_temp.v530_replace(d,
        '    extra_settings = CASE WHEN p_campaign_patch ? ''extra_settings'' THEN p_campaign_patch->''extra_settings'' ELSE campaign.extra_settings END,' || E'\n',
        '    extra_settings = CASE WHEN p_campaign_patch ? ''extra_settings'' THEN' || E'\n'
        || '      CASE WHEN jsonb_typeof(p_campaign_patch->''extra_settings'') = ''object'' THEN' || E'\n'
        || '        ((p_campaign_patch->''extra_settings'') - v_runtime_owned_keys)' || E'\n'
        || '        || COALESCE((' || E'\n'
        || '          SELECT jsonb_object_agg(owned.key, owned.value)' || E'\n'
        || '          FROM jsonb_each(CASE WHEN jsonb_typeof(campaign.extra_settings) = ''object''' || E'\n'
        || '            THEN campaign.extra_settings ELSE ''{}''::jsonb END) AS owned' || E'\n'
        || '          WHERE owned.key = ANY(v_runtime_owned_keys)' || E'\n'
        || '        ), ''{}''::jsonb)' || E'\n'
        || '      ELSE p_campaign_patch->''extra_settings'' END' || E'\n'
        || '    ELSE campaign.extra_settings END,' || E'\n',
        1, 'update_runtime_owned_keys');
      -- Chiến dịch chạy trên Desktop chỉ đổi trạng thái qua aka_agent_control_set_desktop_campaign_status.
      d := pg_temp.v530_replace(d,
        '      WHEN v_account_platform = ''zalo'' THEN campaign.status' || E'\n',
        '      WHEN v_account_platform IN (''zalo'', ''facebook'', ''email'') THEN campaign.status' || E'\n',
        1, 'update_status');

    ELSIF r.signature LIKE 'public.add_control_campaign_input_rows(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_inserted integer := 0;' || E'\n',
        '  v_inserted integer := 0;' || E'\n' || '  v_account_platform text;' || E'\n',
        1, 'append_declare');
      d := pg_temp.v530_replace(d,
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        2, 'append_scope');
      d := pg_temp.v530_replace(d,
        '  SELECT campaign.status' || E'\n' || '  INTO v_campaign_status' || E'\n',
        '  SELECT campaign.status, account.flatform_type' || E'\n' || '  INTO v_campaign_status, v_account_platform' || E'\n',
        1, 'append_platform');
      d := pg_temp.v530_replace(d,
        '  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN' || E'\n'
        || '    RETURN jsonb_build_object(''inserted'', 0, ''created'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '  END IF;' || E'\n',
        '  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN' || E'\n'
        || '    RETURN jsonb_build_object(''inserted'', 0, ''created'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '  END IF;' || E'\n'
        || '  -- V530: dòng data Facebook phải có uid, Email phải có email hợp lệ.' || E'\n'
        || '  IF v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'append_inputs');
    END IF;

    IF md5(d) IS DISTINCT FROM r.target THEN
      mismatches := mismatches || (r.signature || '=' || md5(d));
    END IF;
    patched := patched || jsonb_build_object(r.signature, d);
    pending := pending + 1;
  END LOOP;
  IF cardinality(mismatches) > 0 THEN
    RAISE EXCEPTION 'v530_target_checksum_mismatch:%', array_to_string(mismatches, ' ');
  END IF;
  -- So sánh: không EXECUTE lên public/private. Ghi nhận bản vá khớp md5 đích, tạo bản sao pg_temp cho
  -- 3 hàm đọc và helper chính sách Facebook (hàm thuần đọc).
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF NOT patched ? r.signature THEN
      INSERT INTO v530_cmp(check_name, ok, detail) VALUES ('already_applied', false, r.signature);
      CONTINUE;
    END IF;
    INSERT INTO v530_cmp(check_name, ok, detail) VALUES ('patch_dry_run', true, r.signature);
    IF r.signature ~ '^public\.aka_agent_control_(campaign_page|account_snapshot|desktop_activity)\(' THEN
      EXECUTE regexp_replace(patched->>r.signature, 'FUNCTION public\.([a-z_]+)\(', 'FUNCTION pg_temp.\1_v530(');
    ELSIF r.signature LIKE 'private.aka_agent_web_facebook_campaigns_policy(%' THEN
      EXECUTE regexp_replace(patched->>r.signature, 'FUNCTION private\.([a-z_]+)\(', 'FUNCTION pg_temp.\1_v530(');
    END IF;
  END LOOP;
END
$migration$;

CREATE OR REPLACE FUNCTION pg_temp.v530_strip(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $strip$
  -- checkedAt = now() của giao dịch nên vốn trùng; bỏ cho chắc khi so.
  SELECT CASE WHEN jsonb_typeof(p->'desktopPresence') = 'object'
    THEN jsonb_set(p, '{desktopPresence}', (p->'desktopPresence') - 'checkedAt') ELSE p END
$strip$;

DO $compare$
DECLARE
  s record;
  t0 timestamptz;
  v_old jsonb;
  v_new jsonb;
  old_ms numeric;
  new_ms numeric;
  v_ids bigint[];
  i integer;
  k text;
  v_scope text[];
  -- Caller cũ: mọi bộ token không có 'email' (Web cũ, Web có Desktop, Web có Facebook).
  v_scopes constant jsonb := '{"legacy":["zalo","sms"],"desktop":["zalo","sms","zalo_qr","zalo_web"],
    "facebook":["zalo","sms","zalo_qr","zalo_web","facebook"]}';
  v_email text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook','email'];
  v_filters jsonb := jsonb_build_object('applyDisplaySettings', true,
    'dateFrom', to_char(timezone('Asia/Ho_Chi_Minh', now()) - interval '7 days', 'YYYY-MM-DD'),
    'dateTo', to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYY-MM-DD'));
  v_orgs bigint[];
  v_diff integer;
BEGIN
  -- 1. Caller cũ (không token 'email'): nhân viên có nhiều chiến dịch Email, Facebook, Zalo/SMS nhất
  --    (dòng Email phải vẫn bị loại). Kết quả cũ/mới phải giống hệt.
  FOR s IN
    (SELECT 'email' AS grp, c.staff_id, c.organization_id, count(*) AS n
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type = 'email'
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 2)
    UNION ALL
    (SELECT 'facebook', c.staff_id, c.organization_id, count(*)
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type = 'facebook'
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 2)
    UNION ALL
    (SELECT 'zalo_sms', c.staff_id, c.organization_id, count(*)
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type IN ('zalo', 'sms')
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 2)
  LOOP
    SELECT array_agg(a.id ORDER BY a.id) INTO v_ids FROM (
      SELECT a.id FROM auto_accounts a WHERE a.staff_id = s.staff_id AND a.organization_id = s.organization_id
        AND a.is_delete = false ORDER BY a.id LIMIT 100) a;
    FOR k IN SELECT jsonb_object_keys(v_scopes) LOOP
      SELECT array_agg(x ORDER BY o) INTO v_scope FROM jsonb_array_elements_text(v_scopes->k) WITH ORDINALITY AS y(x, o);
      old_ms := NULL; new_ms := NULL;
      FOR i IN 1..2 LOOP
        t0 := clock_timestamp();
        v_old := public.aka_agent_control_campaign_page(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
          p_platforms => v_scope, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
        old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
        t0 := clock_timestamp();
        v_new := pg_temp.aka_agent_control_campaign_page_v530(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
          p_platforms => v_scope, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('page_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      old_ms := NULL; new_ms := NULL;
      FOR i IN 1..2 LOOP
        t0 := clock_timestamp();
        v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope);
        old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
        t0 := clock_timestamp();
        v_new := pg_temp.aka_agent_control_account_snapshot_v530(s.staff_id, s.organization_id, v_scope);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('snapshot_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v530_strip(v_new) = pg_temp.v530_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' accounts=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_account_snapshot_v530(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('catalog_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v530_strip(v_new) = pg_temp.v530_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' catalog=' || COALESCE(jsonb_array_length(v_old->'catalog'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_desktop_activity(s.staff_id, s.organization_id, v_scope, NULL, 100);
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_desktop_activity_v530(s.staff_id, s.organization_id, v_scope, NULL, 100);
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('activity_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));
    END LOOP;
  END LOOP;

  -- 2. Đường Email mới (chưa ai gọi, chỉ đo và kiểm chỉ có dòng Email khi lọc nền tảng email).
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false AND a.flatform_type = 'email'
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_campaign_page_v530(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_email, p_filters => '{"platforms":["email"]}'::jsonb, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
    INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('page_email', s.staff_id, s.organization_id,
      (v_new->>'campaignTotal')::bigint > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'items') x
        WHERE x->>'platform' <> 'email' OR (x->>'isZaloServer')::boolean OR (x->>'isZaloShowWeb')::boolean),
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'campaigns=' || s.n || ' total=' || COALESCE(v_new->>'campaignTotal', '?'));

    SELECT array_agg(a.id ORDER BY a.id) INTO v_ids FROM (
      SELECT a.id FROM auto_accounts a WHERE a.staff_id = s.staff_id AND a.organization_id = s.organization_id
        AND a.is_delete = false ORDER BY a.id LIMIT 100) a;
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_account_snapshot_v530(s.staff_id, s.organization_id, v_email, 'campaigns', COALESCE(v_ids, '{}'));
    INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('snapshot_email', s.staff_id, s.organization_id,
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'catalog') x WHERE x->>'platform' = 'email')
        AND jsonb_typeof(v_new->'desktopPresence') = 'object',
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'catalog=' || COALESCE(jsonb_array_length(v_new->'catalog'), 0) || ' online=' || COALESCE(v_new->'desktopPresence'->>'online', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_desktop_activity_v530(s.staff_id, s.organization_id, ARRAY['email'], NULL, 100);
    INSERT INTO v530_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('activity_email', s.staff_id, s.organization_id,
      v_new ? 'items' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'items') x WHERE x->>'accountType' <> 'email'),
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'items=' || COALESCE(jsonb_array_length(v_new->'items'), 0));
  END LOOP;

  -- 3. Chính sách Facebook: enabled/facebookOnlyLogin giống hệt cho mọi tổ chức có gói Facebook (và 0/NULL);
  --    authoring tắt vì dòng chính sách hiện tại chưa có nhánh authoring.
  SELECT array_agg(DISTINCT p.organization_id ORDER BY p.organization_id) INTO v_orgs
  FROM org_organization_product p WHERE p.product_id IN (3, 10, 13) AND p.is_deleted = false;
  v_orgs := COALESCE(v_orgs, '{}') || ARRAY[0::bigint, 1::bigint, NULL::bigint];
  SELECT count(*) INTO v_diff
  FROM unnest(v_orgs) AS o(id)
  WHERE (pg_temp.aka_agent_web_facebook_campaigns_policy_v530(o.id) - 'authoring')
      IS DISTINCT FROM private.aka_agent_web_facebook_campaigns_policy(o.id)
    OR jsonb_typeof(pg_temp.aka_agent_web_facebook_campaigns_policy_v530(o.id)->'authoring') IS DISTINCT FROM 'object';
  INSERT INTO v530_cmp(check_name, ok, detail)
  VALUES ('facebook_policy_same', v_diff = 0, 'orgs=' || cardinality(v_orgs) || ' diff=' || v_diff);
  -- Chỉ đo: số tổ chức được soạn Facebook theo giá trị chính sách hiện tại (chưa có nhánh authoring = 0).
  SELECT count(*) INTO v_diff FROM unnest(v_orgs) AS o(id)
  WHERE (pg_temp.aka_agent_web_facebook_campaigns_policy_v530(o.id)->'authoring'->>'enabled')::boolean;
  INSERT INTO v530_cmp(check_name, ok, detail) VALUES ('facebook_authoring_orgs', true, 'enabled=' || v_diff);
END
$compare$;

-- Chốt chặn: bất kỳ kiểm nào không đạt thì RAISE, cả giao dịch rollback.
DO $guard$
DECLARE
  v_bad text;
  v_patch integer;
BEGIN
  SELECT count(*) INTO v_patch FROM v530_cmp WHERE check_name = 'patch_dry_run' AND ok IS TRUE;
  IF v_patch <> 11 THEN
    RAISE EXCEPTION 'v530_guard_failed: patch_dry_run %/11', v_patch;
  END IF;
  SELECT string_agg(check_name || COALESCE(' staff=' || staff_id, '') || COALESCE(' ' || detail, ''), '; ' ORDER BY seq)
  INTO v_bad
  FROM v530_cmp
  WHERE ok IS NOT TRUE
     OR (old_ms IS NOT NULL AND new_ms IS NOT NULL AND new_ms > old_ms * 2 AND new_ms > old_ms + 5);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'v530_guard_failed: %', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v530_cmp WHERE check_name = 'page_legacy_same')
     OR NOT EXISTS (SELECT 1 FROM v530_cmp WHERE check_name = 'snapshot_facebook_same')
     OR NOT EXISTS (SELECT 1 FROM v530_cmp WHERE check_name = 'facebook_policy_same') THEN
    RAISE EXCEPTION 'v530_guard_failed: thiếu dòng so sánh caller cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v530_web_facebook_email_authoring') THEN
    RAISE EXCEPTION 'v530_guard_failed: lịch sử đã có migration_v530_web_facebook_email_authoring';
  END IF;
END
$guard$;

-- v530: Web/PWA và app iOS tạo, sửa chiến dịch Facebook và Email (vẫn chỉ chạy trên app Desktop),
-- tài khoản Email SMTP từ Web, liên kết chiến dịch tìm data, và RPC để bộ chạy Desktop ghi từng khoá
-- extra_settings. Hợp đồng: akaAgentWebApp docs/FACEBOOK_EMAIL_AUTHORING_IMPLEMENTATION.md mục 3;
-- tài liệu: docs/WEB_FACEBOOK_EMAIL_AUTHORING_V530.md.
--
-- 1. Chính sách: private.aka_agent_web_facebook_campaigns_policy trả thêm authoring {enabled, actionIds}
--    (giá trị dòng 'web.facebook_campaigns' không đổi; thiếu nhánh authoring = tắt). Khoá mới
--    'web.email_campaigns' (mặc định tắt) + private.aka_agent_web_email_campaigns_policy và wrapper
--    public.aka_agent_control_web_email_campaigns_policy (chỉ service_role).
-- 2. Xác thực phiên (aka_agent_authenticate_control_session và bản chat_v2 của V490, hai thân giữ giống
--    nhau): capabilities.email (sản phẩm 13 còn hạn theo ngày Việt Nam), web_email_campaigns, và cổng cho
--    tổ chức chỉ có gói Email khi chính sách bật rõ emailOnlyLogin (cùng cách facebookOnlyLogin của V476).
-- 3. Token phạm vi mới 'email' (tài khoản flatform_type = 'email', nơi chạy Desktop) cho trang chiến dịch,
--    snapshot tài khoản, tiến trình Desktop (accountType 'email'), dừng/tiếp tục và xoá chiến dịch.
--    Caller không gửi token 'email' nhận kết quả như trước.
-- 4. Tạo/sửa/thêm data (create_control_campaign, update_control_campaign_atomic,
--    add_control_campaign_input_rows) nhận tài khoản Facebook/Email của đúng nhân viên; hành động cùng
--    nền tảng; tài khoản phụ chỉ Facebook ở loại cho phép (create: p_campaign->>'secondaryAccountId',
--    update: khoá patch 'secondary_account_id', có khoá = ghi, null = xoá); dòng data Facebook phải có uid,
--    Email phải có email hợp lệ. Sửa chiến dịch chạy trên Desktop (Facebook, Email, Zalo QR/trình duyệt)
--    bị chặn khi chiến dịch còn claim/unit lease VÀ app Desktop của nhân viên còn báo hoạt động trong 2 phút
--    ({"updated":false,"reason":"campaign_running","desktop_runtime_busy":true}). Khi patch có
--    extra_settings, 13 khoá do bộ chạy sở hữu luôn lấy từ dòng hiện tại (mọi nền tảng).
--    update_control_campaign_by_config_version_atomic gọi bản trên nên có cùng luật, không sửa.
-- 5. RPC mới (chỉ service_role): tài khoản Email SMTP (tạo/sửa/xoá/đọc cấu hình đầy đủ cho API kiểm tra
--    kết nối), aka_agent_control_link_find_data_target (thêm/bớt chiến dịch đích trong find*TargetCampaignIds
--    của chiến dịch tìm data bằng một câu UPDATE). RPC mới chỉ aka_agent_desktop:
--    aka_agent_desktop_merge_campaign_runtime_settings (SECURITY INVOKER, RLS phiên Desktop).
--
-- Không đổi bảng, index, dữ liệu khách. Canonical ở repo akaAgent; repo WebApp không sao chép. Định nghĩa
-- nguồn được kiểm bằng md5 trước khi vá (bản V461/V476/V490 đang chạy trên production); lệch thì dừng.
-- CREATE OR REPLACE nên PostgREST nạp lại schema: chỉ apply ngoài giờ cao điểm.
-- Rollback: migrations/snapshots/web-facebook-email-authoring-v530/rollback.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Preflight trước mọi thay đổi: hàm mới (nếu đã có) phải đúng bản v530; cột và quyền cần dùng phải có.
DO $preflight$
DECLARE
  r record;
  f oid;
BEGIN
  FOR r IN SELECT * FROM jsonb_to_recordset($new_functions$[
    {"signature":"private.aka_agent_web_email_campaigns_policy(bigint)","target":"2d131332e8d0fa54b4669f51a8fe92d8"},
    {"signature":"public.aka_agent_control_web_email_campaigns_policy(bigint)","target":"70616ad6489372725cca33b09da41852"},
    {"signature":"private.aka_agent_control_assert_campaign_inputs(text,jsonb)","target":"80972291d75cec5383aab3a28838b7b6"},
    {"signature":"private.aka_agent_control_assert_secondary_account(bigint,bigint,text,text,bigint,bigint)","target":"fa594cff527fcf2f553c9f376d67dc41"},
    {"signature":"private.aka_agent_control_normalize_email_session(jsonb,text)","target":"7068bce7f45562f1f4ebcb2fb902a89b"},
    {"signature":"private.aka_agent_control_email_account_view(public.auto_accounts)","target":"c6c2b3218cf5946c7d4fa3cc23d0f429"},
    {"signature":"public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)","target":"496a0182daaa9c944119a9744fcf41eb"},
    {"signature":"public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)","target":"6f0f9fefac37de258d34c55deebd2cfd"},
    {"signature":"public.delete_control_email_account_atomic(bigint,bigint,bigint)","target":"b912bdab82a4669569b184e46f166da0"},
    {"signature":"public.aka_agent_control_email_account_session(bigint,bigint,bigint)","target":"2ee2b490a2f9224a9d8ac63a1683040f"},
    {"signature":"public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)","target":"84182eb3960fd1952037e80e183036fa"},
    {"signature":"public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])","target":"2e3bf66477ad78cf90eba64e1626e8d2"}
  ]$new_functions$::jsonb) AS x(signature text, target text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NOT NULL AND md5(pg_get_functiondef(f)) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v530_unexpected_existing_function:%:%', r.signature, md5(pg_get_functiondef(f));
    END IF;
  END LOOP;
  IF to_regclass('public.auto_staff_device_presence') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass
      AND attname = 'secondary_account_id' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_accounts'::regclass
      AND attname = 'email_session_last_error' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_account_groups'::regclass
      AND attname = 'flatform_type' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaign_actions'::regclass
      AND attname = 'allow_secondary_account' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v530_schema_missing';
  END IF;
  -- RPC ghi từng khoá của Desktop là SECURITY INVOKER: phiên Desktop phải có sẵn quyền cột cần dùng.
  IF NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'UPDATE')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'UPDATE')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'SELECT')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'SELECT')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'v530_desktop_column_privileges_missing';
  END IF;
END
$preflight$;

-- 1. Chính sách Email (mặc định tắt; bật bằng cách sửa value, không cần deploy).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES (
  'web.email_campaigns',
  '{"enabled":false,"organizationIds":null,"emailOnlyLogin":false,"authoring":{"enabled":false,"organizationIds":null}}',
  'Web/PWA và app iOS quản lý chiến dịch Email chạy trên app Desktop. enabled: xem, dừng/tiếp tục, xoá; organizationIds: null = mọi tổ chức, mảng số = chỉ các tổ chức này; emailOnlyLogin: cho tổ chức chỉ có gói Email đăng nhập Web/PWA/iOS; authoring.enabled: tạo/sửa chiến dịch Email (authoring.organizationIds lọc tiếp).',
  false,
  true
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.aka_agent_web_email_campaigns_policy(p_organization_id bigint)
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
  v_authoring jsonb;
  v_authoring_orgs jsonb;
  v_authoring_enabled boolean := false;
  c_closed constant jsonb := '{"enabled":false,"emailOnlyLogin":false,"authoring":{"enabled":false}}';
BEGIN
  IF p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RETURN c_closed;
  END IF;
  SELECT setting.value INTO v_raw
  FROM public.auto_system_settings AS setting
  WHERE setting.key = 'web.email_campaigns'
    AND setting.is_active IS TRUE
    AND setting.is_secret IS NOT TRUE;
  -- Lỗi cấu hình luôn đóng tính năng, không làm hỏng xác thực.
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN c_closed;
  END IF;
  v_value := v_raw::jsonb;
  IF jsonb_typeof(v_value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean' THEN
    RETURN c_closed;
  END IF;
  v_enabled := (v_value->>'enabled')::boolean;
  v_orgs := v_value->'organizationIds';
  IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
    v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
  END IF;
  v_authoring := v_value->'authoring';
  IF v_enabled AND jsonb_typeof(v_authoring) = 'object'
     AND jsonb_typeof(v_authoring->'enabled') = 'boolean' THEN
    v_authoring_enabled := (v_authoring->>'enabled')::boolean;
    v_authoring_orgs := v_authoring->'organizationIds';
    IF v_authoring_enabled AND v_authoring_orgs IS NOT NULL AND jsonb_typeof(v_authoring_orgs) <> 'null' THEN
      v_authoring_enabled := jsonb_typeof(v_authoring_orgs) = 'array' AND v_authoring_orgs @> to_jsonb(p_organization_id);
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'emailOnlyLogin', v_enabled AND CASE WHEN jsonb_typeof(v_value->'emailOnlyLogin') = 'boolean'
      THEN (v_value->>'emailOnlyLogin')::boolean ELSE false END,
    'authoring', jsonb_build_object('enabled', v_authoring_enabled)
  );
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_web_email_campaigns_policy(bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_email_campaigns_policy(p_organization_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT private.aka_agent_web_email_campaigns_policy(p_organization_id)
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_web_email_campaigns_policy(bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_web_email_campaigns_policy(bigint) TO service_role;

-- 2. Hàm phụ dùng chung cho các RPC ghi (chỉ owner).
-- Dòng data Facebook phải có uid; Email phải có email hợp lệ (kiểm thô, API kiểm đầy đủ theo luật Desktop).
CREATE OR REPLACE FUNCTION private.aka_agent_control_assert_campaign_inputs(p_platform text, p_inputs jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row bigint;
BEGIN
  IF p_platform = 'facebook' THEN
    SELECT item.ordinality - 1 INTO v_row
    FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR NULLIF(btrim(COALESCE(item.value->>'uid', '')), '') IS NULL
    ORDER BY item.ordinality
    LIMIT 1;
    IF v_row IS NOT NULL THEN
      RAISE EXCEPTION 'control_input_uid_required' USING DETAIL = 'row=' || v_row;
    END IF;
  ELSIF p_platform = 'email' THEN
    SELECT item.ordinality - 1 INTO v_row
    FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR COALESCE(item.value->>'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       OR length(item.value->>'email') > 254
    ORDER BY item.ordinality
    LIMIT 1;
    IF v_row IS NOT NULL THEN
      RAISE EXCEPTION 'control_input_email_invalid' USING DETAIL = 'row=' || v_row;
    END IF;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_assert_campaign_inputs(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Tài khoản phụ: chỉ Facebook, loại có allow_secondary_account, cùng nhân viên/tổ chức, chưa xoá, khác tài khoản chính.
CREATE OR REPLACE FUNCTION private.aka_agent_control_assert_secondary_account(
  p_staff_id bigint,
  p_organization_id bigint,
  p_platform text,
  p_action_id text,
  p_primary_account_id bigint,
  p_secondary_account_id bigint
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_secondary_account_id IS NULL THEN
    RETURN;
  END IF;
  IF p_platform IS DISTINCT FROM 'facebook' OR NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_actions AS action
    WHERE action.id = p_action_id
      AND action.flatform_type = 'facebook'
      AND action.allow_secondary_account IS TRUE
      AND COALESCE(action.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'control_secondary_account_not_allowed';
  END IF;
  IF p_secondary_account_id = p_primary_account_id THEN
    RAISE EXCEPTION 'control_secondary_account_same_as_primary';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_accounts AS account
    WHERE account.id = p_secondary_account_id
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.flatform_type = 'facebook'
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'control_secondary_account_not_found';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_assert_secondary_account(bigint, bigint, text, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

-- Cấu hình SMTP đúng dạng Desktop lưu: đủ 9 khoá, chuỗi rỗng khi trống, port số, secure boolean.
-- pass thiếu/null/rỗng thì dùng p_current_pass (giữ mật khẩu cũ khi sửa).
CREATE OR REPLACE FUNCTION private.aka_agent_control_normalize_email_session(p_session jsonb, p_current_pass text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_secure boolean;
  v_port_text text;
  v_port numeric;
  v_pass text;
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_session) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;
  v_secure := jsonb_typeof(p_session->'secure') = 'boolean' AND (p_session->>'secure')::boolean;
  v_port_text := btrim(COALESCE(p_session->>'port', ''));
  IF jsonb_typeof(p_session->'port') IN ('number', 'string') AND v_port_text ~ '^[0-9]{1,9}(\.[0-9]+)?$' THEN
    v_port := floor(v_port_text::numeric);
  END IF;
  IF v_port IS NULL OR v_port < 1 OR v_port > 65535 THEN
    v_port := CASE WHEN v_secure THEN 465 ELSE 587 END;
  END IF;
  v_pass := CASE WHEN jsonb_typeof(p_session->'pass') = 'string' AND p_session->>'pass' <> ''
    THEN p_session->>'pass' ELSE p_current_pass END;
  v_result := jsonb_build_object(
    'brandName', btrim(COALESCE(p_session->>'brandName', '')),
    'host', btrim(COALESCE(p_session->>'host', '')),
    'port', v_port::integer,
    'secure', v_secure,
    'user', btrim(COALESCE(p_session->>'user', '')),
    'pass', COALESCE(v_pass, ''),
    'fromEmail', btrim(COALESCE(p_session->>'fromEmail', '')),
    'replyTo', btrim(COALESCE(p_session->>'replyTo', '')),
    'cc', btrim(COALESCE(p_session->>'cc', ''))
  );
  IF v_result->>'host' = '' OR v_result->>'fromEmail' = '' OR v_result->>'user' = '' OR v_result->>'pass' = ''
    OR length(v_result->>'host') > 500 OR length(v_result->>'fromEmail') > 500
    OR length(v_result->>'user') > 500 OR length(v_result->>'brandName') > 500
    OR length(v_result->>'pass') > 1000 OR length(v_result->>'replyTo') > 2000
    OR length(v_result->>'cc') > 2000 THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_normalize_email_session(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

-- Tài khoản Email trả về API: không bao giờ có mật khẩu (thay bằng email_session.hasPassword).
CREATE OR REPLACE FUNCTION private.aka_agent_control_email_account_view(p_account public.auto_accounts)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'id', p_account.id,
    'name', p_account.name,
    'flatform_type', p_account.flatform_type,
    'status', p_account.status,
    'login_status', p_account.login_status,
    'is_active', p_account.is_active,
    'account_group_id', p_account.account_group_id,
    'proxy_id', p_account.proxy_id,
    'created_at', p_account.created_at,
    'updated_at', p_account.updated_at,
    'email_session', CASE WHEN jsonb_typeof(p_account.email_session) = 'object'
      THEN (p_account.email_session - 'pass')
        || jsonb_build_object('hasPassword', COALESCE(p_account.email_session->>'pass', '') <> '')
      END,
    'email_session_updated_at', p_account.email_session_updated_at,
    'email_session_last_verified_at', p_account.email_session_last_verified_at,
    'email_session_last_error', p_account.email_session_last_error
  )
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_email_account_view(public.auto_accounts) FROM PUBLIC, anon, authenticated, service_role;

-- 3. Tài khoản Email SMTP từ Web (chỉ service_role). Dòng giống dòng Desktop tạo (tạo rồi lưu cấu hình).
CREATE OR REPLACE FUNCTION public.create_control_email_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_name text,
  p_session jsonb,
  p_verified boolean,
  p_verify_error text DEFAULT NULL,
  p_max_accounts integer DEFAULT NULL,
  p_account_group_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_session jsonb;
  v_account public.auto_accounts%ROWTYPE;
  v_account_count integer := 0;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_name = '' OR length(v_name) > 255 OR p_verified IS NULL
    OR (p_account_group_id IS NOT NULL AND p_account_group_id <= 0) THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;
  v_session := private.aka_agent_control_normalize_email_session(p_session, NULL);

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  -- Cùng thứ tự khoá tài nguyên với create_control_zalo_account_atomic và trigger lock_auto_account_control_resources.
  IF p_account_group_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account-group:' || p_account_group_id::text, 0));
    PERFORM account_group.id
    FROM public.auto_account_groups AS account_group
    WHERE account_group.id = p_account_group_id
      AND account_group.staff_id = p_staff_id
      AND account_group.organization_id = p_organization_id
      AND account_group.flatform_type = 'email'
      AND COALESCE(account_group.is_delete, false) = false
    FOR UPDATE OF account_group;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('created', false, 'reason', 'account_group_not_found');
    END IF;
  END IF;

  -- Gói Email (sản phẩm 13) còn hạn theo ngày Việt Nam, cùng luật capabilities.email của phiên.
  IF NOT EXISTS (
    SELECT 1 FROM public.org_organization_product AS entitlement
    WHERE entitlement.organization_id = p_organization_id
      AND entitlement.is_deleted = false
      AND entitlement.product_id = 13
      AND entitlement.expiration_date >= v_vietnam_day_start
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'capability_unavailable');
  END IF;

  -- Cùng khoá hạn mức tài khoản theo nhân viên với create_control_zalo_account_atomic và trigger tách quyền.
  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:' || p_staff_id::text, 0));
  SELECT count(*)::integer
  INTO v_account_count
  FROM public.auto_accounts AS account
  WHERE account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'email'
    AND COALESCE(account.is_delete, false) = false;
  -- Tổ chức đã tách quyền: trigger app_access_guard_flags kiểm hạn mức theo ứng dụng (như Zalo).
  IF NOT public.aka_agent_app_access_separate(p_organization_id)
    AND p_max_accounts IS NOT NULL AND p_max_accounts > 0
    AND v_account_count >= p_max_accounts THEN
    RETURN jsonb_build_object('created', false, 'reason', 'account_limit_reached', 'max_accounts', p_max_accounts);
  END IF;

  INSERT INTO public.auto_accounts (
    name, flatform_type, is_zalo_show_web, is_zalo_server, login_status, status, is_active,
    rate_limit_minutes, account_group_id, proxy_id, staff_id, organization_id, is_delete,
    email_session, email_session_updated_at, email_session_last_verified_at, email_session_last_error
  )
  VALUES (
    v_name, 'email', false, false,
    CASE WHEN p_verified THEN 'đã đăng nhập' ELSE 'chưa đăng nhập' END,
    'chờ xử lý', true, 65, p_account_group_id, NULL, p_staff_id, p_organization_id, false,
    v_session, now(),
    CASE WHEN p_verified THEN now() END,
    CASE WHEN p_verified THEN NULL ELSE left(NULLIF(btrim(COALESCE(p_verify_error, '')), ''), 2000) END
  )
  RETURNING * INTO v_account;

  RETURN jsonb_build_object(
    'created', true,
    'account_id', v_account.id,
    'account', private.aka_agent_control_email_account_view(v_account)
  );
END
$function$;
REVOKE ALL ON FUNCTION public.create_control_email_account_atomic(bigint, bigint, text, jsonb, boolean, text, integer, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.create_control_email_account_atomic(bigint, bigint, text, jsonb, boolean, text, integer, bigint)
  TO service_role;

-- Sửa: so khớp updated_at. p_name/p_session null = giữ; p_session thiếu pass = giữ mật khẩu cũ.
-- p_account_group_id là giá trị đích (null = bỏ nhóm). Đổi cấu hình thì phải kèm kết quả kiểm tra (p_verified).
CREATE OR REPLACE FUNCTION public.update_control_email_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint,
  p_expected_updated_at timestamptz,
  p_name text,
  p_session jsonb,
  p_verified boolean,
  p_verify_error text,
  p_account_group_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_session jsonb;
  v_error text := left(NULLIF(btrim(COALESCE(p_verify_error, '')), ''), 2000);
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF p_expected_updated_at IS NULL
    OR (p_name IS NOT NULL AND (btrim(p_name) = '' OR length(btrim(p_name)) > 255))
    OR (p_session IS NOT NULL AND p_verified IS NULL)
    OR (p_account_group_id IS NOT NULL AND p_account_group_id <= 0) THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  IF p_account_group_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account-group:' || p_account_group_id::text, 0));
  END IF;

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type = 'email'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;
  IF v_account.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;

  IF p_account_group_id IS NOT NULL THEN
    PERFORM account_group.id
    FROM public.auto_account_groups AS account_group
    WHERE account_group.id = p_account_group_id
      AND account_group.staff_id = p_staff_id
      AND account_group.organization_id = p_organization_id
      AND account_group.flatform_type = 'email'
      AND COALESCE(account_group.is_delete, false) = false
    FOR UPDATE OF account_group;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'account_group_not_found');
    END IF;
  END IF;

  IF p_session IS NOT NULL THEN
    v_session := private.aka_agent_control_normalize_email_session(
      p_session,
      CASE WHEN jsonb_typeof(v_account.email_session) = 'object' THEN v_account.email_session->>'pass' END
    );
  END IF;

  -- Như Desktop: lưu cấu hình mới thì kết quả kiểm tra thay thế trạng thái cũ (chưa đạt: xoá mốc đã kiểm);
  -- chỉ kiểm tra lại cấu hình cũ (p_session null) thì giữ mốc đã kiểm khi chưa đạt.
  UPDATE public.auto_accounts AS account
  SET
    name = COALESCE(btrim(p_name), account.name),
    account_group_id = p_account_group_id,
    email_session = COALESCE(v_session, account.email_session),
    email_session_updated_at = CASE WHEN v_session IS NOT NULL THEN now() ELSE account.email_session_updated_at END,
    login_status = CASE
      WHEN p_verified IS TRUE THEN 'đã đăng nhập'
      WHEN p_verified IS FALSE THEN 'chưa đăng nhập'
      ELSE account.login_status
    END,
    email_session_last_verified_at = CASE
      WHEN p_verified IS TRUE THEN now()
      WHEN p_verified IS FALSE AND v_session IS NOT NULL THEN NULL
      ELSE account.email_session_last_verified_at
    END,
    email_session_last_error = CASE
      WHEN p_verified IS TRUE THEN NULL
      WHEN p_verified IS FALSE THEN v_error
      ELSE account.email_session_last_error
    END,
    updated_at = now()
  WHERE account.id = p_account_id
  RETURNING * INTO v_account;

  RETURN jsonb_build_object(
    'updated', true,
    'account', private.aka_agent_control_email_account_view(v_account)
  );
END
$function$;
REVOKE ALL ON FUNCTION public.update_control_email_account_atomic(bigint, bigint, bigint, timestamptz, text, jsonb, boolean, text, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.update_control_email_account_atomic(bigint, bigint, bigint, timestamptz, text, jsonb, boolean, text, bigint)
  TO service_role;

-- Xoá mềm như xoá tài khoản từ Web; từ chối khi tài khoản đang chạy hoặc còn chiến dịch đang chạy/giữ lease.
CREATE OR REPLACE FUNCTION public.delete_control_email_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;

  SELECT account.status
  INTO v_status
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type = 'email'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  IF v_status = 'đang chạy' THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'account_running');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND COALESCE(campaign.is_delete, false) = false
      AND (campaign.status = 'đang chạy'
        OR campaign.runtime_claim_token IS NOT NULL
        OR campaign.runtime_unit_token IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  UPDATE public.auto_accounts AS account
  SET is_delete = true, is_active = false, updated_at = now()
  WHERE account.id = p_account_id;

  RETURN jsonb_build_object('deleted', true, 'account_id', p_account_id);
END
$function$;
REVOKE ALL ON FUNCTION public.delete_control_email_account_atomic(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.delete_control_email_account_atomic(bigint, bigint, bigint) TO service_role;

-- Cấu hình đầy đủ (kể cả mật khẩu) chỉ để API kiểm tra kết nối SMTP khi sửa mà không nhập lại mật khẩu.
CREATE OR REPLACE FUNCTION public.aka_agent_control_email_account_session(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type = 'email'
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'account_id', v_account.id,
    'name', v_account.name,
    'account_group_id', v_account.account_group_id,
    'login_status', v_account.login_status,
    'updated_at', v_account.updated_at,
    'session', CASE WHEN jsonb_typeof(v_account.email_session) = 'object' THEN v_account.email_session END
  );
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_email_account_session(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_email_account_session(bigint, bigint, bigint) TO service_role;

-- 4. Liên kết chiến dịch tìm data → chiến dịch đích (thay cho đọc–sửa–ghi ở client). Một câu UPDATE trên
-- các chiến dịch nguồn đã khoá theo thứ tự id; thêm/bớt lặp lại không đổi gì.
CREATE OR REPLACE FUNCTION public.aka_agent_control_link_find_data_target(
  p_staff_id bigint,
  p_organization_id bigint,
  p_source_campaign_ids bigint[],
  p_target_campaign_id bigint,
  p_target_key text,
  p_add boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  -- Khoá đích (form Desktop FIND_DATA_TARGET_FIELDS) → loại chiến dịch đích (campaignScheduler.getFindDataTargetCampaignField).
  c_target_actions constant jsonb := '{
    "findUidTargetCampaignIds": "facebook_message_uid",
    "findPostLinkTargetCampaignIds": "facebook_comment_seeding_post",
    "findPhoneZaloMessagePhoneTargetCampaignIds": "zalo_message_phone",
    "findZaloGroupLinkJoinTargetCampaignIds": "zalo_join_group_link",
    "findFacebookGroupPostTargetCampaignIds": "facebook_group_post",
    "findFacebookGroupCommentTargetCampaignIds": "facebook_comment_seeding",
    "findFacebookGroupJoinTargetCampaignIds": "facebook_join_group"
  }';
  v_expected_action text;
  v_sources bigint[];
  v_found bigint[];
  v_missing bigint[];
  v_changed bigint[];
  v_target_action text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_target_campaign_id IS NULL OR p_target_campaign_id <= 0 OR p_add IS NULL
    OR p_source_campaign_ids IS NULL OR cardinality(p_source_campaign_ids) < 1
    OR cardinality(p_source_campaign_ids) > 200
    OR EXISTS (SELECT 1 FROM unnest(p_source_campaign_ids) AS source(id) WHERE source.id IS NULL OR source.id <= 0)
    OR p_target_campaign_id = ANY(p_source_campaign_ids) THEN
    RAISE EXCEPTION 'invalid_find_data_link_payload';
  END IF;
  v_expected_action := c_target_actions->>p_target_key;
  IF p_target_key IS NULL OR v_expected_action IS NULL THEN
    RAISE EXCEPTION 'invalid_find_data_target_key';
  END IF;
  SELECT array_agg(DISTINCT source.id ORDER BY source.id) INTO v_sources
  FROM unnest(p_source_campaign_ids) AS source(id);

  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id AND staff.is_active IS TRUE
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive_control_staff');
  END IF;

  IF p_add THEN
    SELECT target.action_id INTO v_target_action
    FROM public.auto_campaigns AS target
    WHERE target.id = p_target_campaign_id
      AND target.staff_id = p_staff_id
      AND target.organization_id = p_organization_id
      AND COALESCE(target.is_delete, false) = false;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'target_not_found');
    END IF;
    IF v_target_action IS DISTINCT FROM v_expected_action THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'target_action_mismatch');
    END IF;
  END IF;

  -- Khoá nguồn theo thứ tự id rồi mới kiểm: nguồn phải là chiến dịch tìm data của đúng nhân viên, chưa xoá.
  WITH locked AS MATERIALIZED (
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = ANY(v_sources)
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false
      AND campaign.action_id IN ('facebook_find_data_group', 'facebook_find_data_search')
    ORDER BY campaign.id
    FOR UPDATE OF campaign
  )
  SELECT array_agg(locked.id ORDER BY locked.id) INTO v_found FROM locked;
  SELECT array_agg(source.id ORDER BY source.id) INTO v_missing
  FROM unnest(v_sources) AS source(id)
  WHERE NOT source.id = ANY(COALESCE(v_found, ARRAY[]::bigint[]));
  IF v_missing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_not_found', 'sourceIds', to_jsonb(v_missing));
  END IF;

  WITH changed AS (
    UPDATE public.auto_campaigns AS campaign
    SET extra_settings = jsonb_set(
          CASE WHEN jsonb_typeof(campaign.extra_settings) = 'object' THEN campaign.extra_settings ELSE '{}'::jsonb END,
          ARRAY[p_target_key],
          CASE WHEN p_add THEN
            CASE WHEN jsonb_typeof(campaign.extra_settings->p_target_key) = 'array'
              THEN campaign.extra_settings->p_target_key ELSE '[]'::jsonb END
            || to_jsonb(p_target_campaign_id)
          ELSE
            COALESCE((
              SELECT jsonb_agg(item.value ORDER BY item.ordinality)
              FROM jsonb_array_elements(campaign.extra_settings->p_target_key) WITH ORDINALITY AS item(value, ordinality)
              WHERE NOT ((item.value #>> '{}') ~ '^[0-9]+$' AND (item.value #>> '{}')::numeric = p_target_campaign_id)
            ), '[]'::jsonb)
          END,
          true
        ),
        updated_at = now()
    WHERE campaign.id = ANY(v_found)
      -- Chỉ ghi dòng cần đổi: thêm khi chưa có, bớt khi đang có (so theo số, nhận cả id dạng chuỗi).
      AND p_add IS DISTINCT FROM (
        CASE WHEN jsonb_typeof(campaign.extra_settings->p_target_key) = 'array' THEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(campaign.extra_settings->p_target_key) AS item(value)
          WHERE (item.value #>> '{}') ~ '^[0-9]+$' AND (item.value #>> '{}')::numeric = p_target_campaign_id
        ) ELSE false END
      )
    RETURNING campaign.id
  )
  SELECT array_agg(changed.id ORDER BY changed.id) INTO v_changed FROM changed;

  RETURN jsonb_build_object(
    'ok', true,
    'changedSourceIds', to_jsonb(COALESCE(v_changed, ARRAY[]::bigint[])),
    'unchangedSourceIds', to_jsonb(COALESCE((
      SELECT array_agg(source.id ORDER BY source.id) FROM unnest(v_found) AS source(id)
      WHERE NOT source.id = ANY(COALESCE(v_changed, ARRAY[]::bigint[]))
    ), ARRAY[]::bigint[]))
  );
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_link_find_data_target(bigint, bigint, bigint[], bigint, text, boolean)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_link_find_data_target(bigint, bigint, bigint[], bigint, text, boolean)
  TO service_role;

-- 5. Bộ chạy Desktop ghi từng khoá extra_settings (thay cho ghi cả khối từ bản trong RAM). SECURITY INVOKER:
-- quyền cột và RLS desktop_owned_resource của phiên Desktop quyết định dòng nào được ghi.
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_merge_campaign_runtime_settings(
  p_campaign_id bigint,
  p_set jsonb DEFAULT '{}'::jsonb,
  p_remove text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_set jsonb := COALESCE(p_set, '{}'::jsonb);
  v_remove text[] := COALESCE(p_remove, ARRAY[]::text[]);
  v_updated_at timestamptz;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR jsonb_typeof(v_set) IS DISTINCT FROM 'object'
    OR cardinality(v_remove) > 100
    OR (SELECT count(*) FROM jsonb_object_keys(v_set)) > 100
    OR EXISTS (SELECT 1 FROM unnest(v_remove) AS removed(key) WHERE removed.key IS NULL) THEN
    RAISE EXCEPTION 'invalid_campaign_runtime_settings';
  END IF;
  UPDATE public.auto_campaigns AS campaign
  SET extra_settings = (
        CASE WHEN jsonb_typeof(campaign.extra_settings) = 'object' THEN campaign.extra_settings ELSE '{}'::jsonb END
        - v_remove
      ) || v_set,
      updated_at = now()
  WHERE campaign.id = p_campaign_id
  RETURNING campaign.updated_at INTO v_updated_at;
  RETURN jsonb_build_object('updated', v_updated_at IS NOT NULL, 'updatedAt', v_updated_at);
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_merge_campaign_runtime_settings(bigint, jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_merge_campaign_runtime_settings(bigint, jsonb, text[]) TO aka_agent_desktop;

-- 6. Vá định nghĩa live đã kiểm md5. Mỗi phép thay phải khớp đúng số lần.
CREATE OR REPLACE FUNCTION pg_temp.v530_replace(
  p_definition text, p_old text, p_new text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  v_count := (length(p_definition) - length(replace(p_definition, p_old, ''))) / greatest(length(p_old), 1);
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v530_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN replace(p_definition, p_old, p_new);
END
$helper$;

DO $migration$
DECLARE
  specs constant jsonb := $specs$[
    {"signature":"private.aka_agent_web_facebook_campaigns_policy(bigint)",
     "source":"592f487518ef14f3bef6f0c7177f2ab5","target":"a49d994aa8f5847a0ccd35e4017504f1"},
    {"signature":"public.aka_agent_authenticate_control_session(text)",
     "source":"692e2a068ce51377f6bd71fec20a8b0c","target":"8012506f60ad1f00aab2b60f7bbec48c"},
    {"signature":"public.aka_agent_authenticate_control_session_chat_v2(text)",
     "source":"61e874b9b47b827d78e16c71bc9ef687","target":"e481b2473aa9dda34f91092b98ffdfbe"},
    {"signature":"public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])",
     "source":"367cf7ba9d72aff72c4907586cf1c3ba","target":"719fcf458eabe2b16fe536de07079c77"},
    {"signature":"public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)",
     "source":"db8942b09904e535987b94745b159ca3","target":"fac3ecfdf45dff239c319656a7365a7c"},
    {"signature":"public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)",
     "source":"6030f0d9c8429e36955a405920f751f9","target":"ed7f9d447f72019feca71d717fd4e1bd"},
    {"signature":"public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)",
     "source":"87f7002ac924f647896a7635663562b5","target":"2d3fbc42cc31e57138cdc99554af9254"},
    {"signature":"public.delete_control_campaign_atomic(bigint,bigint,bigint)",
     "source":"2af929cc5e02683e5e9dc16a48cc9bac","target":"2ede03119ec482102e1647c0b1bae220"},
    {"signature":"public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)",
     "source":"61a6b5c855fbcf86cafaf3c3c7ce6f0a","target":"252ae351970aa1c0b19d356faad94540"},
    {"signature":"public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)",
     "source":"a86278195e18d1ef8d0091b41d1d0c5b","target":"0d5eb4e8e8d8d0545daf3b4b82307c30"},
    {"signature":"public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)",
     "source":"d283261c5e77558d10f5df86cd4d1127","target":"5fa5bcfd31f69db8114b82f3ade9b4a5"}
  ]$specs$::jsonb;
  -- Hàm không sửa nhưng hành vi v530 dựa vào: _v2 gọi create_control_campaign; bản theo config_version gọi
  -- update_control_campaign_atomic; trang lịch sử chạy đã nhận token theo flatform_type; wrapper chính sách
  -- Facebook gọi helper private.
  dependencies constant jsonb := $dependencies$[
    {"signature":"public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)","md5":"661579fa2e8b6571f429079dd0b89c0a"},
    {"signature":"public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)","md5":"3e1e2f8b67697d36b3c8c3830586a6c2"},
    {"signature":"public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)","md5":"26875e2b1652ca56cc8e59460df8cae1"},
    {"signature":"public.aka_agent_control_web_facebook_campaigns_policy(bigint)","md5":"7f487421358f987502dc2bc6405dae0b"}
  ]$dependencies$::jsonb;
  c_facebook_policy constant text := $facebook_policy$CREATE OR REPLACE FUNCTION private.aka_agent_web_facebook_campaigns_policy(p_organization_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text;
  v_value jsonb;
  v_orgs jsonb;
  v_enabled boolean := false;
  v_authoring jsonb;
  v_authoring_orgs jsonb;
  v_action_ids jsonb;
  v_authoring_enabled boolean := false;
  c_closed constant jsonb := '{"enabled":false,"facebookOnlyLogin":false,"authoring":{"enabled":false,"actionIds":[]}}';
BEGIN
  IF p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RETURN c_closed;
  END IF;
  SELECT setting.value INTO v_raw
  FROM public.auto_system_settings AS setting
  WHERE setting.key = 'web.facebook_campaigns'
    AND setting.is_active IS TRUE
    AND setting.is_secret IS NOT TRUE;
  -- Lỗi cấu hình luôn đóng tính năng, không làm hỏng xác thực.
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN c_closed;
  END IF;
  v_value := v_raw::jsonb;
  IF jsonb_typeof(v_value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean' THEN
    RETURN c_closed;
  END IF;
  v_enabled := (v_value->>'enabled')::boolean;
  v_orgs := v_value->'organizationIds';
  IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
    v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
  END IF;
  -- V530: nhánh soạn (tạo/sửa trên Web/iOS), lọc tiếp trong tập tổ chức đã qua organizationIds ngoài.
  -- authoring.actionIds: thiếu/null = mọi loại API hỗ trợ; mảng chuỗi khác rỗng = chỉ các loại đó; sai kiểu = tắt.
  v_authoring := v_value->'authoring';
  IF v_enabled AND jsonb_typeof(v_authoring) = 'object'
     AND jsonb_typeof(v_authoring->'enabled') = 'boolean' THEN
    v_authoring_enabled := (v_authoring->>'enabled')::boolean;
    v_authoring_orgs := v_authoring->'organizationIds';
    IF v_authoring_enabled AND v_authoring_orgs IS NOT NULL AND jsonb_typeof(v_authoring_orgs) <> 'null' THEN
      v_authoring_enabled := jsonb_typeof(v_authoring_orgs) = 'array' AND v_authoring_orgs @> to_jsonb(p_organization_id);
    END IF;
    v_action_ids := v_authoring->'actionIds';
    IF jsonb_typeof(v_action_ids) = 'null' THEN
      v_action_ids := NULL;
    END IF;
    IF v_authoring_enabled AND v_action_ids IS NOT NULL THEN
      v_authoring_enabled := CASE WHEN jsonb_typeof(v_action_ids) = 'array' THEN
        jsonb_array_length(v_action_ids) > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_action_ids) AS item(value)
          WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string' OR btrim(item.value #>> '{}') = ''
        ) ELSE false END;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'facebookOnlyLogin', v_enabled
      AND jsonb_typeof(v_value->'facebookOnlyLogin') = 'boolean'
      AND (v_value->>'facebookOnlyLogin')::boolean,
    'authoring', jsonb_build_object(
      'enabled', v_authoring_enabled,
      'actionIds', CASE WHEN v_authoring_enabled THEN v_action_ids ELSE '[]'::jsonb END
    )
  );
END
$function$
$facebook_policy$;
  -- Chặn sửa khi app Desktop còn giữ lượt (hợp đồng mục 3.1).
  c_busy_guard constant text :=
    '  -- V530: chiến dịch chạy trên app Desktop (Facebook, Email, Zalo QR/trình duyệt) còn claim/unit lease và' || E'\n'
    || '  -- app Desktop của nhân viên còn báo hoạt động 2 phút gần nhất: bộ chạy có thể ghi lại cả khối extra_settings' || E'\n'
    || '  -- từ bản trong RAM, nên chưa cho sửa. App đã tắt (lease mồ côi) thì cho sửa.' || E'\n'
    || '  IF (v_campaign.runtime_claim_token IS NOT NULL OR v_campaign.runtime_unit_token IS NOT NULL)' || E'\n'
    || '    AND EXISTS (' || E'\n'
    || '      SELECT 1 FROM public.auto_accounts AS runtime_account' || E'\n'
    || '      WHERE runtime_account.id = v_campaign.account_id' || E'\n'
    || '        AND (runtime_account.flatform_type IN (''facebook'', ''email'')' || E'\n'
    || '          OR (runtime_account.flatform_type = ''zalo'' AND COALESCE(runtime_account.is_zalo_server, false) = false))' || E'\n'
    || '    )' || E'\n'
    || '    AND EXISTS (' || E'\n'
    || '      SELECT 1 FROM public.auto_staff_device_presence AS presence' || E'\n'
    || '      WHERE presence.staff_id = v_campaign.staff_id' || E'\n'
    || '        AND presence.ended_at IS NULL' || E'\n'
    || '        AND presence.last_seen_at >= now() - interval ''2 minutes''' || E'\n'
    || '    ) THEN' || E'\n'
    || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'', ''desktop_runtime_busy'', true);' || E'\n'
    || '  END IF;' || E'\n';
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
    IF f IS NULL THEN RAISE EXCEPTION 'v530_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source, r.target) THEN
      RAISE EXCEPTION 'v530_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION 'v530_unexpected_owner:%', r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_to_recordset(dependencies) AS x(signature text, md5 text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL OR md5(pg_get_functiondef(f)) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'v530_dependency_changed:%:%', r.signature, CASE WHEN f IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(f)) END;
    END IF;
  END LOOP;

  -- Dựng toàn bộ bản đích trước (chưa EXECUTE), kiểm md5 đích của mọi hàm cùng lúc.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    d := pg_get_functiondef(f);
    CONTINUE WHEN md5(d) = r.target;

    IF r.signature LIKE 'private.aka_agent_web_facebook_campaigns_policy(%' THEN
      d := c_facebook_policy;

    ELSIF r.signature LIKE 'public.aka_agent_authenticate_control_session(%'
       OR r.signature LIKE 'public.aka_agent_authenticate_control_session_chat_v2(%' THEN
      -- Hai thân giữ giống nhau ngoài nhánh phạm vi Chat (V490): cùng bốn phép thay.
      d := pg_temp.v530_replace(d,
        '  v_web_facebook_policy jsonb := ''{}''::jsonb;' || E'\n',
        '  v_web_facebook_policy jsonb := ''{}''::jsonb;' || E'\n'
        || '  v_email_enabled boolean := false;' || E'\n'
        || '  v_web_email_policy jsonb := ''{}''::jsonb;' || E'\n',
        1, 'session_declare');
      -- Cùng luật gói còn hạn như SMS/Facebook: chưa xoá, hạn tới hết ngày Việt Nam.
      d := pg_temp.v530_replace(d,
        '      AND entitlement.product_id IN (3, 10)' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n',
        '      AND entitlement.product_id IN (3, 10)' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n'
        || '  v_email_enabled := EXISTS (' || E'\n'
        || '    SELECT 1 FROM public.org_organization_product AS entitlement' || E'\n'
        || '    WHERE entitlement.organization_id = v_staff.organization_id' || E'\n'
        || '      AND entitlement.is_deleted = false' || E'\n'
        || '      AND entitlement.product_id = 13' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n',
        1, 'session_email');
      d := pg_temp.v530_replace(d,
        '  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);' || E'\n',
        '  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);' || E'\n'
        || '  v_web_email_policy := private.aka_agent_web_email_campaigns_policy(v_staff.organization_id);' || E'\n',
        1, 'session_policy');
      d := pg_temp.v530_replace(d,
        '    AND COALESCE((v_web_facebook_policy->>''facebookOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        '    AND COALESCE((v_web_facebook_policy->>''facebookOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) AND NOT (' || E'\n'
        || '    -- Tổ chức chỉ có gói Email (chạy trên app Desktop) vào Web/PWA/iOS khi chính sách bật rõ emailOnlyLogin.' || E'\n'
        || '    v_email_enabled' || E'\n'
        || '    AND v_session.client_type IN (''web'', ''pwa'', ''native'')' || E'\n'
        || '    AND COALESCE((v_web_email_policy->>''emailOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        1, 'session_gate');
      d := pg_temp.v530_replace(d,
        '      ''facebook'', v_facebook_enabled' || E'\n' || '    ),' || E'\n',
        '      ''facebook'', v_facebook_enabled,' || E'\n' || '      ''email'', v_email_enabled' || E'\n' || '    ),' || E'\n',
        1, 'session_capabilities');
      d := pg_temp.v530_replace(d,
        '    ''web_facebook_campaigns'', v_web_facebook_policy,' || E'\n',
        '    ''web_facebook_campaigns'', v_web_facebook_policy,' || E'\n'
        || '    ''web_email_campaigns'', v_web_email_policy,' || E'\n',
        1, 'session_output');

    ELSIF r.signature LIKE 'public.aka_agent_control_campaign_page(%' THEN
      d := pg_temp.v530_replace(d,
        'CASE WHEN a.flatform_type = ''facebook'' OR (a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE) THEN ''desktop''',
        'CASE WHEN a.flatform_type IN (''facebook'', ''email'') OR (a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE) THEN ''desktop''',
        1, 'page_runtime_target');
      d := pg_temp.v530_replace(d,
        '(a.flatform_type = ''facebook'' AND ''facebook'' = ANY(p_platforms))',
        '(a.flatform_type = ''facebook'' AND ''facebook'' = ANY(p_platforms)) OR (a.flatform_type = ''email'' AND ''email'' = ANY(p_platforms))',
        1, 'page_scope');

    ELSIF r.signature LIKE 'public.aka_agent_control_account_snapshot(%' THEN
      d := pg_temp.v530_replace(d,
        '(a.flatform_type=''facebook'' AND ''facebook''=ANY(p_platforms))',
        '(a.flatform_type=''facebook'' AND ''facebook''=ANY(p_platforms)) OR (a.flatform_type=''email'' AND ''email''=ANY(p_platforms))',
        3, 'snapshot_scope');
      d := pg_temp.v530_replace(d,
        'p_platforms && ARRAY[''zalo_qr'',''zalo_web'',''facebook'']::text[] THEN',
        'p_platforms && ARRAY[''zalo_qr'',''zalo_web'',''facebook'',''email'']::text[] THEN',
        1, 'snapshot_presence');

    ELSIF r.signature LIKE 'public.aka_agent_control_desktop_activity(%' THEN
      d := pg_temp.v530_replace(d,
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'', ''facebook'']::text[]) THEN',
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'', ''facebook'', ''email'']::text[]) THEN',
        1, 'activity_gate');
      d := pg_temp.v530_replace(d,
        '      a.flatform_type = ''facebook'' AS is_facebook' || E'\n',
        '      a.flatform_type = ''facebook'' AS is_facebook,' || E'\n'
        || '      a.flatform_type = ''email'' AS is_email' || E'\n',
        1, 'activity_columns');
      d := pg_temp.v530_replace(d,
        '        OR (''facebook'' = ANY(p_platforms) AND a.flatform_type = ''facebook''))' || E'\n',
        '        OR (''facebook'' = ANY(p_platforms) AND a.flatform_type = ''facebook'')' || E'\n'
        || '        OR (''email'' = ANY(p_platforms) AND a.flatform_type = ''email''))' || E'\n',
        1, 'activity_scope');
      d := pg_temp.v530_replace(d,
        '''accountType'', CASE WHEN s.is_facebook THEN ''facebook'' WHEN s.is_browser',
        '''accountType'', CASE WHEN s.is_facebook THEN ''facebook'' WHEN s.is_email THEN ''email'' WHEN s.is_browser',
        1, 'activity_account_type');

    ELSIF r.signature LIKE 'public.aka_agent_control_set_desktop_campaign_status(%' THEN
      -- Email cũng chạy trên app Desktop: cùng luật dừng ở ranh giới/lease như Facebook và Zalo Desktop.
      d := pg_temp.v530_replace(d,
        '    AND (account.flatform_type = ''facebook''' || E'\n'
        || '      OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        '    AND (account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '      OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        1, 'status_scope');

    ELSIF r.signature LIKE 'public.delete_control_campaign_atomic(%' THEN
      d := pg_temp.v530_replace(d,
        '      OR account.flatform_type = ''facebook''' || E'\n',
        '      OR account.flatform_type IN (''facebook'', ''email'')' || E'\n',
        2, 'delete_scope');
      d := pg_temp.v530_replace(d,
        '      AND (account.flatform_type = ''facebook''' || E'\n'
        || '        OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        '      AND (account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '        OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        1, 'delete_desktop_lease');

    ELSIF r.signature LIKE 'public.create_control_campaign(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '''')), '''');' || E'\n',
        '  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '''')), '''');' || E'\n'
        || '  v_secondary_account_id bigint;' || E'\n',
        1, 'create_declare');
      -- Gọi lặp cùng khoá idempotency của chiến dịch Facebook/Email phải trả lại chiến dịch đã tạo.
      d := pg_temp.v530_replace(d,
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        1, 'create_replay_scope');
      d := pg_temp.v530_replace(d,
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        1, 'create_account_scope');
      d := pg_temp.v530_replace(d,
        '    AND action.flatform_type IN (''zalo'', ''sms'')' || E'\n',
        '    AND action.flatform_type IN (''zalo'', ''sms'', ''facebook'', ''email'')' || E'\n',
        1, 'create_action_scope');
      d := pg_temp.v530_replace(d,
        '  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN' || E'\n'
        || '    RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '  END IF;' || E'\n',
        '  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN' || E'\n'
        || '    RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '  END IF;' || E'\n'
        || '  -- V530: tài khoản phụ (chỉ Facebook, loại cho phép) và dòng data Facebook (uid) / Email (email hợp lệ).' || E'\n'
        || '  v_secondary_account_id := NULLIF(p_campaign->>''secondaryAccountId'', '''')::bigint;' || E'\n'
        || '  IF v_secondary_account_id IS NOT NULL THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_secondary_account(' || E'\n'
        || '      p_staff_id, p_organization_id, v_account_platform, v_action_id, v_account_id, v_secondary_account_id);' || E'\n'
        || '  END IF;' || E'\n'
        || '  IF v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'create_secondary_inputs');
      d := pg_temp.v530_replace(d,
        '    control_idempotency_key, created_at, updated_at' || E'\n' || '  ) VALUES (' || E'\n',
        '    control_idempotency_key, created_at, updated_at, secondary_account_id' || E'\n' || '  ) VALUES (' || E'\n',
        1, 'create_insert_columns');
      d := pg_temp.v530_replace(d,
        '    v_key,' || E'\n' || '    now(),' || E'\n' || '    now()' || E'\n' || '  ) RETURNING id INTO v_campaign_id;' || E'\n',
        '    v_key,' || E'\n' || '    now(),' || E'\n' || '    now(),' || E'\n' || '    v_secondary_account_id' || E'\n'
        || '  ) RETURNING id INTO v_campaign_id;' || E'\n',
        1, 'create_insert_values');

    ELSIF r.signature LIKE 'public.update_control_campaign_atomic(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_appended_inputs integer := 0;' || E'\n',
        '  v_appended_inputs integer := 0;' || E'\n'
        || '  v_secondary_account_id bigint;' || E'\n'
        || '  -- V530: khoá extra_settings do bộ chạy sở hữu; patch không ghi được (hợp đồng mục 3.2).' || E'\n'
        || '  v_runtime_owned_keys constant text[] := ARRAY[' || E'\n'
        || '    ''sourceLinkIndex'', ''contentRotationIndex'', ''postBumpRotationIndex'',' || E'\n'
        || '    ''postBumpCreatedCampaignIdsByAccount'', ''internalSmsCreatedCampaignIdsByAccount'',' || E'\n'
        || '    ''zaloFriendDataMaterializedAt'', ''zaloFriendMaterializedCount'',' || E'\n'
        || '    ''zaloBirthdayDataMaterializedDate'', ''zaloBirthdayMaterializedCount'',' || E'\n'
        || '    ''zaloFriendRecommendationDataMaterializedAt'', ''zaloFriendRecommendationMaterializedCount'',' || E'\n'
        || '    ''zaloCancelFriendRequestDataMaterializedAt'', ''zaloCancelFriendRequestMaterializedCount''' || E'\n'
        || '  ];' || E'\n',
        1, 'update_declare');
      d := pg_temp.v530_replace(d,
        '          account.flatform_type = ''sms''' || E'\n'
        || '          OR (' || E'\n'
        || '            account.flatform_type = ''zalo''' || E'\n',
        '          account.flatform_type = ''sms''' || E'\n'
        || '          OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '          OR (' || E'\n'
        || '            account.flatform_type = ''zalo''' || E'\n',
        2, 'update_campaign_scope');
      d := pg_temp.v530_replace(d,
        '              target_account.flatform_type = ''sms''' || E'\n'
        || '              OR (' || E'\n'
        || '                target_account.flatform_type = ''zalo''' || E'\n',
        '              target_account.flatform_type = ''sms''' || E'\n'
        || '              OR (target_account.flatform_type IN (''facebook'', ''email'') AND COALESCE(target_account.is_active, true) = true)' || E'\n'
        || '              OR (' || E'\n'
        || '                target_account.flatform_type = ''zalo''' || E'\n',
        2, 'update_reassign_scope');
      d := pg_temp.v530_replace(d,
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        1, 'update_patch_account_scope');
      d := pg_temp.v530_replace(d,
        '  IF v_campaign.status = ''đang chạy'' THEN' || E'\n'
        || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'');' || E'\n'
        || '  END IF;' || E'\n',
        '  IF v_campaign.status = ''đang chạy'' THEN' || E'\n'
        || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'');' || E'\n'
        || '  END IF;' || E'\n'
        || c_busy_guard,
        2, 'update_desktop_busy_guard');
      d := pg_temp.v530_replace(d,
        '    IF NOT FOUND THEN' || E'\n'
        || '      RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n',
        '    IF NOT FOUND THEN' || E'\n'
        || '      RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n'
        || E'\n'
        || '  -- V530: tài khoản phụ chỉ Facebook ở loại cho phép. Khoá patch ''secondary_account_id'': có = ghi, null = xoá.' || E'\n'
        || '  IF p_campaign_patch ? ''secondaryAccountId'' THEN' || E'\n'
        || '    RAISE EXCEPTION ''invalid_control_campaign_update_payload'';' || E'\n'
        || '  END IF;' || E'\n'
        || '  v_secondary_account_id := CASE WHEN p_campaign_patch ? ''secondary_account_id''' || E'\n'
        || '    THEN NULLIF(p_campaign_patch->>''secondary_account_id'', '''')::bigint ELSE v_campaign.secondary_account_id END;' || E'\n'
        || '  IF v_secondary_account_id IS NOT NULL AND (p_campaign_patch ? ''secondary_account_id''' || E'\n'
        || '    OR (v_account_platform IN (''facebook'', ''email'') AND (p_campaign_patch ? ''account_id'' OR p_campaign_patch ? ''action_id''))) THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_secondary_account(' || E'\n'
        || '      p_staff_id, p_organization_id, v_account_platform, v_target_action_id,' || E'\n'
        || '      CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE v_campaign.account_id END,' || E'\n'
        || '      v_secondary_account_id);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'update_secondary_account');
      d := pg_temp.v530_replace(d,
        '    IF v_current_input_count <> p_expected_input_count THEN' || E'\n'
        || '      RETURN jsonb_build_object(''updated'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n',
        '    IF v_current_input_count <> p_expected_input_count THEN' || E'\n'
        || '      RETURN jsonb_build_object(''updated'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n'
        || '  IF p_append_inputs IS NOT NULL AND v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_append_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'update_append_inputs');
      d := pg_temp.v530_replace(d,
        '    account_id = CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE campaign.account_id END,' || E'\n',
        '    account_id = CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE campaign.account_id END,' || E'\n'
        || '    secondary_account_id = CASE WHEN p_campaign_patch ? ''secondary_account_id'' THEN v_secondary_account_id ELSE campaign.secondary_account_id END,' || E'\n',
        1, 'update_set_secondary');
      d := pg_temp.v530_replace(d,
        '    extra_settings = CASE WHEN p_campaign_patch ? ''extra_settings'' THEN p_campaign_patch->''extra_settings'' ELSE campaign.extra_settings END,' || E'\n',
        '    extra_settings = CASE WHEN p_campaign_patch ? ''extra_settings'' THEN' || E'\n'
        || '      CASE WHEN jsonb_typeof(p_campaign_patch->''extra_settings'') = ''object'' THEN' || E'\n'
        || '        ((p_campaign_patch->''extra_settings'') - v_runtime_owned_keys)' || E'\n'
        || '        || COALESCE((' || E'\n'
        || '          SELECT jsonb_object_agg(owned.key, owned.value)' || E'\n'
        || '          FROM jsonb_each(CASE WHEN jsonb_typeof(campaign.extra_settings) = ''object''' || E'\n'
        || '            THEN campaign.extra_settings ELSE ''{}''::jsonb END) AS owned' || E'\n'
        || '          WHERE owned.key = ANY(v_runtime_owned_keys)' || E'\n'
        || '        ), ''{}''::jsonb)' || E'\n'
        || '      ELSE p_campaign_patch->''extra_settings'' END' || E'\n'
        || '    ELSE campaign.extra_settings END,' || E'\n',
        1, 'update_runtime_owned_keys');
      -- Chiến dịch chạy trên Desktop chỉ đổi trạng thái qua aka_agent_control_set_desktop_campaign_status.
      d := pg_temp.v530_replace(d,
        '      WHEN v_account_platform = ''zalo'' THEN campaign.status' || E'\n',
        '      WHEN v_account_platform IN (''zalo'', ''facebook'', ''email'') THEN campaign.status' || E'\n',
        1, 'update_status');

    ELSIF r.signature LIKE 'public.add_control_campaign_input_rows(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_inserted integer := 0;' || E'\n',
        '  v_inserted integer := 0;' || E'\n' || '  v_account_platform text;' || E'\n',
        1, 'append_declare');
      d := pg_temp.v530_replace(d,
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        2, 'append_scope');
      d := pg_temp.v530_replace(d,
        '  SELECT campaign.status' || E'\n' || '  INTO v_campaign_status' || E'\n',
        '  SELECT campaign.status, account.flatform_type' || E'\n' || '  INTO v_campaign_status, v_account_platform' || E'\n',
        1, 'append_platform');
      d := pg_temp.v530_replace(d,
        '  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN' || E'\n'
        || '    RETURN jsonb_build_object(''inserted'', 0, ''created'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '  END IF;' || E'\n',
        '  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN' || E'\n'
        || '    RETURN jsonb_build_object(''inserted'', 0, ''created'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '  END IF;' || E'\n'
        || '  -- V530: dòng data Facebook phải có uid, Email phải có email hợp lệ.' || E'\n'
        || '  IF v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'append_inputs');
    END IF;

    IF md5(d) IS DISTINCT FROM r.target THEN
      mismatches := mismatches || (r.signature || '=' || md5(d));
    END IF;
    patched := patched || jsonb_build_object(r.signature, d);
    pending := pending + 1;
  END LOOP;
  IF cardinality(mismatches) > 0 THEN
    RAISE EXCEPTION 'v530_target_checksum_mismatch:%', array_to_string(mismatches, ' ');
  END IF;
  -- v530:apply-begin (scripts/build-v530-sql.py thay đoạn tới apply-end trong script so sánh chỉ đọc)
  IF pending = 0 THEN
    RAISE NOTICE 'v530 đã được apply trước đó; không đổi gì.';
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
      RAISE EXCEPTION 'v530_attributes_changed:%', r.signature;
    END IF;
  END LOOP;

  -- Postflight: mọi hàm vá ở bản đích; hàm mới đúng bản v530 và đúng quyền.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.signature))) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v530_postflight_failed:%', r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_to_recordset($new_functions$[
    {"signature":"private.aka_agent_web_email_campaigns_policy(bigint)","target":"2d131332e8d0fa54b4669f51a8fe92d8","acl":"{postgres=X/postgres}"},
    {"signature":"public.aka_agent_control_web_email_campaigns_policy(bigint)","target":"70616ad6489372725cca33b09da41852","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"private.aka_agent_control_assert_campaign_inputs(text,jsonb)","target":"80972291d75cec5383aab3a28838b7b6","acl":"{postgres=X/postgres}"},
    {"signature":"private.aka_agent_control_assert_secondary_account(bigint,bigint,text,text,bigint,bigint)","target":"fa594cff527fcf2f553c9f376d67dc41","acl":"{postgres=X/postgres}"},
    {"signature":"private.aka_agent_control_normalize_email_session(jsonb,text)","target":"7068bce7f45562f1f4ebcb2fb902a89b","acl":"{postgres=X/postgres}"},
    {"signature":"private.aka_agent_control_email_account_view(public.auto_accounts)","target":"c6c2b3218cf5946c7d4fa3cc23d0f429","acl":"{postgres=X/postgres}"},
    {"signature":"public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)","target":"496a0182daaa9c944119a9744fcf41eb","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)","target":"6f0f9fefac37de258d34c55deebd2cfd","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.delete_control_email_account_atomic(bigint,bigint,bigint)","target":"b912bdab82a4669569b184e46f166da0","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.aka_agent_control_email_account_session(bigint,bigint,bigint)","target":"2ee2b490a2f9224a9d8ac63a1683040f","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)","target":"84182eb3960fd1952037e80e183036fa","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])","target":"2e3bf66477ad78cf90eba64e1626e8d2","acl":"{postgres=X/postgres,aka_agent_desktop=X/postgres}"}
  ]$new_functions$::jsonb) AS x(signature text, target text, acl text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL OR md5(pg_get_functiondef(f)) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v530_new_function_postflight:%:%', r.signature, CASE WHEN f IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(f)) END;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proacl::text = r.acl) THEN
      RAISE EXCEPTION 'v530_unexpected_new_function_acl:%:%', r.signature, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = f);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.email_campaigns') THEN
    RAISE EXCEPTION 'v530_email_policy_missing';
  END IF;
  -- v530:apply-end
END
$migration$;

-- Không reload schema thủ công: giữ cơ chế event trigger DDL hiện có.

-- Ghi lịch sử migration giống apply_migration (version = giờ UTC).
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'),
  'migration_v530_web_facebook_email_authoring',
  ARRAY[$v530_statements$-- v530: Web/PWA và app iOS tạo, sửa chiến dịch Facebook và Email (vẫn chỉ chạy trên app Desktop),
-- tài khoản Email SMTP từ Web, liên kết chiến dịch tìm data, và RPC để bộ chạy Desktop ghi từng khoá
-- extra_settings. Hợp đồng: akaAgentWebApp docs/FACEBOOK_EMAIL_AUTHORING_IMPLEMENTATION.md mục 3;
-- tài liệu: docs/WEB_FACEBOOK_EMAIL_AUTHORING_V530.md.
--
-- 1. Chính sách: private.aka_agent_web_facebook_campaigns_policy trả thêm authoring {enabled, actionIds}
--    (giá trị dòng 'web.facebook_campaigns' không đổi; thiếu nhánh authoring = tắt). Khoá mới
--    'web.email_campaigns' (mặc định tắt) + private.aka_agent_web_email_campaigns_policy và wrapper
--    public.aka_agent_control_web_email_campaigns_policy (chỉ service_role).
-- 2. Xác thực phiên (aka_agent_authenticate_control_session và bản chat_v2 của V490, hai thân giữ giống
--    nhau): capabilities.email (sản phẩm 13 còn hạn theo ngày Việt Nam), web_email_campaigns, và cổng cho
--    tổ chức chỉ có gói Email khi chính sách bật rõ emailOnlyLogin (cùng cách facebookOnlyLogin của V476).
-- 3. Token phạm vi mới 'email' (tài khoản flatform_type = 'email', nơi chạy Desktop) cho trang chiến dịch,
--    snapshot tài khoản, tiến trình Desktop (accountType 'email'), dừng/tiếp tục và xoá chiến dịch.
--    Caller không gửi token 'email' nhận kết quả như trước.
-- 4. Tạo/sửa/thêm data (create_control_campaign, update_control_campaign_atomic,
--    add_control_campaign_input_rows) nhận tài khoản Facebook/Email của đúng nhân viên; hành động cùng
--    nền tảng; tài khoản phụ chỉ Facebook ở loại cho phép (create: p_campaign->>'secondaryAccountId',
--    update: khoá patch 'secondary_account_id', có khoá = ghi, null = xoá); dòng data Facebook phải có uid,
--    Email phải có email hợp lệ. Sửa chiến dịch chạy trên Desktop (Facebook, Email, Zalo QR/trình duyệt)
--    bị chặn khi chiến dịch còn claim/unit lease VÀ app Desktop của nhân viên còn báo hoạt động trong 2 phút
--    ({"updated":false,"reason":"campaign_running","desktop_runtime_busy":true}). Khi patch có
--    extra_settings, 13 khoá do bộ chạy sở hữu luôn lấy từ dòng hiện tại (mọi nền tảng).
--    update_control_campaign_by_config_version_atomic gọi bản trên nên có cùng luật, không sửa.
-- 5. RPC mới (chỉ service_role): tài khoản Email SMTP (tạo/sửa/xoá/đọc cấu hình đầy đủ cho API kiểm tra
--    kết nối), aka_agent_control_link_find_data_target (thêm/bớt chiến dịch đích trong find*TargetCampaignIds
--    của chiến dịch tìm data bằng một câu UPDATE). RPC mới chỉ aka_agent_desktop:
--    aka_agent_desktop_merge_campaign_runtime_settings (SECURITY INVOKER, RLS phiên Desktop).
--
-- Không đổi bảng, index, dữ liệu khách. Canonical ở repo akaAgent; repo WebApp không sao chép. Định nghĩa
-- nguồn được kiểm bằng md5 trước khi vá (bản V461/V476/V490 đang chạy trên production); lệch thì dừng.
-- CREATE OR REPLACE nên PostgREST nạp lại schema: chỉ apply ngoài giờ cao điểm.
-- Rollback: migrations/snapshots/web-facebook-email-authoring-v530/rollback.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Preflight trước mọi thay đổi: hàm mới (nếu đã có) phải đúng bản v530; cột và quyền cần dùng phải có.
DO $preflight$
DECLARE
  r record;
  f oid;
BEGIN
  FOR r IN SELECT * FROM jsonb_to_recordset($new_functions$[
    {"signature":"private.aka_agent_web_email_campaigns_policy(bigint)","target":"2d131332e8d0fa54b4669f51a8fe92d8"},
    {"signature":"public.aka_agent_control_web_email_campaigns_policy(bigint)","target":"70616ad6489372725cca33b09da41852"},
    {"signature":"private.aka_agent_control_assert_campaign_inputs(text,jsonb)","target":"80972291d75cec5383aab3a28838b7b6"},
    {"signature":"private.aka_agent_control_assert_secondary_account(bigint,bigint,text,text,bigint,bigint)","target":"fa594cff527fcf2f553c9f376d67dc41"},
    {"signature":"private.aka_agent_control_normalize_email_session(jsonb,text)","target":"7068bce7f45562f1f4ebcb2fb902a89b"},
    {"signature":"private.aka_agent_control_email_account_view(public.auto_accounts)","target":"c6c2b3218cf5946c7d4fa3cc23d0f429"},
    {"signature":"public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)","target":"496a0182daaa9c944119a9744fcf41eb"},
    {"signature":"public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)","target":"6f0f9fefac37de258d34c55deebd2cfd"},
    {"signature":"public.delete_control_email_account_atomic(bigint,bigint,bigint)","target":"b912bdab82a4669569b184e46f166da0"},
    {"signature":"public.aka_agent_control_email_account_session(bigint,bigint,bigint)","target":"2ee2b490a2f9224a9d8ac63a1683040f"},
    {"signature":"public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)","target":"84182eb3960fd1952037e80e183036fa"},
    {"signature":"public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])","target":"2e3bf66477ad78cf90eba64e1626e8d2"}
  ]$new_functions$::jsonb) AS x(signature text, target text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NOT NULL AND md5(pg_get_functiondef(f)) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v530_unexpected_existing_function:%:%', r.signature, md5(pg_get_functiondef(f));
    END IF;
  END LOOP;
  IF to_regclass('public.auto_staff_device_presence') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass
      AND attname = 'secondary_account_id' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_accounts'::regclass
      AND attname = 'email_session_last_error' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_account_groups'::regclass
      AND attname = 'flatform_type' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaign_actions'::regclass
      AND attname = 'allow_secondary_account' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v530_schema_missing';
  END IF;
  -- RPC ghi từng khoá của Desktop là SECURITY INVOKER: phiên Desktop phải có sẵn quyền cột cần dùng.
  IF NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'UPDATE')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'UPDATE')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'SELECT')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'SELECT')
    OR NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'v530_desktop_column_privileges_missing';
  END IF;
END
$preflight$;

-- 1. Chính sách Email (mặc định tắt; bật bằng cách sửa value, không cần deploy).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES (
  'web.email_campaigns',
  '{"enabled":false,"organizationIds":null,"emailOnlyLogin":false,"authoring":{"enabled":false,"organizationIds":null}}',
  'Web/PWA và app iOS quản lý chiến dịch Email chạy trên app Desktop. enabled: xem, dừng/tiếp tục, xoá; organizationIds: null = mọi tổ chức, mảng số = chỉ các tổ chức này; emailOnlyLogin: cho tổ chức chỉ có gói Email đăng nhập Web/PWA/iOS; authoring.enabled: tạo/sửa chiến dịch Email (authoring.organizationIds lọc tiếp).',
  false,
  true
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.aka_agent_web_email_campaigns_policy(p_organization_id bigint)
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
  v_authoring jsonb;
  v_authoring_orgs jsonb;
  v_authoring_enabled boolean := false;
  c_closed constant jsonb := '{"enabled":false,"emailOnlyLogin":false,"authoring":{"enabled":false}}';
BEGIN
  IF p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RETURN c_closed;
  END IF;
  SELECT setting.value INTO v_raw
  FROM public.auto_system_settings AS setting
  WHERE setting.key = 'web.email_campaigns'
    AND setting.is_active IS TRUE
    AND setting.is_secret IS NOT TRUE;
  -- Lỗi cấu hình luôn đóng tính năng, không làm hỏng xác thực.
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN c_closed;
  END IF;
  v_value := v_raw::jsonb;
  IF jsonb_typeof(v_value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean' THEN
    RETURN c_closed;
  END IF;
  v_enabled := (v_value->>'enabled')::boolean;
  v_orgs := v_value->'organizationIds';
  IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
    v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
  END IF;
  v_authoring := v_value->'authoring';
  IF v_enabled AND jsonb_typeof(v_authoring) = 'object'
     AND jsonb_typeof(v_authoring->'enabled') = 'boolean' THEN
    v_authoring_enabled := (v_authoring->>'enabled')::boolean;
    v_authoring_orgs := v_authoring->'organizationIds';
    IF v_authoring_enabled AND v_authoring_orgs IS NOT NULL AND jsonb_typeof(v_authoring_orgs) <> 'null' THEN
      v_authoring_enabled := jsonb_typeof(v_authoring_orgs) = 'array' AND v_authoring_orgs @> to_jsonb(p_organization_id);
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'emailOnlyLogin', v_enabled AND CASE WHEN jsonb_typeof(v_value->'emailOnlyLogin') = 'boolean'
      THEN (v_value->>'emailOnlyLogin')::boolean ELSE false END,
    'authoring', jsonb_build_object('enabled', v_authoring_enabled)
  );
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_web_email_campaigns_policy(bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_email_campaigns_policy(p_organization_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT private.aka_agent_web_email_campaigns_policy(p_organization_id)
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_web_email_campaigns_policy(bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_web_email_campaigns_policy(bigint) TO service_role;

-- 2. Hàm phụ dùng chung cho các RPC ghi (chỉ owner).
-- Dòng data Facebook phải có uid; Email phải có email hợp lệ (kiểm thô, API kiểm đầy đủ theo luật Desktop).
CREATE OR REPLACE FUNCTION private.aka_agent_control_assert_campaign_inputs(p_platform text, p_inputs jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row bigint;
BEGIN
  IF p_platform = 'facebook' THEN
    SELECT item.ordinality - 1 INTO v_row
    FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR NULLIF(btrim(COALESCE(item.value->>'uid', '')), '') IS NULL
    ORDER BY item.ordinality
    LIMIT 1;
    IF v_row IS NOT NULL THEN
      RAISE EXCEPTION 'control_input_uid_required' USING DETAIL = 'row=' || v_row;
    END IF;
  ELSIF p_platform = 'email' THEN
    SELECT item.ordinality - 1 INTO v_row
    FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR COALESCE(item.value->>'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       OR length(item.value->>'email') > 254
    ORDER BY item.ordinality
    LIMIT 1;
    IF v_row IS NOT NULL THEN
      RAISE EXCEPTION 'control_input_email_invalid' USING DETAIL = 'row=' || v_row;
    END IF;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_assert_campaign_inputs(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Tài khoản phụ: chỉ Facebook, loại có allow_secondary_account, cùng nhân viên/tổ chức, chưa xoá, khác tài khoản chính.
CREATE OR REPLACE FUNCTION private.aka_agent_control_assert_secondary_account(
  p_staff_id bigint,
  p_organization_id bigint,
  p_platform text,
  p_action_id text,
  p_primary_account_id bigint,
  p_secondary_account_id bigint
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_secondary_account_id IS NULL THEN
    RETURN;
  END IF;
  IF p_platform IS DISTINCT FROM 'facebook' OR NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_actions AS action
    WHERE action.id = p_action_id
      AND action.flatform_type = 'facebook'
      AND action.allow_secondary_account IS TRUE
      AND COALESCE(action.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'control_secondary_account_not_allowed';
  END IF;
  IF p_secondary_account_id = p_primary_account_id THEN
    RAISE EXCEPTION 'control_secondary_account_same_as_primary';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_accounts AS account
    WHERE account.id = p_secondary_account_id
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.flatform_type = 'facebook'
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'control_secondary_account_not_found';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_assert_secondary_account(bigint, bigint, text, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

-- Cấu hình SMTP đúng dạng Desktop lưu: đủ 9 khoá, chuỗi rỗng khi trống, port số, secure boolean.
-- pass thiếu/null/rỗng thì dùng p_current_pass (giữ mật khẩu cũ khi sửa).
CREATE OR REPLACE FUNCTION private.aka_agent_control_normalize_email_session(p_session jsonb, p_current_pass text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_secure boolean;
  v_port_text text;
  v_port numeric;
  v_pass text;
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_session) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;
  v_secure := jsonb_typeof(p_session->'secure') = 'boolean' AND (p_session->>'secure')::boolean;
  v_port_text := btrim(COALESCE(p_session->>'port', ''));
  IF jsonb_typeof(p_session->'port') IN ('number', 'string') AND v_port_text ~ '^[0-9]{1,9}(\.[0-9]+)?$' THEN
    v_port := floor(v_port_text::numeric);
  END IF;
  IF v_port IS NULL OR v_port < 1 OR v_port > 65535 THEN
    v_port := CASE WHEN v_secure THEN 465 ELSE 587 END;
  END IF;
  v_pass := CASE WHEN jsonb_typeof(p_session->'pass') = 'string' AND p_session->>'pass' <> ''
    THEN p_session->>'pass' ELSE p_current_pass END;
  v_result := jsonb_build_object(
    'brandName', btrim(COALESCE(p_session->>'brandName', '')),
    'host', btrim(COALESCE(p_session->>'host', '')),
    'port', v_port::integer,
    'secure', v_secure,
    'user', btrim(COALESCE(p_session->>'user', '')),
    'pass', COALESCE(v_pass, ''),
    'fromEmail', btrim(COALESCE(p_session->>'fromEmail', '')),
    'replyTo', btrim(COALESCE(p_session->>'replyTo', '')),
    'cc', btrim(COALESCE(p_session->>'cc', ''))
  );
  IF v_result->>'host' = '' OR v_result->>'fromEmail' = '' OR v_result->>'user' = '' OR v_result->>'pass' = ''
    OR length(v_result->>'host') > 500 OR length(v_result->>'fromEmail') > 500
    OR length(v_result->>'user') > 500 OR length(v_result->>'brandName') > 500
    OR length(v_result->>'pass') > 1000 OR length(v_result->>'replyTo') > 2000
    OR length(v_result->>'cc') > 2000 THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_normalize_email_session(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

-- Tài khoản Email trả về API: không bao giờ có mật khẩu (thay bằng email_session.hasPassword).
CREATE OR REPLACE FUNCTION private.aka_agent_control_email_account_view(p_account public.auto_accounts)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'id', p_account.id,
    'name', p_account.name,
    'flatform_type', p_account.flatform_type,
    'status', p_account.status,
    'login_status', p_account.login_status,
    'is_active', p_account.is_active,
    'account_group_id', p_account.account_group_id,
    'proxy_id', p_account.proxy_id,
    'created_at', p_account.created_at,
    'updated_at', p_account.updated_at,
    'email_session', CASE WHEN jsonb_typeof(p_account.email_session) = 'object'
      THEN (p_account.email_session - 'pass')
        || jsonb_build_object('hasPassword', COALESCE(p_account.email_session->>'pass', '') <> '')
      END,
    'email_session_updated_at', p_account.email_session_updated_at,
    'email_session_last_verified_at', p_account.email_session_last_verified_at,
    'email_session_last_error', p_account.email_session_last_error
  )
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_control_email_account_view(public.auto_accounts) FROM PUBLIC, anon, authenticated, service_role;

-- 3. Tài khoản Email SMTP từ Web (chỉ service_role). Dòng giống dòng Desktop tạo (tạo rồi lưu cấu hình).
CREATE OR REPLACE FUNCTION public.create_control_email_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_name text,
  p_session jsonb,
  p_verified boolean,
  p_verify_error text DEFAULT NULL,
  p_max_accounts integer DEFAULT NULL,
  p_account_group_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_session jsonb;
  v_account public.auto_accounts%ROWTYPE;
  v_account_count integer := 0;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_name = '' OR length(v_name) > 255 OR p_verified IS NULL
    OR (p_account_group_id IS NOT NULL AND p_account_group_id <= 0) THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;
  v_session := private.aka_agent_control_normalize_email_session(p_session, NULL);

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  -- Cùng thứ tự khoá tài nguyên với create_control_zalo_account_atomic và trigger lock_auto_account_control_resources.
  IF p_account_group_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account-group:' || p_account_group_id::text, 0));
    PERFORM account_group.id
    FROM public.auto_account_groups AS account_group
    WHERE account_group.id = p_account_group_id
      AND account_group.staff_id = p_staff_id
      AND account_group.organization_id = p_organization_id
      AND account_group.flatform_type = 'email'
      AND COALESCE(account_group.is_delete, false) = false
    FOR UPDATE OF account_group;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('created', false, 'reason', 'account_group_not_found');
    END IF;
  END IF;

  -- Gói Email (sản phẩm 13) còn hạn theo ngày Việt Nam, cùng luật capabilities.email của phiên.
  IF NOT EXISTS (
    SELECT 1 FROM public.org_organization_product AS entitlement
    WHERE entitlement.organization_id = p_organization_id
      AND entitlement.is_deleted = false
      AND entitlement.product_id = 13
      AND entitlement.expiration_date >= v_vietnam_day_start
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'capability_unavailable');
  END IF;

  -- Cùng khoá hạn mức tài khoản theo nhân viên với create_control_zalo_account_atomic và trigger tách quyền.
  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:' || p_staff_id::text, 0));
  SELECT count(*)::integer
  INTO v_account_count
  FROM public.auto_accounts AS account
  WHERE account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'email'
    AND COALESCE(account.is_delete, false) = false;
  -- Tổ chức đã tách quyền: trigger app_access_guard_flags kiểm hạn mức theo ứng dụng (như Zalo).
  IF NOT public.aka_agent_app_access_separate(p_organization_id)
    AND p_max_accounts IS NOT NULL AND p_max_accounts > 0
    AND v_account_count >= p_max_accounts THEN
    RETURN jsonb_build_object('created', false, 'reason', 'account_limit_reached', 'max_accounts', p_max_accounts);
  END IF;

  INSERT INTO public.auto_accounts (
    name, flatform_type, is_zalo_show_web, is_zalo_server, login_status, status, is_active,
    rate_limit_minutes, account_group_id, proxy_id, staff_id, organization_id, is_delete,
    email_session, email_session_updated_at, email_session_last_verified_at, email_session_last_error
  )
  VALUES (
    v_name, 'email', false, false,
    CASE WHEN p_verified THEN 'đã đăng nhập' ELSE 'chưa đăng nhập' END,
    'chờ xử lý', true, 65, p_account_group_id, NULL, p_staff_id, p_organization_id, false,
    v_session, now(),
    CASE WHEN p_verified THEN now() END,
    CASE WHEN p_verified THEN NULL ELSE left(NULLIF(btrim(COALESCE(p_verify_error, '')), ''), 2000) END
  )
  RETURNING * INTO v_account;

  RETURN jsonb_build_object(
    'created', true,
    'account_id', v_account.id,
    'account', private.aka_agent_control_email_account_view(v_account)
  );
END
$function$;
REVOKE ALL ON FUNCTION public.create_control_email_account_atomic(bigint, bigint, text, jsonb, boolean, text, integer, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.create_control_email_account_atomic(bigint, bigint, text, jsonb, boolean, text, integer, bigint)
  TO service_role;

-- Sửa: so khớp updated_at. p_name/p_session null = giữ; p_session thiếu pass = giữ mật khẩu cũ.
-- p_account_group_id là giá trị đích (null = bỏ nhóm). Đổi cấu hình thì phải kèm kết quả kiểm tra (p_verified).
CREATE OR REPLACE FUNCTION public.update_control_email_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint,
  p_expected_updated_at timestamptz,
  p_name text,
  p_session jsonb,
  p_verified boolean,
  p_verify_error text,
  p_account_group_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_session jsonb;
  v_error text := left(NULLIF(btrim(COALESCE(p_verify_error, '')), ''), 2000);
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF p_expected_updated_at IS NULL
    OR (p_name IS NOT NULL AND (btrim(p_name) = '' OR length(btrim(p_name)) > 255))
    OR (p_session IS NOT NULL AND p_verified IS NULL)
    OR (p_account_group_id IS NOT NULL AND p_account_group_id <= 0) THEN
    RAISE EXCEPTION 'invalid_control_email_account_payload';
  END IF;

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  IF p_account_group_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account-group:' || p_account_group_id::text, 0));
  END IF;

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type = 'email'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;
  IF v_account.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;

  IF p_account_group_id IS NOT NULL THEN
    PERFORM account_group.id
    FROM public.auto_account_groups AS account_group
    WHERE account_group.id = p_account_group_id
      AND account_group.staff_id = p_staff_id
      AND account_group.organization_id = p_organization_id
      AND account_group.flatform_type = 'email'
      AND COALESCE(account_group.is_delete, false) = false
    FOR UPDATE OF account_group;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'account_group_not_found');
    END IF;
  END IF;

  IF p_session IS NOT NULL THEN
    v_session := private.aka_agent_control_normalize_email_session(
      p_session,
      CASE WHEN jsonb_typeof(v_account.email_session) = 'object' THEN v_account.email_session->>'pass' END
    );
  END IF;

  -- Như Desktop: lưu cấu hình mới thì kết quả kiểm tra thay thế trạng thái cũ (chưa đạt: xoá mốc đã kiểm);
  -- chỉ kiểm tra lại cấu hình cũ (p_session null) thì giữ mốc đã kiểm khi chưa đạt.
  UPDATE public.auto_accounts AS account
  SET
    name = COALESCE(btrim(p_name), account.name),
    account_group_id = p_account_group_id,
    email_session = COALESCE(v_session, account.email_session),
    email_session_updated_at = CASE WHEN v_session IS NOT NULL THEN now() ELSE account.email_session_updated_at END,
    login_status = CASE
      WHEN p_verified IS TRUE THEN 'đã đăng nhập'
      WHEN p_verified IS FALSE THEN 'chưa đăng nhập'
      ELSE account.login_status
    END,
    email_session_last_verified_at = CASE
      WHEN p_verified IS TRUE THEN now()
      WHEN p_verified IS FALSE AND v_session IS NOT NULL THEN NULL
      ELSE account.email_session_last_verified_at
    END,
    email_session_last_error = CASE
      WHEN p_verified IS TRUE THEN NULL
      WHEN p_verified IS FALSE THEN v_error
      ELSE account.email_session_last_error
    END,
    updated_at = now()
  WHERE account.id = p_account_id
  RETURNING * INTO v_account;

  RETURN jsonb_build_object(
    'updated', true,
    'account', private.aka_agent_control_email_account_view(v_account)
  );
END
$function$;
REVOKE ALL ON FUNCTION public.update_control_email_account_atomic(bigint, bigint, bigint, timestamptz, text, jsonb, boolean, text, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.update_control_email_account_atomic(bigint, bigint, bigint, timestamptz, text, jsonb, boolean, text, bigint)
  TO service_role;

-- Xoá mềm như xoá tài khoản từ Web; từ chối khi tài khoản đang chạy hoặc còn chiến dịch đang chạy/giữ lease.
CREATE OR REPLACE FUNCTION public.delete_control_email_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;

  SELECT account.status
  INTO v_status
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type = 'email'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  IF v_status = 'đang chạy' THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'account_running');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND COALESCE(campaign.is_delete, false) = false
      AND (campaign.status = 'đang chạy'
        OR campaign.runtime_claim_token IS NOT NULL
        OR campaign.runtime_unit_token IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  UPDATE public.auto_accounts AS account
  SET is_delete = true, is_active = false, updated_at = now()
  WHERE account.id = p_account_id;

  RETURN jsonb_build_object('deleted', true, 'account_id', p_account_id);
END
$function$;
REVOKE ALL ON FUNCTION public.delete_control_email_account_atomic(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.delete_control_email_account_atomic(bigint, bigint, bigint) TO service_role;

-- Cấu hình đầy đủ (kể cả mật khẩu) chỉ để API kiểm tra kết nối SMTP khi sửa mà không nhập lại mật khẩu.
CREATE OR REPLACE FUNCTION public.aka_agent_control_email_account_session(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type = 'email'
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'account_id', v_account.id,
    'name', v_account.name,
    'account_group_id', v_account.account_group_id,
    'login_status', v_account.login_status,
    'updated_at', v_account.updated_at,
    'session', CASE WHEN jsonb_typeof(v_account.email_session) = 'object' THEN v_account.email_session END
  );
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_email_account_session(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_email_account_session(bigint, bigint, bigint) TO service_role;

-- 4. Liên kết chiến dịch tìm data → chiến dịch đích (thay cho đọc–sửa–ghi ở client). Một câu UPDATE trên
-- các chiến dịch nguồn đã khoá theo thứ tự id; thêm/bớt lặp lại không đổi gì.
CREATE OR REPLACE FUNCTION public.aka_agent_control_link_find_data_target(
  p_staff_id bigint,
  p_organization_id bigint,
  p_source_campaign_ids bigint[],
  p_target_campaign_id bigint,
  p_target_key text,
  p_add boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  -- Khoá đích (form Desktop FIND_DATA_TARGET_FIELDS) → loại chiến dịch đích (campaignScheduler.getFindDataTargetCampaignField).
  c_target_actions constant jsonb := '{
    "findUidTargetCampaignIds": "facebook_message_uid",
    "findPostLinkTargetCampaignIds": "facebook_comment_seeding_post",
    "findPhoneZaloMessagePhoneTargetCampaignIds": "zalo_message_phone",
    "findZaloGroupLinkJoinTargetCampaignIds": "zalo_join_group_link",
    "findFacebookGroupPostTargetCampaignIds": "facebook_group_post",
    "findFacebookGroupCommentTargetCampaignIds": "facebook_comment_seeding",
    "findFacebookGroupJoinTargetCampaignIds": "facebook_join_group"
  }';
  v_expected_action text;
  v_sources bigint[];
  v_found bigint[];
  v_missing bigint[];
  v_changed bigint[];
  v_target_action text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_target_campaign_id IS NULL OR p_target_campaign_id <= 0 OR p_add IS NULL
    OR p_source_campaign_ids IS NULL OR cardinality(p_source_campaign_ids) < 1
    OR cardinality(p_source_campaign_ids) > 200
    OR EXISTS (SELECT 1 FROM unnest(p_source_campaign_ids) AS source(id) WHERE source.id IS NULL OR source.id <= 0)
    OR p_target_campaign_id = ANY(p_source_campaign_ids) THEN
    RAISE EXCEPTION 'invalid_find_data_link_payload';
  END IF;
  v_expected_action := c_target_actions->>p_target_key;
  IF p_target_key IS NULL OR v_expected_action IS NULL THEN
    RAISE EXCEPTION 'invalid_find_data_target_key';
  END IF;
  SELECT array_agg(DISTINCT source.id ORDER BY source.id) INTO v_sources
  FROM unnest(p_source_campaign_ids) AS source(id);

  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id AND staff.is_active IS TRUE
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive_control_staff');
  END IF;

  IF p_add THEN
    SELECT target.action_id INTO v_target_action
    FROM public.auto_campaigns AS target
    WHERE target.id = p_target_campaign_id
      AND target.staff_id = p_staff_id
      AND target.organization_id = p_organization_id
      AND COALESCE(target.is_delete, false) = false;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'target_not_found');
    END IF;
    IF v_target_action IS DISTINCT FROM v_expected_action THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'target_action_mismatch');
    END IF;
  END IF;

  -- Khoá nguồn theo thứ tự id rồi mới kiểm: nguồn phải là chiến dịch tìm data của đúng nhân viên, chưa xoá.
  WITH locked AS MATERIALIZED (
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = ANY(v_sources)
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false
      AND campaign.action_id IN ('facebook_find_data_group', 'facebook_find_data_search')
    ORDER BY campaign.id
    FOR UPDATE OF campaign
  )
  SELECT array_agg(locked.id ORDER BY locked.id) INTO v_found FROM locked;
  SELECT array_agg(source.id ORDER BY source.id) INTO v_missing
  FROM unnest(v_sources) AS source(id)
  WHERE NOT source.id = ANY(COALESCE(v_found, ARRAY[]::bigint[]));
  IF v_missing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_not_found', 'sourceIds', to_jsonb(v_missing));
  END IF;

  WITH changed AS (
    UPDATE public.auto_campaigns AS campaign
    SET extra_settings = jsonb_set(
          CASE WHEN jsonb_typeof(campaign.extra_settings) = 'object' THEN campaign.extra_settings ELSE '{}'::jsonb END,
          ARRAY[p_target_key],
          CASE WHEN p_add THEN
            CASE WHEN jsonb_typeof(campaign.extra_settings->p_target_key) = 'array'
              THEN campaign.extra_settings->p_target_key ELSE '[]'::jsonb END
            || to_jsonb(p_target_campaign_id)
          ELSE
            COALESCE((
              SELECT jsonb_agg(item.value ORDER BY item.ordinality)
              FROM jsonb_array_elements(campaign.extra_settings->p_target_key) WITH ORDINALITY AS item(value, ordinality)
              WHERE NOT ((item.value #>> '{}') ~ '^[0-9]+$' AND (item.value #>> '{}')::numeric = p_target_campaign_id)
            ), '[]'::jsonb)
          END,
          true
        ),
        updated_at = now()
    WHERE campaign.id = ANY(v_found)
      -- Chỉ ghi dòng cần đổi: thêm khi chưa có, bớt khi đang có (so theo số, nhận cả id dạng chuỗi).
      AND p_add IS DISTINCT FROM (
        CASE WHEN jsonb_typeof(campaign.extra_settings->p_target_key) = 'array' THEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(campaign.extra_settings->p_target_key) AS item(value)
          WHERE (item.value #>> '{}') ~ '^[0-9]+$' AND (item.value #>> '{}')::numeric = p_target_campaign_id
        ) ELSE false END
      )
    RETURNING campaign.id
  )
  SELECT array_agg(changed.id ORDER BY changed.id) INTO v_changed FROM changed;

  RETURN jsonb_build_object(
    'ok', true,
    'changedSourceIds', to_jsonb(COALESCE(v_changed, ARRAY[]::bigint[])),
    'unchangedSourceIds', to_jsonb(COALESCE((
      SELECT array_agg(source.id ORDER BY source.id) FROM unnest(v_found) AS source(id)
      WHERE NOT source.id = ANY(COALESCE(v_changed, ARRAY[]::bigint[]))
    ), ARRAY[]::bigint[]))
  );
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_link_find_data_target(bigint, bigint, bigint[], bigint, text, boolean)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_link_find_data_target(bigint, bigint, bigint[], bigint, text, boolean)
  TO service_role;

-- 5. Bộ chạy Desktop ghi từng khoá extra_settings (thay cho ghi cả khối từ bản trong RAM). SECURITY INVOKER:
-- quyền cột và RLS desktop_owned_resource của phiên Desktop quyết định dòng nào được ghi.
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_merge_campaign_runtime_settings(
  p_campaign_id bigint,
  p_set jsonb DEFAULT '{}'::jsonb,
  p_remove text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_set jsonb := COALESCE(p_set, '{}'::jsonb);
  v_remove text[] := COALESCE(p_remove, ARRAY[]::text[]);
  v_updated_at timestamptz;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR jsonb_typeof(v_set) IS DISTINCT FROM 'object'
    OR cardinality(v_remove) > 100
    OR (SELECT count(*) FROM jsonb_object_keys(v_set)) > 100
    OR EXISTS (SELECT 1 FROM unnest(v_remove) AS removed(key) WHERE removed.key IS NULL) THEN
    RAISE EXCEPTION 'invalid_campaign_runtime_settings';
  END IF;
  UPDATE public.auto_campaigns AS campaign
  SET extra_settings = (
        CASE WHEN jsonb_typeof(campaign.extra_settings) = 'object' THEN campaign.extra_settings ELSE '{}'::jsonb END
        - v_remove
      ) || v_set,
      updated_at = now()
  WHERE campaign.id = p_campaign_id
  RETURNING campaign.updated_at INTO v_updated_at;
  RETURN jsonb_build_object('updated', v_updated_at IS NOT NULL, 'updatedAt', v_updated_at);
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_merge_campaign_runtime_settings(bigint, jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_merge_campaign_runtime_settings(bigint, jsonb, text[]) TO aka_agent_desktop;

-- 6. Vá định nghĩa live đã kiểm md5. Mỗi phép thay phải khớp đúng số lần.
CREATE OR REPLACE FUNCTION pg_temp.v530_replace(
  p_definition text, p_old text, p_new text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  v_count := (length(p_definition) - length(replace(p_definition, p_old, ''))) / greatest(length(p_old), 1);
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v530_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN replace(p_definition, p_old, p_new);
END
$helper$;

DO $migration$
DECLARE
  specs constant jsonb := $specs$[
    {"signature":"private.aka_agent_web_facebook_campaigns_policy(bigint)",
     "source":"592f487518ef14f3bef6f0c7177f2ab5","target":"a49d994aa8f5847a0ccd35e4017504f1"},
    {"signature":"public.aka_agent_authenticate_control_session(text)",
     "source":"692e2a068ce51377f6bd71fec20a8b0c","target":"8012506f60ad1f00aab2b60f7bbec48c"},
    {"signature":"public.aka_agent_authenticate_control_session_chat_v2(text)",
     "source":"61e874b9b47b827d78e16c71bc9ef687","target":"e481b2473aa9dda34f91092b98ffdfbe"},
    {"signature":"public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])",
     "source":"367cf7ba9d72aff72c4907586cf1c3ba","target":"719fcf458eabe2b16fe536de07079c77"},
    {"signature":"public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)",
     "source":"db8942b09904e535987b94745b159ca3","target":"fac3ecfdf45dff239c319656a7365a7c"},
    {"signature":"public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)",
     "source":"6030f0d9c8429e36955a405920f751f9","target":"ed7f9d447f72019feca71d717fd4e1bd"},
    {"signature":"public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)",
     "source":"87f7002ac924f647896a7635663562b5","target":"2d3fbc42cc31e57138cdc99554af9254"},
    {"signature":"public.delete_control_campaign_atomic(bigint,bigint,bigint)",
     "source":"2af929cc5e02683e5e9dc16a48cc9bac","target":"2ede03119ec482102e1647c0b1bae220"},
    {"signature":"public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)",
     "source":"61a6b5c855fbcf86cafaf3c3c7ce6f0a","target":"252ae351970aa1c0b19d356faad94540"},
    {"signature":"public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)",
     "source":"a86278195e18d1ef8d0091b41d1d0c5b","target":"0d5eb4e8e8d8d0545daf3b4b82307c30"},
    {"signature":"public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)",
     "source":"d283261c5e77558d10f5df86cd4d1127","target":"5fa5bcfd31f69db8114b82f3ade9b4a5"}
  ]$specs$::jsonb;
  -- Hàm không sửa nhưng hành vi v530 dựa vào: _v2 gọi create_control_campaign; bản theo config_version gọi
  -- update_control_campaign_atomic; trang lịch sử chạy đã nhận token theo flatform_type; wrapper chính sách
  -- Facebook gọi helper private.
  dependencies constant jsonb := $dependencies$[
    {"signature":"public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)","md5":"661579fa2e8b6571f429079dd0b89c0a"},
    {"signature":"public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)","md5":"3e1e2f8b67697d36b3c8c3830586a6c2"},
    {"signature":"public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)","md5":"26875e2b1652ca56cc8e59460df8cae1"},
    {"signature":"public.aka_agent_control_web_facebook_campaigns_policy(bigint)","md5":"7f487421358f987502dc2bc6405dae0b"}
  ]$dependencies$::jsonb;
  c_facebook_policy constant text := $facebook_policy$CREATE OR REPLACE FUNCTION private.aka_agent_web_facebook_campaigns_policy(p_organization_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text;
  v_value jsonb;
  v_orgs jsonb;
  v_enabled boolean := false;
  v_authoring jsonb;
  v_authoring_orgs jsonb;
  v_action_ids jsonb;
  v_authoring_enabled boolean := false;
  c_closed constant jsonb := '{"enabled":false,"facebookOnlyLogin":false,"authoring":{"enabled":false,"actionIds":[]}}';
BEGIN
  IF p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RETURN c_closed;
  END IF;
  SELECT setting.value INTO v_raw
  FROM public.auto_system_settings AS setting
  WHERE setting.key = 'web.facebook_campaigns'
    AND setting.is_active IS TRUE
    AND setting.is_secret IS NOT TRUE;
  -- Lỗi cấu hình luôn đóng tính năng, không làm hỏng xác thực.
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN c_closed;
  END IF;
  v_value := v_raw::jsonb;
  IF jsonb_typeof(v_value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean' THEN
    RETURN c_closed;
  END IF;
  v_enabled := (v_value->>'enabled')::boolean;
  v_orgs := v_value->'organizationIds';
  IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
    v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
  END IF;
  -- V530: nhánh soạn (tạo/sửa trên Web/iOS), lọc tiếp trong tập tổ chức đã qua organizationIds ngoài.
  -- authoring.actionIds: thiếu/null = mọi loại API hỗ trợ; mảng chuỗi khác rỗng = chỉ các loại đó; sai kiểu = tắt.
  v_authoring := v_value->'authoring';
  IF v_enabled AND jsonb_typeof(v_authoring) = 'object'
     AND jsonb_typeof(v_authoring->'enabled') = 'boolean' THEN
    v_authoring_enabled := (v_authoring->>'enabled')::boolean;
    v_authoring_orgs := v_authoring->'organizationIds';
    IF v_authoring_enabled AND v_authoring_orgs IS NOT NULL AND jsonb_typeof(v_authoring_orgs) <> 'null' THEN
      v_authoring_enabled := jsonb_typeof(v_authoring_orgs) = 'array' AND v_authoring_orgs @> to_jsonb(p_organization_id);
    END IF;
    v_action_ids := v_authoring->'actionIds';
    IF jsonb_typeof(v_action_ids) = 'null' THEN
      v_action_ids := NULL;
    END IF;
    IF v_authoring_enabled AND v_action_ids IS NOT NULL THEN
      v_authoring_enabled := CASE WHEN jsonb_typeof(v_action_ids) = 'array' THEN
        jsonb_array_length(v_action_ids) > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_action_ids) AS item(value)
          WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string' OR btrim(item.value #>> '{}') = ''
        ) ELSE false END;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'facebookOnlyLogin', v_enabled
      AND jsonb_typeof(v_value->'facebookOnlyLogin') = 'boolean'
      AND (v_value->>'facebookOnlyLogin')::boolean,
    'authoring', jsonb_build_object(
      'enabled', v_authoring_enabled,
      'actionIds', CASE WHEN v_authoring_enabled THEN v_action_ids ELSE '[]'::jsonb END
    )
  );
END
$function$
$facebook_policy$;
  -- Chặn sửa khi app Desktop còn giữ lượt (hợp đồng mục 3.1).
  c_busy_guard constant text :=
    '  -- V530: chiến dịch chạy trên app Desktop (Facebook, Email, Zalo QR/trình duyệt) còn claim/unit lease và' || E'\n'
    || '  -- app Desktop của nhân viên còn báo hoạt động 2 phút gần nhất: bộ chạy có thể ghi lại cả khối extra_settings' || E'\n'
    || '  -- từ bản trong RAM, nên chưa cho sửa. App đã tắt (lease mồ côi) thì cho sửa.' || E'\n'
    || '  IF (v_campaign.runtime_claim_token IS NOT NULL OR v_campaign.runtime_unit_token IS NOT NULL)' || E'\n'
    || '    AND EXISTS (' || E'\n'
    || '      SELECT 1 FROM public.auto_accounts AS runtime_account' || E'\n'
    || '      WHERE runtime_account.id = v_campaign.account_id' || E'\n'
    || '        AND (runtime_account.flatform_type IN (''facebook'', ''email'')' || E'\n'
    || '          OR (runtime_account.flatform_type = ''zalo'' AND COALESCE(runtime_account.is_zalo_server, false) = false))' || E'\n'
    || '    )' || E'\n'
    || '    AND EXISTS (' || E'\n'
    || '      SELECT 1 FROM public.auto_staff_device_presence AS presence' || E'\n'
    || '      WHERE presence.staff_id = v_campaign.staff_id' || E'\n'
    || '        AND presence.ended_at IS NULL' || E'\n'
    || '        AND presence.last_seen_at >= now() - interval ''2 minutes''' || E'\n'
    || '    ) THEN' || E'\n'
    || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'', ''desktop_runtime_busy'', true);' || E'\n'
    || '  END IF;' || E'\n';
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
    IF f IS NULL THEN RAISE EXCEPTION 'v530_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source, r.target) THEN
      RAISE EXCEPTION 'v530_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION 'v530_unexpected_owner:%', r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_to_recordset(dependencies) AS x(signature text, md5 text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL OR md5(pg_get_functiondef(f)) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'v530_dependency_changed:%:%', r.signature, CASE WHEN f IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(f)) END;
    END IF;
  END LOOP;

  -- Dựng toàn bộ bản đích trước (chưa EXECUTE), kiểm md5 đích của mọi hàm cùng lúc.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    d := pg_get_functiondef(f);
    CONTINUE WHEN md5(d) = r.target;

    IF r.signature LIKE 'private.aka_agent_web_facebook_campaigns_policy(%' THEN
      d := c_facebook_policy;

    ELSIF r.signature LIKE 'public.aka_agent_authenticate_control_session(%'
       OR r.signature LIKE 'public.aka_agent_authenticate_control_session_chat_v2(%' THEN
      -- Hai thân giữ giống nhau ngoài nhánh phạm vi Chat (V490): cùng bốn phép thay.
      d := pg_temp.v530_replace(d,
        '  v_web_facebook_policy jsonb := ''{}''::jsonb;' || E'\n',
        '  v_web_facebook_policy jsonb := ''{}''::jsonb;' || E'\n'
        || '  v_email_enabled boolean := false;' || E'\n'
        || '  v_web_email_policy jsonb := ''{}''::jsonb;' || E'\n',
        1, 'session_declare');
      -- Cùng luật gói còn hạn như SMS/Facebook: chưa xoá, hạn tới hết ngày Việt Nam.
      d := pg_temp.v530_replace(d,
        '      AND entitlement.product_id IN (3, 10)' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n',
        '      AND entitlement.product_id IN (3, 10)' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n'
        || '  v_email_enabled := EXISTS (' || E'\n'
        || '    SELECT 1 FROM public.org_organization_product AS entitlement' || E'\n'
        || '    WHERE entitlement.organization_id = v_staff.organization_id' || E'\n'
        || '      AND entitlement.is_deleted = false' || E'\n'
        || '      AND entitlement.product_id = 13' || E'\n'
        || '      AND entitlement.expiration_date >= v_vietnam_day_start' || E'\n'
        || '  );' || E'\n',
        1, 'session_email');
      d := pg_temp.v530_replace(d,
        '  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);' || E'\n',
        '  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);' || E'\n'
        || '  v_web_email_policy := private.aka_agent_web_email_campaigns_policy(v_staff.organization_id);' || E'\n',
        1, 'session_policy');
      d := pg_temp.v530_replace(d,
        '    AND COALESCE((v_web_facebook_policy->>''facebookOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        '    AND COALESCE((v_web_facebook_policy->>''facebookOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) AND NOT (' || E'\n'
        || '    -- Tổ chức chỉ có gói Email (chạy trên app Desktop) vào Web/PWA/iOS khi chính sách bật rõ emailOnlyLogin.' || E'\n'
        || '    v_email_enabled' || E'\n'
        || '    AND v_session.client_type IN (''web'', ''pwa'', ''native'')' || E'\n'
        || '    AND COALESCE((v_web_email_policy->>''emailOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        1, 'session_gate');
      d := pg_temp.v530_replace(d,
        '      ''facebook'', v_facebook_enabled' || E'\n' || '    ),' || E'\n',
        '      ''facebook'', v_facebook_enabled,' || E'\n' || '      ''email'', v_email_enabled' || E'\n' || '    ),' || E'\n',
        1, 'session_capabilities');
      d := pg_temp.v530_replace(d,
        '    ''web_facebook_campaigns'', v_web_facebook_policy,' || E'\n',
        '    ''web_facebook_campaigns'', v_web_facebook_policy,' || E'\n'
        || '    ''web_email_campaigns'', v_web_email_policy,' || E'\n',
        1, 'session_output');

    ELSIF r.signature LIKE 'public.aka_agent_control_campaign_page(%' THEN
      d := pg_temp.v530_replace(d,
        'CASE WHEN a.flatform_type = ''facebook'' OR (a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE) THEN ''desktop''',
        'CASE WHEN a.flatform_type IN (''facebook'', ''email'') OR (a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE) THEN ''desktop''',
        1, 'page_runtime_target');
      d := pg_temp.v530_replace(d,
        '(a.flatform_type = ''facebook'' AND ''facebook'' = ANY(p_platforms))',
        '(a.flatform_type = ''facebook'' AND ''facebook'' = ANY(p_platforms)) OR (a.flatform_type = ''email'' AND ''email'' = ANY(p_platforms))',
        1, 'page_scope');

    ELSIF r.signature LIKE 'public.aka_agent_control_account_snapshot(%' THEN
      d := pg_temp.v530_replace(d,
        '(a.flatform_type=''facebook'' AND ''facebook''=ANY(p_platforms))',
        '(a.flatform_type=''facebook'' AND ''facebook''=ANY(p_platforms)) OR (a.flatform_type=''email'' AND ''email''=ANY(p_platforms))',
        3, 'snapshot_scope');
      d := pg_temp.v530_replace(d,
        'p_platforms && ARRAY[''zalo_qr'',''zalo_web'',''facebook'']::text[] THEN',
        'p_platforms && ARRAY[''zalo_qr'',''zalo_web'',''facebook'',''email'']::text[] THEN',
        1, 'snapshot_presence');

    ELSIF r.signature LIKE 'public.aka_agent_control_desktop_activity(%' THEN
      d := pg_temp.v530_replace(d,
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'', ''facebook'']::text[]) THEN',
        '  IF NOT (p_platforms && ARRAY[''zalo_qr'', ''zalo_web'', ''facebook'', ''email'']::text[]) THEN',
        1, 'activity_gate');
      d := pg_temp.v530_replace(d,
        '      a.flatform_type = ''facebook'' AS is_facebook' || E'\n',
        '      a.flatform_type = ''facebook'' AS is_facebook,' || E'\n'
        || '      a.flatform_type = ''email'' AS is_email' || E'\n',
        1, 'activity_columns');
      d := pg_temp.v530_replace(d,
        '        OR (''facebook'' = ANY(p_platforms) AND a.flatform_type = ''facebook''))' || E'\n',
        '        OR (''facebook'' = ANY(p_platforms) AND a.flatform_type = ''facebook'')' || E'\n'
        || '        OR (''email'' = ANY(p_platforms) AND a.flatform_type = ''email''))' || E'\n',
        1, 'activity_scope');
      d := pg_temp.v530_replace(d,
        '''accountType'', CASE WHEN s.is_facebook THEN ''facebook'' WHEN s.is_browser',
        '''accountType'', CASE WHEN s.is_facebook THEN ''facebook'' WHEN s.is_email THEN ''email'' WHEN s.is_browser',
        1, 'activity_account_type');

    ELSIF r.signature LIKE 'public.aka_agent_control_set_desktop_campaign_status(%' THEN
      -- Email cũng chạy trên app Desktop: cùng luật dừng ở ranh giới/lease như Facebook và Zalo Desktop.
      d := pg_temp.v530_replace(d,
        '    AND (account.flatform_type = ''facebook''' || E'\n'
        || '      OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        '    AND (account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '      OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '  FOR UPDATE OF campaign, account;',
        1, 'status_scope');

    ELSIF r.signature LIKE 'public.delete_control_campaign_atomic(%' THEN
      d := pg_temp.v530_replace(d,
        '      OR account.flatform_type = ''facebook''' || E'\n',
        '      OR account.flatform_type IN (''facebook'', ''email'')' || E'\n',
        2, 'delete_scope');
      d := pg_temp.v530_replace(d,
        '      AND (account.flatform_type = ''facebook''' || E'\n'
        || '        OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        '      AND (account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '        OR (account.flatform_type = ''zalo'' AND COALESCE(account.is_zalo_server, false) = false))' || E'\n'
        || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)',
        1, 'delete_desktop_lease');

    ELSIF r.signature LIKE 'public.create_control_campaign(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '''')), '''');' || E'\n',
        '  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '''')), '''');' || E'\n'
        || '  v_secondary_account_id bigint;' || E'\n',
        1, 'create_declare');
      -- Gọi lặp cùng khoá idempotency của chiến dịch Facebook/Email phải trả lại chiến dịch đã tạo.
      d := pg_temp.v530_replace(d,
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR account.flatform_type IN (''facebook'', ''email'')' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        1, 'create_replay_scope');
      d := pg_temp.v530_replace(d,
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        1, 'create_account_scope');
      d := pg_temp.v530_replace(d,
        '    AND action.flatform_type IN (''zalo'', ''sms'')' || E'\n',
        '    AND action.flatform_type IN (''zalo'', ''sms'', ''facebook'', ''email'')' || E'\n',
        1, 'create_action_scope');
      d := pg_temp.v530_replace(d,
        '  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN' || E'\n'
        || '    RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '  END IF;' || E'\n',
        '  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN' || E'\n'
        || '    RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '  END IF;' || E'\n'
        || '  -- V530: tài khoản phụ (chỉ Facebook, loại cho phép) và dòng data Facebook (uid) / Email (email hợp lệ).' || E'\n'
        || '  v_secondary_account_id := NULLIF(p_campaign->>''secondaryAccountId'', '''')::bigint;' || E'\n'
        || '  IF v_secondary_account_id IS NOT NULL THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_secondary_account(' || E'\n'
        || '      p_staff_id, p_organization_id, v_account_platform, v_action_id, v_account_id, v_secondary_account_id);' || E'\n'
        || '  END IF;' || E'\n'
        || '  IF v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'create_secondary_inputs');
      d := pg_temp.v530_replace(d,
        '    control_idempotency_key, created_at, updated_at' || E'\n' || '  ) VALUES (' || E'\n',
        '    control_idempotency_key, created_at, updated_at, secondary_account_id' || E'\n' || '  ) VALUES (' || E'\n',
        1, 'create_insert_columns');
      d := pg_temp.v530_replace(d,
        '    v_key,' || E'\n' || '    now(),' || E'\n' || '    now()' || E'\n' || '  ) RETURNING id INTO v_campaign_id;' || E'\n',
        '    v_key,' || E'\n' || '    now(),' || E'\n' || '    now(),' || E'\n' || '    v_secondary_account_id' || E'\n'
        || '  ) RETURNING id INTO v_campaign_id;' || E'\n',
        1, 'create_insert_values');

    ELSIF r.signature LIKE 'public.update_control_campaign_atomic(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_appended_inputs integer := 0;' || E'\n',
        '  v_appended_inputs integer := 0;' || E'\n'
        || '  v_secondary_account_id bigint;' || E'\n'
        || '  -- V530: khoá extra_settings do bộ chạy sở hữu; patch không ghi được (hợp đồng mục 3.2).' || E'\n'
        || '  v_runtime_owned_keys constant text[] := ARRAY[' || E'\n'
        || '    ''sourceLinkIndex'', ''contentRotationIndex'', ''postBumpRotationIndex'',' || E'\n'
        || '    ''postBumpCreatedCampaignIdsByAccount'', ''internalSmsCreatedCampaignIdsByAccount'',' || E'\n'
        || '    ''zaloFriendDataMaterializedAt'', ''zaloFriendMaterializedCount'',' || E'\n'
        || '    ''zaloBirthdayDataMaterializedDate'', ''zaloBirthdayMaterializedCount'',' || E'\n'
        || '    ''zaloFriendRecommendationDataMaterializedAt'', ''zaloFriendRecommendationMaterializedCount'',' || E'\n'
        || '    ''zaloCancelFriendRequestDataMaterializedAt'', ''zaloCancelFriendRequestMaterializedCount''' || E'\n'
        || '  ];' || E'\n',
        1, 'update_declare');
      d := pg_temp.v530_replace(d,
        '          account.flatform_type = ''sms''' || E'\n'
        || '          OR (' || E'\n'
        || '            account.flatform_type = ''zalo''' || E'\n',
        '          account.flatform_type = ''sms''' || E'\n'
        || '          OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '          OR (' || E'\n'
        || '            account.flatform_type = ''zalo''' || E'\n',
        2, 'update_campaign_scope');
      d := pg_temp.v530_replace(d,
        '              target_account.flatform_type = ''sms''' || E'\n'
        || '              OR (' || E'\n'
        || '                target_account.flatform_type = ''zalo''' || E'\n',
        '              target_account.flatform_type = ''sms''' || E'\n'
        || '              OR (target_account.flatform_type IN (''facebook'', ''email'') AND COALESCE(target_account.is_active, true) = true)' || E'\n'
        || '              OR (' || E'\n'
        || '                target_account.flatform_type = ''zalo''' || E'\n',
        2, 'update_reassign_scope');
      d := pg_temp.v530_replace(d,
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        '        account.flatform_type = ''sms''' || E'\n'
        || '        OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '        OR (' || E'\n'
        || '          account.flatform_type = ''zalo''' || E'\n',
        1, 'update_patch_account_scope');
      d := pg_temp.v530_replace(d,
        '  IF v_campaign.status = ''đang chạy'' THEN' || E'\n'
        || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'');' || E'\n'
        || '  END IF;' || E'\n',
        '  IF v_campaign.status = ''đang chạy'' THEN' || E'\n'
        || '    RETURN jsonb_build_object(''updated'', false, ''reason'', ''campaign_running'');' || E'\n'
        || '  END IF;' || E'\n'
        || c_busy_guard,
        2, 'update_desktop_busy_guard');
      d := pg_temp.v530_replace(d,
        '    IF NOT FOUND THEN' || E'\n'
        || '      RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n',
        '    IF NOT FOUND THEN' || E'\n'
        || '      RAISE EXCEPTION ''control_action_not_allowed'';' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n'
        || E'\n'
        || '  -- V530: tài khoản phụ chỉ Facebook ở loại cho phép. Khoá patch ''secondary_account_id'': có = ghi, null = xoá.' || E'\n'
        || '  IF p_campaign_patch ? ''secondaryAccountId'' THEN' || E'\n'
        || '    RAISE EXCEPTION ''invalid_control_campaign_update_payload'';' || E'\n'
        || '  END IF;' || E'\n'
        || '  v_secondary_account_id := CASE WHEN p_campaign_patch ? ''secondary_account_id''' || E'\n'
        || '    THEN NULLIF(p_campaign_patch->>''secondary_account_id'', '''')::bigint ELSE v_campaign.secondary_account_id END;' || E'\n'
        || '  IF v_secondary_account_id IS NOT NULL AND (p_campaign_patch ? ''secondary_account_id''' || E'\n'
        || '    OR (v_account_platform IN (''facebook'', ''email'') AND (p_campaign_patch ? ''account_id'' OR p_campaign_patch ? ''action_id''))) THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_secondary_account(' || E'\n'
        || '      p_staff_id, p_organization_id, v_account_platform, v_target_action_id,' || E'\n'
        || '      CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE v_campaign.account_id END,' || E'\n'
        || '      v_secondary_account_id);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'update_secondary_account');
      d := pg_temp.v530_replace(d,
        '    IF v_current_input_count <> p_expected_input_count THEN' || E'\n'
        || '      RETURN jsonb_build_object(''updated'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n',
        '    IF v_current_input_count <> p_expected_input_count THEN' || E'\n'
        || '      RETURN jsonb_build_object(''updated'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '    END IF;' || E'\n'
        || '  END IF;' || E'\n'
        || '  IF p_append_inputs IS NOT NULL AND v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_append_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'update_append_inputs');
      d := pg_temp.v530_replace(d,
        '    account_id = CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE campaign.account_id END,' || E'\n',
        '    account_id = CASE WHEN p_campaign_patch ? ''account_id'' THEN NULLIF(p_campaign_patch->>''account_id'', '''')::bigint ELSE campaign.account_id END,' || E'\n'
        || '    secondary_account_id = CASE WHEN p_campaign_patch ? ''secondary_account_id'' THEN v_secondary_account_id ELSE campaign.secondary_account_id END,' || E'\n',
        1, 'update_set_secondary');
      d := pg_temp.v530_replace(d,
        '    extra_settings = CASE WHEN p_campaign_patch ? ''extra_settings'' THEN p_campaign_patch->''extra_settings'' ELSE campaign.extra_settings END,' || E'\n',
        '    extra_settings = CASE WHEN p_campaign_patch ? ''extra_settings'' THEN' || E'\n'
        || '      CASE WHEN jsonb_typeof(p_campaign_patch->''extra_settings'') = ''object'' THEN' || E'\n'
        || '        ((p_campaign_patch->''extra_settings'') - v_runtime_owned_keys)' || E'\n'
        || '        || COALESCE((' || E'\n'
        || '          SELECT jsonb_object_agg(owned.key, owned.value)' || E'\n'
        || '          FROM jsonb_each(CASE WHEN jsonb_typeof(campaign.extra_settings) = ''object''' || E'\n'
        || '            THEN campaign.extra_settings ELSE ''{}''::jsonb END) AS owned' || E'\n'
        || '          WHERE owned.key = ANY(v_runtime_owned_keys)' || E'\n'
        || '        ), ''{}''::jsonb)' || E'\n'
        || '      ELSE p_campaign_patch->''extra_settings'' END' || E'\n'
        || '    ELSE campaign.extra_settings END,' || E'\n',
        1, 'update_runtime_owned_keys');
      -- Chiến dịch chạy trên Desktop chỉ đổi trạng thái qua aka_agent_control_set_desktop_campaign_status.
      d := pg_temp.v530_replace(d,
        '      WHEN v_account_platform = ''zalo'' THEN campaign.status' || E'\n',
        '      WHEN v_account_platform IN (''zalo'', ''facebook'', ''email'') THEN campaign.status' || E'\n',
        1, 'update_status');

    ELSIF r.signature LIKE 'public.add_control_campaign_input_rows(%' THEN
      d := pg_temp.v530_replace(d,
        '  v_inserted integer := 0;' || E'\n',
        '  v_inserted integer := 0;' || E'\n' || '  v_account_platform text;' || E'\n',
        1, 'append_declare');
      d := pg_temp.v530_replace(d,
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        '      account.flatform_type = ''sms''' || E'\n'
        || '      OR (account.flatform_type IN (''facebook'', ''email'') AND COALESCE(account.is_active, true) = true)' || E'\n'
        || '      OR (' || E'\n'
        || '        account.flatform_type = ''zalo''' || E'\n',
        2, 'append_scope');
      d := pg_temp.v530_replace(d,
        '  SELECT campaign.status' || E'\n' || '  INTO v_campaign_status' || E'\n',
        '  SELECT campaign.status, account.flatform_type' || E'\n' || '  INTO v_campaign_status, v_account_platform' || E'\n',
        1, 'append_platform');
      d := pg_temp.v530_replace(d,
        '  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN' || E'\n'
        || '    RETURN jsonb_build_object(''inserted'', 0, ''created'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '  END IF;' || E'\n',
        '  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN' || E'\n'
        || '    RETURN jsonb_build_object(''inserted'', 0, ''created'', false, ''reason'', ''input_count_conflict'');' || E'\n'
        || '  END IF;' || E'\n'
        || '  -- V530: dòng data Facebook phải có uid, Email phải có email hợp lệ.' || E'\n'
        || '  IF v_account_platform IN (''facebook'', ''email'') THEN' || E'\n'
        || '    PERFORM private.aka_agent_control_assert_campaign_inputs(v_account_platform, p_inputs);' || E'\n'
        || '  END IF;' || E'\n',
        1, 'append_inputs');
    END IF;

    IF md5(d) IS DISTINCT FROM r.target THEN
      mismatches := mismatches || (r.signature || '=' || md5(d));
    END IF;
    patched := patched || jsonb_build_object(r.signature, d);
    pending := pending + 1;
  END LOOP;
  IF cardinality(mismatches) > 0 THEN
    RAISE EXCEPTION 'v530_target_checksum_mismatch:%', array_to_string(mismatches, ' ');
  END IF;
  -- v530:apply-begin (scripts/build-v530-sql.py thay đoạn tới apply-end trong script so sánh chỉ đọc)
  IF pending = 0 THEN
    RAISE NOTICE 'v530 đã được apply trước đó; không đổi gì.';
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
      RAISE EXCEPTION 'v530_attributes_changed:%', r.signature;
    END IF;
  END LOOP;

  -- Postflight: mọi hàm vá ở bản đích; hàm mới đúng bản v530 và đúng quyền.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.signature))) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v530_postflight_failed:%', r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_to_recordset($new_functions$[
    {"signature":"private.aka_agent_web_email_campaigns_policy(bigint)","target":"2d131332e8d0fa54b4669f51a8fe92d8","acl":"{postgres=X/postgres}"},
    {"signature":"public.aka_agent_control_web_email_campaigns_policy(bigint)","target":"70616ad6489372725cca33b09da41852","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"private.aka_agent_control_assert_campaign_inputs(text,jsonb)","target":"80972291d75cec5383aab3a28838b7b6","acl":"{postgres=X/postgres}"},
    {"signature":"private.aka_agent_control_assert_secondary_account(bigint,bigint,text,text,bigint,bigint)","target":"fa594cff527fcf2f553c9f376d67dc41","acl":"{postgres=X/postgres}"},
    {"signature":"private.aka_agent_control_normalize_email_session(jsonb,text)","target":"7068bce7f45562f1f4ebcb2fb902a89b","acl":"{postgres=X/postgres}"},
    {"signature":"private.aka_agent_control_email_account_view(public.auto_accounts)","target":"c6c2b3218cf5946c7d4fa3cc23d0f429","acl":"{postgres=X/postgres}"},
    {"signature":"public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)","target":"496a0182daaa9c944119a9744fcf41eb","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)","target":"6f0f9fefac37de258d34c55deebd2cfd","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.delete_control_email_account_atomic(bigint,bigint,bigint)","target":"b912bdab82a4669569b184e46f166da0","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.aka_agent_control_email_account_session(bigint,bigint,bigint)","target":"2ee2b490a2f9224a9d8ac63a1683040f","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)","target":"84182eb3960fd1952037e80e183036fa","acl":"{postgres=X/postgres,service_role=X/postgres}"},
    {"signature":"public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])","target":"2e3bf66477ad78cf90eba64e1626e8d2","acl":"{postgres=X/postgres,aka_agent_desktop=X/postgres}"}
  ]$new_functions$::jsonb) AS x(signature text, target text, acl text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL OR md5(pg_get_functiondef(f)) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v530_new_function_postflight:%:%', r.signature, CASE WHEN f IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(f)) END;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proacl::text = r.acl) THEN
      RAISE EXCEPTION 'v530_unexpected_new_function_acl:%:%', r.signature, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = f);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.email_campaigns') THEN
    RAISE EXCEPTION 'v530_email_policy_missing';
  END IF;
  -- v530:apply-end
END
$migration$;

-- Không reload schema thủ công: giữ cơ chế event trigger DDL hiện có.
COMMIT;
$v530_statements$]
);
INSERT INTO v530_cmp (check_name, ok, detail)
SELECT 'applied', true, version || ' / ' || name
FROM supabase_migrations.schema_migrations WHERE name = 'migration_v530_web_facebook_email_authoring';
COMMIT;
SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v530_cmp ORDER BY seq;
