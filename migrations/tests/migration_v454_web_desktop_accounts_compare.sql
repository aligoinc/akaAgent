-- v454 SO SÁNH TRƯỚC KHI APPLY — CHỈ ĐỌC. File sinh tự động bởi scripts/build-v454-compare-sql.py
-- từ migrations/migration_v454_web_desktop_accounts.sql; đừng sửa tay.
-- Không tạo/sửa đối tượng public (mọi bản sao nằm trong pg_temp, event trigger PostgREST bỏ qua pg_temp)
-- và không ghi dữ liệu nghiệp vụ. Chạy trong MỘT phiên, ví dụ một lệnh execute_sql.
-- Kết quả: patch_dry_run (10 hàm vá khớp md5 đích), *_legacy_same (caller cũ nhận đúng kết quả cũ,
-- kèm thời gian cũ/mới), *_desktop (đường Desktop mới chỉ đo thời gian).
SET statement_timeout = '110s';
CREATE TEMP TABLE IF NOT EXISTS v454_cmp (
  seq bigserial, check_name text, staff_id bigint, organization_id bigint,
  ok boolean, old_ms numeric, new_ms numeric, detail text
);
TRUNCATE v454_cmp;

CREATE OR REPLACE FUNCTION pg_temp.v454_replace(
  p_definition text, p_old text, p_new text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  v_count := (length(p_definition) - length(replace(p_definition, p_old, ''))) / greatest(length(p_old), 1);
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v454_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN replace(p_definition, p_old, p_new);
END
$helper$;

CREATE OR REPLACE FUNCTION pg_temp.v454_regexp(
  p_definition text, p_pattern text, p_replacement text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM regexp_matches(p_definition, p_pattern, 'g');
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v454_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN regexp_replace(p_definition, p_pattern, p_replacement, 'g');
END
$helper$;


CREATE OR REPLACE FUNCTION pg_temp.aka_agent_control_desktop_activity_v454(
  p_staff_id bigint,
  p_organization_id bigint,
  p_platforms text[],
  p_after_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_limit integer := least(greatest(COALESCE(p_limit, 100), 1), 200);
  v_items jsonb;
  v_cursor bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_platforms IS NULL OR (p_after_id IS NOT NULL AND p_after_id < 0) THEN
    RAISE EXCEPTION 'Invalid desktop activity scope';
  END IF;
  IF NOT (p_platforms && ARRAY['zalo_qr', 'zalo_web']::text[]) THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'cursor', p_after_id);
  END IF;

  WITH scoped AS MATERIALIZED (
    SELECT c.id, c.name, c.account_id, a.name AS account_name, a.is_zalo_show_web IS TRUE AS is_browser
    FROM public.auto_campaigns AS c
    JOIN public.auto_accounts AS a ON a.id = c.account_id AND a.staff_id = c.staff_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND a.organization_id = p_organization_id
      AND a.flatform_type = 'zalo' AND a.is_zalo_server IS NOT TRUE
      AND (('zalo_qr' = ANY(p_platforms) AND a.is_zalo_show_web IS NOT TRUE)
        OR ('zalo_web' = ANY(p_platforms) AND a.is_zalo_show_web IS TRUE))
      AND (c.status = 'đang chạy' OR c.last_run_at > now() - interval '30 minutes'
        OR c.updated_at > now() - interval '30 minutes')
    ORDER BY (c.status = 'đang chạy') DESC, c.last_run_at DESC NULLS LAST, c.id DESC
    LIMIT 50
  ), picked AS MATERIALIZED (
    SELECT row.id, row.campaign_id, row.log, row.created_at
    FROM scoped AS s
    CROSS JOIN LATERAL (
      SELECT l.id, l.campaign_id, l.log, l.created_at
      FROM public.auto_campaign_logs AS l
      WHERE l.campaign_id = s.id
        AND (p_after_id IS NULL OR l.id > p_after_id OR l.created_at >= now() - interval '10 seconds')
      ORDER BY l.id DESC
      LIMIT v_limit
    ) AS row
    ORDER BY row.id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id::text, 'campaignId', p.campaign_id, 'campaignName', s.name,
      'accountId', s.account_id, 'accountName', s.account_name,
      'accountType', CASE WHEN s.is_browser THEN 'zalo_browser' ELSE 'zalo_qr' END,
      'log', p.log, 'createdAt', p.created_at
    ) ORDER BY p.id), '[]'::jsonb),
    max(p.id)
  INTO v_items, v_cursor
  FROM picked AS p JOIN scoped AS s ON s.id = p.campaign_id;

  RETURN jsonb_build_object('items', v_items, 'cursor', COALESCE(greatest(v_cursor, p_after_id), p_after_id));
