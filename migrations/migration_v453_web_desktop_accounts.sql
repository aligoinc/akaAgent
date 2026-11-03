-- v453: Web/PWA hiển thị và quản lý tài khoản + chiến dịch Desktop
-- (Zalo mã QR, Zalo trình duyệt). App Desktop vẫn là nơi chạy duy nhất; Web chỉ
-- đọc/ghi dữ liệu trong DB bằng service_role qua Control API.
--
-- 1. RPC đọc Control (snapshot tài khoản, trang chiến dịch, lịch sử chạy) nhận thêm
--    token phạm vi 'zalo_qr' / 'zalo_web' trong p_platforms. Caller cũ chỉ gửi
--    'zalo'/'sms' nên kết quả giữ nguyên. Snapshot trả thêm desktopPresence; trang
--    chiến dịch trả isZaloShowWeb/runtimeBusy và lọc runtimeTargets.
-- 2. RPC ghi Control nhận tài khoản Zalo chạy Desktop. Đổi tài khoản phải cùng nơi
--    chạy. Xóa chiến dịch Desktop bị chặn khi Desktop còn giữ claim/unit lease
--    (lease mồ côi khóa cổng bảo trì cả nhân viên sau 00:00).
-- 3. RPC mới aka_agent_control_set_desktop_campaign_status: tạm dừng DB-first như
--    Zalo Server (scheduler Desktop dừng trước mục tiêu kế tiếp), tiếp tục chỉ khi
--    không còn claim/lease. Ghi một dòng lịch sử chạy cho khách.
-- 4. Presence lưu ảnh chụp runtime quan sát do Desktop ≥ 9.3.0 gửi kèm heartbeat sẵn
--    có (không thêm request). Desktop cũ không gửi → giữ NULL.
-- 5. Chính sách bật tính năng: auto_system_settings 'web.desktop_accounts', mặc định
--    tắt. desktopOnlyLogin chỉ mở đăng nhập Web/PWA (không native) cho tổ chức không
--    có Zalo Server/SMS khi được bật rõ.
--
-- Canonical ở repo akaAgent; repo WebApp không sao chép. Định nghĩa nguồn được kiểm
-- bằng md5 trước khi vá; lệch bản live thì dừng. Có DDL nên PostgREST nạp lại schema:
-- chỉ áp ngoài giờ cao điểm. Rollback: migrations/snapshots/web-desktop-accounts-v453/rollback.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Ảnh chụp runtime Desktop trong presence (quan sát, có giới hạn kích thước).
ALTER TABLE public.auto_staff_device_presence
  ADD COLUMN IF NOT EXISTS runtime_state jsonb,
  ADD COLUMN IF NOT EXISTS runtime_state_at timestamptz;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auto_staff_device_presence_runtime_state_check'
      AND conrelid = 'public.auto_staff_device_presence'::regclass
  ) THEN
    ALTER TABLE public.auto_staff_device_presence
      ADD CONSTRAINT auto_staff_device_presence_runtime_state_check CHECK (
        runtime_state IS NULL
        OR (jsonb_typeof(runtime_state) = 'object' AND octet_length(runtime_state::text) <= 32768)
      );
  END IF;
END
$constraint$;

COMMENT ON COLUMN public.auto_staff_device_presence.runtime_state IS
  'Ảnh chụp runtime Desktop (scheduler, tài khoản sẵn sàng, chiến dịch đang chạy) gửi kèm heartbeat. Chỉ để hiển thị trên Web.';

