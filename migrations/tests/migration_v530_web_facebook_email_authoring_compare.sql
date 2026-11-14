-- v530 SO SÁNH TRƯỚC KHI APPLY — CHỈ ĐỌC. File sinh tự động bởi scripts/build-v530-sql.py
-- từ migrations/migration_v530_web_facebook_email_authoring.sql; đừng sửa tay.
-- Không tạo/sửa đối tượng public/private (bản sao nằm trong pg_temp; event trigger PostgREST bỏ qua pg_temp)
-- và không ghi dữ liệu nghiệp vụ. Không gọi hàm có ghi (tạo/sửa/thêm data/xoá/dừng/tiếp tục/xác thực).
-- Chạy trong MỘT phiên. Kết quả: patch_dry_run (11 hàm vá khớp md5 đích), *_same (caller cũ nhận đúng kết
-- quả cũ, kèm thời gian cũ/mới), *_email (đường Email mới, chỉ đo), facebook_policy_same.
SET statement_timeout = '110s';
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
    {"signature":"private.aka_agent_web_email_campaigns_policy(bigint)","target":"31e5589203597806b03c077e87008f20"},
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
     "source":"592f487518ef14f3bef6f0c7177f2ab5","target":"09917b7c45a14abe4f0d4a1af625631f"},
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
      v_authoring_enabled := jsonb_typeof(v_action_ids) = 'array'
        AND jsonb_array_length(v_action_ids) > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_action_ids) AS item(value)
          WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string' OR btrim(item.value #>> '{}') = ''
        );
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

SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v530_cmp ORDER BY seq;
