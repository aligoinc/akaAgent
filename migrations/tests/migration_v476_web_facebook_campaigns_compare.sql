-- v476 SO SÁNH TRƯỚC KHI APPLY — CHỈ ĐỌC. File sinh tự động bởi scripts/build-v476-sql.py
-- từ migrations/migration_v476_web_facebook_campaigns.sql; đừng sửa tay.
-- Không tạo/sửa đối tượng public/private (bản sao nằm trong pg_temp; event trigger PostgREST bỏ qua pg_temp)
-- và không ghi dữ liệu nghiệp vụ. Không gọi hàm có ghi (xác thực, dừng/tiếp tục, xoá). Chạy trong MỘT phiên.
-- Kết quả: patch_dry_run (6 hàm vá khớp md5 đích), *_same (caller cũ nhận đúng kết quả cũ, kèm thời gian
-- cũ/mới), *_facebook (đường Facebook mới, chỉ đo).
SET statement_timeout = '110s';
CREATE TEMP TABLE IF NOT EXISTS v476_cmp (
  seq bigserial, check_name text, staff_id bigint, organization_id bigint,
  ok boolean, old_ms numeric, new_ms numeric, detail text
);
TRUNCATE v476_cmp;

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
  -- So sánh: không EXECUTE lên public. Ghi nhận bản vá khớp md5 đích, tạo bản sao pg_temp cho 3 hàm đọc.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF NOT patched ? r.signature THEN
      INSERT INTO v476_cmp(check_name, ok, detail) VALUES ('already_applied', false, r.signature);
      CONTINUE;
    END IF;
    INSERT INTO v476_cmp(check_name, ok, detail) VALUES ('patch_dry_run', true, r.signature);
    IF r.signature ~ '^public\.aka_agent_control_(campaign_page|account_snapshot|desktop_activity)\(' THEN
      EXECUTE regexp_replace(patched->>r.signature, 'FUNCTION public\.([a-z_]+)\(', 'FUNCTION pg_temp.\1_v476(');
    END IF;
  END LOOP;
END
$migration$;

CREATE OR REPLACE FUNCTION pg_temp.v476_strip(p jsonb) RETURNS jsonb
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
  v_scopes constant jsonb := '{"legacy":["zalo","sms"],"desktop":["zalo","sms","zalo_qr","zalo_web"]}';
  v_facebook text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook'];
  v_filters jsonb := jsonb_build_object('applyDisplaySettings', true,
    'dateFrom', to_char(timezone('Asia/Ho_Chi_Minh', now()) - interval '7 days', 'YYYY-MM-DD'),
    'dateTo', to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYY-MM-DD'));
BEGIN
  -- 1. Caller cũ (không token 'facebook'): nhân viên có nhiều chiến dịch Facebook nhất (dòng Facebook phải
  --    vẫn bị loại) và nhân viên có nhiều chiến dịch Zalo/SMS nhất. Kết quả cũ/mới phải giống hệt.
  FOR s IN
    (SELECT 'facebook' AS grp, c.staff_id, c.organization_id, count(*) AS n
     FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
     WHERE c.is_delete = false AND a.flatform_type = 'facebook'
     GROUP BY 2, 3 ORDER BY 4 DESC LIMIT 3)
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
        v_new := pg_temp.aka_agent_control_campaign_page_v476(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
          p_platforms => v_scope, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('page_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      old_ms := NULL; new_ms := NULL;
      FOR i IN 1..2 LOOP
        t0 := clock_timestamp();
        v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope);
        old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
        t0 := clock_timestamp();
        v_new := pg_temp.aka_agent_control_account_snapshot_v476(s.staff_id, s.organization_id, v_scope);
        new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      END LOOP;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('snapshot_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v476_strip(v_new) = pg_temp.v476_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' accounts=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_account_snapshot(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_account_snapshot_v476(s.staff_id, s.organization_id, v_scope, 'campaigns', COALESCE(v_ids, '{}'));
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('catalog_' || k || '_same', s.staff_id, s.organization_id, pg_temp.v476_strip(v_new) = pg_temp.v476_strip(v_old),
        round(old_ms, 1), round(new_ms, 1), s.grp || ' catalog=' || COALESCE(jsonb_array_length(v_old->'catalog'), 0));

      t0 := clock_timestamp();
      v_old := public.aka_agent_control_desktop_activity(s.staff_id, s.organization_id, v_scope, NULL, 100);
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_desktop_activity_v476(s.staff_id, s.organization_id, v_scope, NULL, 100);
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('activity_' || k || '_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        s.grp || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));
    END LOOP;
  END LOOP;

  -- 2. Đường Facebook mới (chưa ai gọi, chỉ đo và kiểm có dòng Facebook).
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false AND a.flatform_type = 'facebook'
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_campaign_page_v476(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_facebook, p_filters => '{"platforms":["facebook"]}'::jsonb, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
    INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('page_facebook', s.staff_id, s.organization_id,
      (v_new->>'campaignTotal')::bigint > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'items') x WHERE x->>'platform' <> 'facebook'),
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'campaigns=' || s.n || ' total=' || COALESCE(v_new->>'campaignTotal', '?'));

    SELECT array_agg(a.id ORDER BY a.id) INTO v_ids FROM (
      SELECT a.id FROM auto_accounts a WHERE a.staff_id = s.staff_id AND a.organization_id = s.organization_id
        AND a.is_delete = false ORDER BY a.id LIMIT 100) a;
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_account_snapshot_v476(s.staff_id, s.organization_id, v_facebook, 'campaigns', COALESCE(v_ids, '{}'));
    INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('snapshot_facebook', s.staff_id, s.organization_id,
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'catalog') x WHERE x->>'platform' = 'facebook')
        AND jsonb_typeof(v_new->'desktopPresence') = 'object',
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'catalog=' || COALESCE(jsonb_array_length(v_new->'catalog'), 0) || ' online=' || COALESCE(v_new->'desktopPresence'->>'online', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_desktop_activity_v476(s.staff_id, s.organization_id, v_facebook, NULL, 100);
    INSERT INTO v476_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('activity_facebook', s.staff_id, s.organization_id, v_new ? 'items',
      round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'items=' || COALESCE(jsonb_array_length(v_new->'items'), 0) || ' facebook=' ||
        (SELECT count(*) FROM jsonb_array_elements(v_new->'items') x WHERE x->>'accountType' = 'facebook'));
  END LOOP;
END
$compare$;

SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v476_cmp ORDER BY seq;