-- 2. Chính sách bật tính năng (mặc định tắt; bật bằng cách sửa value).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES (
  'web.desktop_accounts',
  '{"enabled":false,"organizationIds":null,"desktopOnlyLogin":false}',
  'Web/PWA hiển thị và quản lý tài khoản Zalo mã QR/trình duyệt chạy trên app Desktop. enabled: bật tính năng; organizationIds: null = mọi tổ chức, mảng số = chỉ các tổ chức này; desktopOnlyLogin: cho tổ chức chỉ có gói Zalo Desktop (không Zalo Server/SMS) đăng nhập Web/PWA.',
  false,
  true
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.aka_agent_web_desktop_accounts_policy(p_organization_id bigint)
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
    RETURN jsonb_build_object('enabled', false, 'desktopOnlyLogin', false);
  END IF;
  SELECT setting.value INTO v_raw
  FROM public.auto_system_settings AS setting
  WHERE setting.key = 'web.desktop_accounts'
    AND setting.is_active IS TRUE
    AND setting.is_secret IS NOT TRUE;
  -- Lỗi cấu hình luôn đóng tính năng, không làm hỏng xác thực.
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN jsonb_build_object('enabled', false, 'desktopOnlyLogin', false);
  END IF;
  v_value := v_raw::jsonb;
  IF jsonb_typeof(v_value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean' THEN
    RETURN jsonb_build_object('enabled', false, 'desktopOnlyLogin', false);
  END IF;
  v_enabled := (v_value->>'enabled')::boolean;
  v_orgs := v_value->'organizationIds';
  IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
    v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'desktopOnlyLogin', v_enabled
      AND jsonb_typeof(v_value->'desktopOnlyLogin') = 'boolean'
      AND (v_value->>'desktopOnlyLogin')::boolean
  );
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_web_desktop_accounts_policy(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.aka_agent_control_web_desktop_accounts_policy(p_organization_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT private.aka_agent_web_desktop_accounts_policy(p_organization_id)
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_web_desktop_accounts_policy(bigint)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_web_desktop_accounts_policy(bigint) TO service_role;

-- 3. Tạm dừng/tiếp tục chiến dịch Desktop từ Web.
CREATE OR REPLACE FUNCTION public.aka_agent_control_set_desktop_campaign_status(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_target_status text
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  account_status text,
  pause_pending boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
AS $function$
#variable_conflict use_column
DECLARE
  v_target text := btrim(COALESCE(p_target_status, ''));
  v_status text;
  v_account_status text;
  v_account_active boolean;
  v_account_deleted boolean;
  v_claim uuid;
  v_unit uuid;
  v_campaign_name text;
  v_account_name text;
  v_busy boolean;
  v_message text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_target NOT IN ('tạm dừng', 'chờ xử lý') THEN
    RAISE EXCEPTION 'invalid_desktop_campaign_status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id AND staff.is_active IS TRUE
  ) THEN
    RETURN QUERY SELECT false, 'inactive_control_staff', p_campaign_id, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  -- Cùng thứ tự khóa với aka_agent_set_desktop_campaign_status_v2 và các RPC Control.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.status, account.status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    campaign.runtime_claim_token, campaign.runtime_unit_token,
    nullif(btrim(COALESCE(campaign.name, '')), ''), nullif(btrim(COALESCE(account.name, '')), '')
  INTO v_status, v_account_status, v_account_active, v_account_deleted,
    v_claim, v_unit, v_campaign_name, v_account_name
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND account.flatform_type = 'zalo'
    AND COALESCE(account.is_zalo_server, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::text, NULL::text, false;
    RETURN;
  END IF;
  v_busy := v_claim IS NOT NULL OR v_unit IS NOT NULL;

  IF v_target = 'tạm dừng' THEN
    IF v_status = 'tạm dừng' THEN
      RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_status NOT IN ('chờ xử lý', 'đang chạy') THEN
      RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    -- Giống Zalo Server: ghi trạng thái bền vững; scheduler Desktop đọc lại trước mỗi
    -- mục tiêu và dừng ở ranh giới, mục tiêu đang gửi được hoàn tất. Không chạm lease.
    UPDATE public.auto_campaigns AS campaign
    SET status = 'tạm dừng',
      note = CASE
        WHEN campaign.data_target_source_mode = 'data_group'
          AND btrim(COALESCE(campaign.note, '')) IN ('Chờ data phù hợp', 'Chờ data mới')
        THEN campaign.note
        ELSE NULL
      END,
      updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.status IN ('chờ xử lý', 'đang chạy');
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    v_busy := v_busy OR v_status = 'đang chạy';
    v_message := CASE WHEN v_busy
      THEN '⏸ Đã yêu cầu tạm dừng từ Web. App Desktop sẽ dừng sau mục tiêu đang xử lý.'
      ELSE '⏸ Đã tạm dừng chiến dịch từ Web.' END;
    v_status := 'tạm dừng';
  ELSE
    IF v_status = 'chờ xử lý' THEN
      RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_status = 'đang chạy' OR v_busy THEN
      RETURN QUERY SELECT false, 'runtime_busy', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_status IS DISTINCT FROM 'tạm dừng' THEN
      RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_account_deleted THEN
      RETURN QUERY SELECT false, 'account_deleted', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF NOT v_account_active THEN
      RETURN QUERY SELECT false, 'account_inactive', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    UPDATE public.auto_campaigns AS campaign
    SET status = 'chờ xử lý', note = NULL, updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'tạm dừng'
      AND campaign.runtime_claim_token IS NULL
      AND campaign.runtime_unit_token IS NULL;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'runtime_busy', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    v_message := '▶️ Đã tiếp tục chiến dịch từ Web. App Desktop sẽ chạy khi đến lịch.';
    v_status := 'chờ xử lý';
  END IF;

  -- Cùng khóa với append_auto_campaign_log để con trỏ lịch sử không nhảy cóc.
  PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:' || p_campaign_id::text, 0));
  INSERT INTO public.auto_campaign_logs (campaign_id, log)
  VALUES (
    p_campaign_id,
    to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY') || ' - '
      || concat_ws(' - ', v_account_name, v_campaign_name, v_message)
  );

  RETURN QUERY SELECT true, 'updated', p_campaign_id, v_status, v_account_status, v_busy;
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_control_set_desktop_campaign_status(bigint, bigint, bigint, text)
  FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_set_desktop_campaign_status(bigint, bigint, bigint, text)
  TO service_role;

-- 4. Vá định nghĩa live đã kiểm md5. Mỗi phép thay phải khớp đúng số lần.
CREATE OR REPLACE FUNCTION pg_temp.v453_replace(
  p_definition text, p_old text, p_new text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  v_count := (length(p_definition) - length(replace(p_definition, p_old, ''))) / greatest(length(p_old), 1);
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v453_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN replace(p_definition, p_old, p_new);
END
$helper$;

CREATE OR REPLACE FUNCTION pg_temp.v453_regexp(
  p_definition text, p_pattern text, p_replacement text, p_expected integer, p_label text
) RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM regexp_matches(p_definition, p_pattern, 'g');
  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'v453_pattern_count:%:% (expected %)', p_label, v_count, p_expected;
  END IF;
  RETURN regexp_replace(p_definition, p_pattern, p_replacement, 'g');
END
$helper$;

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
    IF f IS NULL THEN RAISE EXCEPTION 'v453_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source, r.target) THEN
      RAISE EXCEPTION 'v453_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION 'v453_unexpected_owner:%', r.signature;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    f := to_regprocedure(r.signature);
    d := pg_get_functiondef(f);
    CONTINUE WHEN md5(d) = r.target;
    SELECT jsonb_build_object('secdef', p.prosecdef, 'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text)
    INTO attrs FROM pg_proc p WHERE p.oid = f;

    IF r.signature LIKE 'public.aka_agent_control_account_snapshot(%' THEN
      d := pg_temp.v453_replace(d, '  v_chat boolean;' || E'\n',
        '  v_chat boolean;' || E'\n' || '  v_presence jsonb;' || E'\n', 1, 'snapshot_declare');
      d := pg_temp.v453_replace(d, 'AND a.flatform_type=ANY(p_platforms)',
        'AND (a.flatform_type=ANY(p_platforms) OR (a.flatform_type=''zalo'' AND ' || c_any_desktop || '))', 3, 'snapshot_platform');
      d := pg_temp.v453_replace(d,
        '(a.flatform_type=''sms'' OR (a.flatform_type=''zalo'' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))',
        '(a.flatform_type=''sms'' OR (a.flatform_type=''zalo'' AND (' || c_zalo_scope_is || ')))', 3, 'snapshot_scope');
      -- Desktop không lưu phiên trình duyệt trong DB: suy ra từ trạng thái đăng nhập.
      d := pg_temp.v453_replace(d,
        '''has_zalo_session'',CASE WHEN a.flatform_type=''zalo'' AND v_chat THEN',
        '''has_zalo_session'',CASE WHEN a.flatform_type=''zalo'' AND (v_chat OR a.is_zalo_server IS NOT TRUE) THEN', 1, 'snapshot_session');
      d := pg_temp.v453_replace(d,
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
      d := pg_temp.v453_replace(d,
        '      AND a.flatform_type = ANY(p_platforms)' || E'\n'
        || '      AND (a.flatform_type = ''sms'' OR (a.flatform_type = ''zalo'' AND a.is_zalo_show_web = false AND a.is_zalo_server = true))',
        '      AND (a.flatform_type = ANY(p_platforms) OR (a.flatform_type = ''zalo'' AND ' || c_any_desktop || '))' || E'\n'
        || '      AND (a.flatform_type = ''sms'' OR (a.flatform_type = ''zalo'' AND (' || c_zalo_scope_eq || ')))',
        1, 'page_scope');
      d := pg_temp.v453_replace(d,
        '    SELECT c.id, c.status, c.name, c.account_id, c.action_id, a.flatform_type,' || E'\n',
        '    SELECT c.id, c.status, c.name, c.account_id, c.action_id, a.flatform_type,' || E'\n'
        || '      CASE WHEN a.flatform_type = ''zalo'' AND a.is_zalo_server IS NOT TRUE THEN ''desktop'' ELSE ''web'' END AS runtime_target,' || E'\n',
        1, 'page_runtime_target');
      d := pg_temp.v453_replace(d,
        '      AND (NOT p_filters ? ''platforms'' OR p_filters->''platforms'' ? s.flatform_type)' || E'\n',
        '      AND (NOT p_filters ? ''platforms'' OR p_filters->''platforms'' ? s.flatform_type)' || E'\n'
        || '      AND (NOT p_filters ? ''runtimeTargets'' OR p_filters->''runtimeTargets'' ? s.runtime_target)' || E'\n',
        1, 'page_runtime_filter');
      d := pg_temp.v453_replace(d,
        '(a.flatform_type = ''zalo'' AND a.is_zalo_show_web = false AND a.is_zalo_server = true) AS "isZaloServer",',
        '(a.flatform_type = ''zalo'' AND a.is_zalo_show_web = false AND a.is_zalo_server = true) AS "isZaloServer",'
        || ' (a.flatform_type = ''zalo'' AND a.is_zalo_show_web IS TRUE) AS "isZaloShowWeb",'
        || ' (c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL) AS "runtimeBusy",',
        1, 'page_summary');

    ELSIF r.signature LIKE 'public.aka_agent_control_campaign_logs(%' THEN
      d := pg_temp.v453_replace(d,
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
      d := pg_temp.v453_regexp(d,
        'AND COALESCE\((account|target_account)\.is_zalo_show_web, false\) = false(\s+)AND COALESCE\(\1\.is_zalo_server, false\) = true',
        'AND NOT (COALESCE(\1.is_zalo_show_web, false)\2AND COALESCE(\1.is_zalo_server, false))',
        CASE WHEN r.signature LIKE 'public.update_control_campaign_atomic(%' THEN 5 ELSE 2 END,
        'mutation_scope:' || r.signature);
      IF r.signature LIKE 'public.update_control_campaign_atomic(%' THEN
        -- Gán lại tài khoản (kể cả sửa chiến dịch mồ côi) phải giữ nguyên nơi chạy.
        d := pg_temp.v453_replace(d,
          'AND target_account.flatform_type = account.flatform_type',
          'AND target_account.flatform_type = account.flatform_type'
          || ' AND COALESCE(target_account.is_zalo_server, false) = COALESCE(account.is_zalo_server, false)',
          2, 'update_target_runtime');
        d := pg_temp.v453_replace(d,
          'AND account.flatform_type = v_account_platform',
          'AND account.flatform_type = v_account_platform'
          || ' AND COALESCE(account.is_zalo_server, false) = (SELECT COALESCE(source_account.is_zalo_server, false)'
          || ' FROM public.auto_accounts AS source_account WHERE source_account.id = v_campaign.account_id)',
          1, 'update_patch_runtime');
      ELSIF r.signature LIKE 'public.delete_control_campaign_atomic(%' THEN
        d := pg_temp.v453_replace(d,
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
      d := pg_temp.v453_replace(d,
        'AND (v_is_zalo_show_web OR NOT v_is_zalo_server)',
        'AND v_is_zalo_show_web AND v_is_zalo_server',
        2, 'input_status_scope');

    ELSIF r.signature LIKE 'public.aka_agent_device_presence(%' THEN
      d := pg_temp.v453_replace(d,
        '(instance_id,staff_id,organization_id,device_fingerprint_hash,device_label,device_platform,app_version,started_at,last_seen_at,ended_at)',
        '(instance_id,staff_id,organization_id,device_fingerprint_hash,device_label,device_platform,app_version,started_at,last_seen_at,ended_at,runtime_state,runtime_state_at)',
        1, 'presence_columns');
      d := pg_temp.v453_replace(d,
        'stamp,stamp,CASE WHEN p_ended THEN stamp END)',
        'stamp,stamp,CASE WHEN p_ended THEN stamp END,' || E'\n'
        || '    CASE WHEN ' || c_runtime_valid || ' THEN p_device->''runtime'' END,' || E'\n'
        || '    CASE WHEN ' || c_runtime_valid || ' THEN stamp END)',
        1, 'presence_values');
      d := pg_temp.v453_replace(d,
        '    ended_at = CASE WHEN p_ended THEN stamp ELSE NULL END' || E'\n',
        '    ended_at = CASE WHEN p_ended THEN stamp ELSE NULL END,' || E'\n'
        || '    runtime_state = CASE WHEN ' || c_runtime_valid || ' THEN p_device->''runtime'' ELSE presence.runtime_state END,' || E'\n'
        || '    runtime_state_at = CASE WHEN ' || c_runtime_valid || ' THEN stamp ELSE presence.runtime_state_at END' || E'\n',
        1, 'presence_update');

    ELSIF r.signature LIKE 'public.aka_agent_authenticate_control_session(%' THEN
      d := pg_temp.v453_replace(d,
        '  v_sms_enabled boolean := false;' || E'\n',
        '  v_sms_enabled boolean := false;' || E'\n' || '  v_web_desktop_policy jsonb := ''{}''::jsonb;' || E'\n',
        1, 'session_declare');
      d := pg_temp.v453_replace(d,
        '  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled THEN' || E'\n',
        '  v_web_desktop_policy := private.aka_agent_web_desktop_accounts_policy(v_staff.organization_id);' || E'\n'
        || '  -- Tổ chức chỉ có gói Zalo Desktop vào Web/PWA khi chính sách bật rõ desktopOnlyLogin.' || E'\n'
        || '  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled AND NOT (' || E'\n'
        || '    v_zalo_qr_enabled' || E'\n'
        || '    AND v_session.client_type IN (''web'', ''pwa'')' || E'\n'
        || '    AND COALESCE((v_web_desktop_policy->>''desktopOnlyLogin'')::boolean, false)' || E'\n'
        || '  ) THEN' || E'\n',
        1, 'session_gate');
      d := pg_temp.v453_replace(d,
        '    ''sms_package'', CASE WHEN v_sms_package.id IS NULL',
        '    ''web_desktop_accounts'', v_web_desktop_policy,' || E'\n'
        || '    ''sms_package'', CASE WHEN v_sms_package.id IS NULL',
        1, 'session_output');
    END IF;

    IF md5(d) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v453_target_checksum_mismatch:%:%', r.signature, md5(d);
    END IF;
    EXECUTE d;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid = f
        AND jsonb_build_object('secdef', p.prosecdef, 'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text) = attrs
    ) THEN
      RAISE EXCEPTION 'v453_attributes_changed:%', r.signature;
    END IF;
  END LOOP;

  -- Postflight: mọi hàm đã ở bản đích, ACL hàm Control mới chỉ service_role.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(signature text, source text, target text) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.signature))) IS DISTINCT FROM r.target THEN
      RAISE EXCEPTION 'v453_postflight_failed:%', r.signature;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.aka_agent_control_web_desktop_accounts_policy(bigint)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.aka_agent_control_web_desktop_accounts_policy(bigint)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.aka_agent_control_web_desktop_accounts_policy(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v453_unexpected_new_function_acl';
  END IF;
END
$migration$;

-- Không reload schema thủ công: giữ cơ chế event trigger DDL hiện có.
COMMIT;