END
$function$;

DO $migration$
DECLARE
  -- Nhánh Zalo của token phạm vi. 'zalo' = Server (như cũ), 'zalo_qr' = Desktop mã QR,
  -- 'zalo_web' = Desktop trình duyệt. Caller cũ không gửi token mới nên kết quả giữ nguyên.
  c_zalo_scope_eq constant text :=
    '(''zalo'' = ANY(p_platforms) AND a.is_zalo_show_web = false AND a.is_zalo_server = true)'
    || ' OR (''zalo_qr'' = ANY(p_platforms) AND a.is_zalo_show_web IS NOT TRUE AND a.is_zalo_server IS NOT TRUE)'
    || ' OR (''zalo_web'' = ANY(p_platforms) AND a.is_zalo_show_web IS TRUE AND a.is_zalo_server IS NOT TRUE)';
  c_zalo_scope_is constant text :=
    '(''zalo''=ANY(p_platforms) AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE)'
    || ' OR (''zalo_qr''=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS NOT TRUE)'
    || ' OR (''zalo_web''=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS TRUE)';
  c_any_desktop constant text := 'p_platforms && ARRAY[''zalo_qr'',''zalo_web'']::text[]';
  c_runtime_valid constant text :=
    'NOT p_ended AND jsonb_typeof(p_device->''runtime'') = ''object'' AND octet_length((p_device->''runtime'')::text) <= 32768';
  specs constant jsonb := $specs$[
    {"signature":"public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)",
     "source":"761108afe53ff4046efe0cd247846d10","target":"6b148777006903e4830925c55616820b"},
    {"signature":"public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])",
     "source":"12d454fbc38217dea3497addd39ed832","target":"a2bc3f7cae264e647ac576c9895e840f"},
    {"signature":"public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)",
     "source":"1275ad05d4dd184f5f6d9cd937caa21c","target":"26875e2b1652ca56cc8e59460df8cae1"},
    {"signature":"public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)",
     "source":"c1673974d0982ce6a731741072ca5338","target":"61a6b5c855fbcf86cafaf3c3c7ce6f0a"},
    {"signature":"public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)",
     "source":"f285e48f4deaf2e1bf7896d7aeddbcf8","target":"a86278195e18d1ef8d0091b41d1d0c5b"},
    {"signature":"public.delete_control_campaign_atomic(bigint,bigint,bigint)",
     "source":"1955af1c590ec870cb098cde9dd0714b","target":"4cfcad941c3acf22e674a77b203d086d"},
    {"signature":"public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)",
     "source":"0f22d3c6fe532176af0e3f38fd485f88","target":"d283261c5e77558d10f5df86cd4d1127"},
    {"signature":"public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)",
     "source":"a98a23f8e7f2e1e6582449f7ed45fb45","target":"d61093635f226751c4a311840c6b3e29"},
    {"signature":"public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)",
     "source":"b504f4928a9dd271dec783796a7a0374","target":"478aa4281c683686437f31947bb760b1"},
    {"signature":"public.aka_agent_authenticate_control_session(text)",
     "source":"c748df75349ebeef58c3c8f120439b0b","target":"de8f93ee545bca94a199b2dffb9fe324"}
  ]$specs$::jsonb;
  r record;
  f oid;
  checksum text;
  d text;
  attrs jsonb;
BEGIN
  -- Preflight toàn bộ trước khi sửa hàm đầu tiên; giữ owner/security/config/ACL.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL THEN RAISE EXCEPTION 'v454_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source, r.target) THEN
      RAISE EXCEPTION 'v454_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION 'v454_unexpected_owner:%', r.signature;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    d := pg_get_functiondef(f);
    IF md5(d) = r.target THEN
      INSERT INTO v454_cmp(check_name, ok, detail) VALUES ('already_applied', false, r.signature);
      CONTINUE;
    END IF;
    SELECT jsonb_build_object('secdef', p.prosecdef, 'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text)
    INTO attrs FROM pg_proc p WHERE p.oid = f;

    IF r.signature LIKE 'public.aka_agent_control_account_snapshot(%' THEN
      d := pg_temp.v454_replace(d, '  v_chat boolean;' || E'\n',
        '  v_chat boolean;' || E'\n' || '  v_presence jsonb;' || E'\n', 1, 'snapshot_declare');
      d := pg_temp.v454_replace(d, 'AND a.flatform_type=ANY(p_platforms)',
        'AND (a.flatform_type=ANY(p_platforms) OR (a.flatform_type=''zalo'' AND ' || c_any_desktop || '))', 3, 'snapshot_platform');
      d := pg_temp.v454_replace(d,
        '(a.flatform_type=''sms'' OR (a.flatform_type=''zalo'' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))',
        '(a.flatform_type=''sms'' OR (a.flatform_type=''zalo'' AND (' || c_zalo_scope_is || ')))', 3, 'snapshot_scope');
      -- Desktop không lưu phiên trình duyệt trong DB: suy ra từ trạng thái đăng nhập.
      d := pg_temp.v454_replace(d,
        '''has_zalo_session'',CASE WHEN a.flatform_type=''zalo'' AND v_chat THEN',
        '''has_zalo_session'',CASE WHEN a.flatform_type=''zalo'' AND (v_chat OR a.is_zalo_server IS NOT TRUE) THEN', 1, 'snapshot_session');
      d := pg_temp.v454_replace(d,
        '  RETURN jsonb_build_object(''items'',v_items,''runningCampaigns'',v_running,''catalogVersion'',v_catalog_version,',
        '  IF p_view IN (''accounts'',''campaigns'') AND ' || c_any_desktop || ' THEN' || E'\n'
        || '    SELECT jsonb_build_object(' || E'\n'
        || '      ''online'', presence.ended_at IS NULL AND presence.last_seen_at > now() - interval ''120 seconds'',' || E'\n'
        || '      ''startedAt'', presence.started_at, ''lastSeenAt'', presence.last_seen_at, ''endedAt'', presence.ended_at,' || E'\n'
        || '      ''appVersion'', presence.app_version, ''deviceLabel'', presence.device_label,' || E'\n'
        || '      ''devicePlatform'', presence.device_platform, ''runtime'', presence.runtime_state,' || E'\n'
        || '      ''runtimeAt'', presence.runtime_state_at, ''checkedAt'', now())' || E'\n'
        || '    INTO v_presence' || E'\n'
        || '    FROM auto_staff_device_presence presence' || E'\n'
        || '    WHERE presence.staff_id=p_staff_id AND presence.organization_id=p_organization_id' || E'\n'
        || '    ORDER BY presence.last_seen_at DESC NULLS LAST, presence.started_at DESC' || E'\n'
        || '    LIMIT 1;' || E'\n'
        || '    v_presence := coalesce(v_presence, jsonb_build_object(''online'', false, ''checkedAt'', now()));' || E'\n'
        || '  END IF;' || E'\n'
        || '  RETURN jsonb_build_object(''items'',v_items,''runningCampaigns'',v_running,''desktopPresence'',v_presence,''catalogVersion'',v_catalog_version,',
        1, 'snapshot_presence');

    ELSIF r.signature LIKE 'public.aka_agent_control_campaign_page(%' THEN
      d := pg_temp.v454_replace(d,
        '      AND a.flatform_type = ANY(p_platforms)' || E'\n'
        || '      AND (a.flatform_type = ''sms'' OR (a.flatform_type = ''zalo'' AND a.is_zalo_show_web = false AND a.is_zalo_server = true))',
        '      AND (a.flatform_type = ANY(p_platforms) OR (a.flatform_type = ''zalo'' AND ' || c_any_desktop || '))' || E'\n'
        || '      AND (a.flatform_type = ''sms'' OR (a.flatform_type = ''zalo'' AND (' || c_zalo_scope_eq || ')))',
        1, 'page_scope');
      d := pg_temp.v454_replace(d,
        '    SELECT c.id, c.status, c.name, c.account_id, c.action_id, a.flatform_type,' || E'\n',
        '    SELECT c.id, c.status, c.name, c.account_id, c.action_id, a.flatform_type,' || E'\n'
        || '      CASE WHEN a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE THEN ''desktop'' ELSE ''web'' END AS runtime_target,' || E'\n',
        1, 'page_runtime_target');
      d := pg_temp.v454_replace(d,
        '      AND (NOT p_filters ? ''platforms'' OR p_filters->''platforms'' ? s.flatform_type)' || E'\n',
        '      AND (NOT p_filters ? ''platforms'' OR p_filters->''platforms'' ? s.flatform_type)' || E'\n'
        || '      AND (NOT p_filters ? ''runtimeTargets'' OR p_filters->''runtimeTargets'' ? s.runtime_target)' || E'\n',
        1, 'page_runtime_filter');
      d := pg_temp.v454_replace(d,
        '(a.flatform_type = ''zalo'' AND a.is_zalo_show_web = false AND a.is_zalo_server = true) AS "isZaloServer",',
        '(a.flatform_type = ''zalo'' AND a.is_zalo_show_web = false AND a.is_zalo_server = true) AS "isZaloServer",'
        || ' (a.flatform_type = ''zalo'' AND a.is_zalo_show_web IS TRUE) AS "isZaloShowWeb",'
        || ' (c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL) AS "runtimeBusy",',
        1, 'page_summary');

    ELSIF r.signature LIKE 'public.aka_agent_control_campaign_logs(%' THEN
      d := pg_temp.v454_replace(d,
        '   AND a.flatform_type=ANY(p_platforms)' || E'\n'
        || '   AND (a.flatform_type<>''zalo'' OR (a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))',
        '   AND (a.flatform_type=ANY(p_platforms) OR (a.flatform_type=''zalo'' AND ' || c_any_desktop || '))' || E'\n'
        || '   AND (a.flatform_type<>''zalo'' OR ' || c_zalo_scope_is || ')',
        1, 'logs_scope');

    ELSIF r.signature LIKE 'public.create_control_campaign(%'
       OR r.signature LIKE 'public.delete_control_campaign_atomic(%'
       OR r.signature LIKE 'public.add_control_campaign_input_rows(%'
       OR r.signature LIKE 'public.update_control_campaign_atomic(%' THEN
      -- Server cũ: show_web=false AND server=true. Mới: mọi tài khoản Zalo hợp lệ
      -- (Server, Desktop QR, Desktop trình duyệt); chỉ loại tổ hợp lỗi cả hai cờ true.
      d := pg_temp.v454_regexp(d,
        'AND COALESCE\((account|target_account)\.is_zalo_show_web, false\) = false(\s+)AND COALESCE\(\1\.is_zalo_server, false\) = true',
        'AND NOT (COALESCE(\1.is_zalo_show_web, false)\2AND COALESCE(\1.is_zalo_server, false))',
        CASE WHEN r.signature LIKE 'public.update_control_campaign_atomic(%' THEN 5 ELSE 2 END,
        'mutation_scope:' || r.signature);
      IF r.signature LIKE 'public.update_control_campaign_atomic(%' THEN
        -- Gán lại tài khoản (kể cả sửa chiến dịch mồ côi) phải giữ nguyên nơi chạy.
        d := pg_temp.v454_replace(d,
          'AND target_account.flatform_type = account.flatform_type',
          'AND target_account.flatform_type = account.flatform_type'
          || ' AND COALESCE(target_account.is_zalo_server, false) = COALESCE(account.is_zalo_server, false)',
          2, 'update_target_runtime');
        d := pg_temp.v454_replace(d,
          'AND account.flatform_type = v_account_platform',
          'AND account.flatform_type = v_account_platform'
          || ' AND COALESCE(account.is_zalo_server, false) = (SELECT COALESCE(source_account.is_zalo_server, false)'
          || ' FROM public.auto_accounts AS source_account WHERE source_account.id = v_campaign.account_id)',
          1, 'update_patch_runtime');
      ELSIF r.signature LIKE 'public.delete_control_campaign_atomic(%' THEN
        d := pg_temp.v454_replace(d,
          '  IF v_campaign_status = ''đang chạy'' THEN' || E'\n'
          || '    RETURN jsonb_build_object(''deleted'', false, ''reason'', ''campaign_running'');' || E'\n'
          || '  END IF;' || E'\n',
          '  IF v_campaign_status = ''đang chạy'' THEN' || E'\n'
          || '    RETURN jsonb_build_object(''deleted'', false, ''reason'', ''campaign_running'');' || E'\n'
          || '  END IF;' || E'\n'
          || '  -- Desktop còn giữ claim/unit lease: xóa sẽ để lại lease mồ côi khóa cổng bảo trì.' || E'\n'
          || '  IF EXISTS (' || E'\n'
          || '    SELECT 1 FROM public.auto_campaigns AS campaign' || E'\n'
          || '    JOIN public.auto_accounts AS account ON account.id = campaign.account_id' || E'\n'
          || '    WHERE campaign.id = p_campaign_id' || E'\n'
          || '      AND account.flatform_type = ''zalo''' || E'\n'
          || '      AND COALESCE(account.is_zalo_server, false) = false' || E'\n'
          || '      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)' || E'\n'
          || '  ) THEN' || E'\n'
          || '    RETURN jsonb_build_object(''deleted'', false, ''reason'', ''campaign_running'');' || E'\n'
          || '  END IF;' || E'\n',
          1, 'delete_desktop_lease');
      END IF;

    ELSIF r.signature LIKE 'public.update_control_campaign_input_statuses_atomic(%' THEN
      d := pg_temp.v454_replace(d,
        'AND (v_is_zalo_show_web OR NOT v_is_zalo_server)',
        'AND v_is_zalo_show_web AND v_is_zalo_server',
        2, 'input_status_scope');

    ELSIF r.signature LIKE 'public.aka_agent_device_presence(%' THEN
      d := pg_temp.v454_replace(d,
        '(instance_id,staff_id,organization_id,device_fingerprint_hash,device_label,device_platform,app_version,started_at,last_seen_at,ended_at)',
        '(instance_id,staff_id,organization_id,device_fingerprint_hash,device_label,device_platform,app_version,started_at,last_seen_at,ended_at,runtime_state,runtime_state_at)',
        1, 'presence_columns');
      d := pg_temp.v454_replace(d,
        'stamp,stamp,CASE WHEN p_ended THEN stamp END)',
        'stamp,stamp,CASE WHEN p_ended THEN stamp END,' || E'\n'
        || '    CASE WHEN ' || c_runtime_valid || ' THEN p_device->''runtime'' END,' || E'\n'
        || '    CASE WHEN ' || c_runtime_valid || ' THEN stamp END)',
        1, 'presence_values');
      d := pg_temp.v454_replace(d,
        '    ended_at = CASE WHEN p_ended THEN stamp ELSE NULL END' || E'\n',
        '    ended_at = CASE WHEN p_ended THEN stamp ELSE NULL END,' || E'\n'
        || '    runtime_state = CASE WHEN ' || c_runtime_valid || ' THEN p_device->''runtime'' ELSE presence.runtime_state END,' || E'\n'
        || '    runtime_state_at = CASE WHEN ' || c_runtime_valid || ' THEN stamp ELSE presence.runtime_state_at END' || E'\n',
        1, 'presence_update');

    ELSIF r.signature LIKE 'public.aka_agent_authenticate_control_session(%' THEN
      d := pg_temp.v454_replace(d,
        '  v_sms_enabled boolean := false;' || E'\n',
        '  v_sms_enabled boolean := false;' || E'\n' || '  v_web_desktop_policy jsonb := ''{}''::jsonb;' || E'\n',
        1, 'session_declare');
      d := pg_temp.v454_replace(d,
        '  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled THEN' || E'\n',
        '  v_web_desktop_policy := private.aka_agent_web_desktop_accounts_policy(v_staff.organization_id);' || E'\n'
        || '  -- Tổ chức chỉ có gói Zalo Desktop vào Web/PWA khi chính sách bật rõ desktopOnlyLogin.' || E'\n'
        || '  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled AND NOT (' || E'\n'
        || '    v_zalo_qr_enabled' || E'\n'
        || '    AND v_session.client_type IN (''web'', ''pwa'')' || E'\n'
        || '    AND COALESCE((v_web_desktop_policy->>''desktopOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        1, 'session_gate');
      d := pg_temp.v454_replace(d,
        '    ''sms_package'', CASE WHEN v_sms_package.id IS NULL',
        '    ''web_desktop_accounts'', v_web_desktop_policy,' || E'\n'
        || '    ''sms_package'', CASE WHEN v_sms_package.id IS NULL',
        1, 'session_output');
    END IF;

    IF md5(d) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v454_target_checksum_mismatch:%:%', r.signature, md5(d);
    END IF;
    -- So sánh: không EXECUTE lên public. Chỉ ghi nhận bản vá khớp md5 đích và tạo bản sao
    -- pg_temp cho 3 hàm đọc (cột runtime_state chưa có trên production nên thay bằng NULL).
    INSERT INTO v454_cmp(check_name, ok, detail) VALUES ('patch_dry_run', true, r.signature);
    IF r.signature LIKE 'public.aka_agent_control_account_snapshot(%'
       OR r.signature LIKE 'public.aka_agent_control_campaign_page(%'
       OR r.signature LIKE 'public.aka_agent_control_campaign_logs(%' THEN
      d := regexp_replace(d, 'FUNCTION public\.([a-z_]+)\(', 'FUNCTION pg_temp.\1_v454(');
      d := replace(replace(d, 'presence.runtime_state_at', 'NULL::timestamptz'), 'presence.runtime_state', 'NULL::jsonb');
      EXECUTE d;
    END IF;
  END LOOP;

END
$migration$;

CREATE OR REPLACE FUNCTION pg_temp.v454_strip_page(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $strip$
  -- Bản vá chỉ thêm hai trường vào mỗi dòng chiến dịch; bỏ chúng để so với bản đang chạy.
  SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN p ELSE
    (CASE WHEN jsonb_typeof(p->'selected') = 'object'
      THEN jsonb_set(p, '{selected}', (p->'selected') - 'isZaloShowWeb' - 'runtimeBusy') ELSE p END)
    || CASE WHEN jsonb_typeof(p->'items') = 'array' THEN jsonb_build_object('items', COALESCE((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' THEN e - 'isZaloShowWeb' - 'runtimeBusy' ELSE e END ORDER BY o)
      FROM jsonb_array_elements(p->'items') WITH ORDINALITY AS x(e, o)), '[]'::jsonb)) ELSE '{}'::jsonb END
  END
$strip$;

CREATE OR REPLACE FUNCTION pg_temp.v454_strip_snapshot(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $strip$
  -- Caller cũ nhận thêm khoá desktopPresence = null; bỏ để so.
  SELECT CASE WHEN p ? 'desktopPresence' AND p->'desktopPresence' = 'null'::jsonb THEN p - 'desktopPresence' ELSE p END
$strip$;

DO $compare$
DECLARE
  s record;
  t0 timestamptz;
  v_old jsonb;
  v_new jsonb;
  old_ms numeric;
  new_ms numeric;
  v_campaign bigint;
  v_legacy text[] := ARRAY['zalo', 'sms'];
  v_desktop text[] := ARRAY['zalo', 'sms', 'zalo_qr', 'zalo_web'];
  v_filters jsonb := jsonb_build_object('applyDisplaySettings', true,
    'dateFrom', to_char(timezone('Asia/Ho_Chi_Minh', now()) - interval '7 days', 'YYYY-MM-DD'),
    'dateTo', to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYY-MM-DD'));
  i integer;
BEGIN
  -- 1. Caller cũ (Web/API/app mobile đang chạy): nhân viên có nhiều chiến dịch Zalo Server/SMS nhất.
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false
      AND (a.flatform_type = 'sms' OR (a.flatform_type = 'zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    old_ms := NULL; new_ms := NULL;
    FOR i IN 1..2 LOOP
      t0 := clock_timestamp();
      v_old := public.aka_agent_control_campaign_page(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
      old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_campaign_page_v454(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
      new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
    END LOOP;
    INSERT INTO v454_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
    VALUES ('page_legacy_same', s.staff_id, s.organization_id, pg_temp.v454_strip_page(v_new) = v_old,
      round(old_ms, 1), round(new_ms, 1), 'campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

    old_ms := NULL; new_ms := NULL;
    FOR i IN 1..2 LOOP
      t0 := clock_timestamp();
      v_old := public.aka_agent_control_account_snapshot(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_view => 'accounts', p_account_ids => NULL, p_versions => '{}'::jsonb, p_catalog_version => NULL);
      old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_account_snapshot_v454(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_view => 'accounts', p_account_ids => NULL, p_versions => '{}'::jsonb, p_catalog_version => NULL);
      new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
    END LOOP;
    INSERT INTO v454_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
    VALUES ('snapshot_legacy_same', s.staff_id, s.organization_id, pg_temp.v454_strip_snapshot(v_new) = v_old,
      round(old_ms, 1), round(new_ms, 1), 'accounts=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

    SELECT c.id INTO v_campaign
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.staff_id = s.staff_id AND c.organization_id = s.organization_id AND c.is_delete = false
      AND (a.flatform_type = 'sms' OR (a.flatform_type = 'zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
    ORDER BY c.last_run_at DESC NULLS LAST, c.id DESC LIMIT 1;
    IF v_campaign IS NOT NULL THEN
      t0 := clock_timestamp();
      v_old := public.aka_agent_control_campaign_logs(s.staff_id, s.organization_id, v_campaign, v_legacy, '{}'::jsonb);
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_campaign_logs_v454(s.staff_id, s.organization_id, v_campaign, v_legacy, '{}'::jsonb);
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v454_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('logs_legacy_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        'campaign=' || v_campaign || ' entries=' || COALESCE(jsonb_array_length(v_old->'items'), 0));
    END IF;
  END LOOP;

  -- 2. Đường Desktop mới: nhân viên có nhiều chiến dịch Zalo mã QR/trình duyệt nhất (chỉ đo, chưa ai gọi).
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false AND a.flatform_type = 'zalo' AND a.is_zalo_server IS NOT TRUE
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_campaign_page_v454(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_desktop, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
    INSERT INTO v454_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('page_desktop', s.staff_id, s.organization_id, v_new ? 'items', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_new->'items'), 0) || ' total=' || COALESCE(v_new->>'total', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_account_snapshot_v454(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_desktop, p_view => 'accounts', p_account_ids => NULL, p_versions => '{}'::jsonb, p_catalog_version => NULL);
    INSERT INTO v454_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('snapshot_desktop', s.staff_id, s.organization_id, v_new ? 'desktopPresence', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'accounts=' || COALESCE(jsonb_array_length(v_new->'items'), 0) || ' online=' || COALESCE(v_new->'desktopPresence'->>'online', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_desktop_activity_v454(s.staff_id, s.organization_id, v_desktop, NULL, 100);
    INSERT INTO v454_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('activity_desktop', s.staff_id, s.organization_id, v_new ? 'items', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'items=' || COALESCE(jsonb_array_length(v_new->'items'), 0));
  END LOOP;
END
$compare$;

SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v454_cmp ORDER BY seq;
