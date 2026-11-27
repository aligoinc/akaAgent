-- Gỡ V674: trả 2 hàm kết thúc chiến dịch về bản production 27/11/2026. SINH TỪ scripts/build-v674-sql.cjs.
-- Data đã bị đóng ('Chưa gửi vì chiến dịch đã hết ngày kết thúc') giữ nguyên; sau khi gỡ, chiến dịch còn data lại chạy quá ngày kết thúc như trước.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V674: không có public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '8a1898523d8c45a9a9209f3695de9d6f' THEN RAISE EXCEPTION 'Gỡ V674: hàm đã là bản trước V674 (desktop)'; END IF;
  IF v_md5 IS DISTINCT FROM 'd725436433a8760cf07d5978209c9f64' THEN RAISE EXCEPTION 'Gỡ V674: định nghĩa không phải bản V674 (desktop: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v674_acl_desktop', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V674: không có public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'fb5eed8776a1a6f65dc9c4776a1ececd' THEN RAISE EXCEPTION 'Gỡ V674: hàm đã là bản trước V674 (server)'; END IF;
  IF v_md5 IS DISTINCT FROM '00334e838ba711ba9a65a832282e6c27' THEN RAISE EXCEPTION 'Gỡ V674: định nghĩa không phải bản V674 (server: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v674_acl_server', v_acl, true);
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_campaign(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_note text DEFAULT NULL::text, p_update_note boolean DEFAULT false, p_expected_status text DEFAULT 'đang chạy'::text, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text)
 RETURNS TABLE(completed boolean, reason text, campaign_id bigint, campaign_status text, pending_input_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign_status text;
  v_source_mode text;
  v_pending_input_count bigint := 0;
  v_expected_status text := lower(btrim(COALESCE(p_expected_status, '')));
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
  THEN
    RAISE EXCEPTION 'campaign_finalize_identity_invalid';
  END IF;
  IF v_expected_status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RAISE EXCEPTION 'campaign_finalize_expected_status_invalid';
  END IF;

  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct')
  INTO v_campaign_status, v_source_mode
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  IF v_source_mode = 'data_group' THEN
    RETURN QUERY SELECT
      false,
      'specialized_finalizer_required',
      p_campaign_id,
      v_campaign_status,
      0::bigint;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_pending_input_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'chờ xử lý';

  IF v_pending_input_count > 0 THEN
    IF v_campaign_status = v_expected_status OR v_campaign_status = 'hoàn thành' THEN
      UPDATE public.auto_campaigns
      SET status = 'chờ xử lý',
          note = NULL,
          completed_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = p_campaign_id;
      v_campaign_status := 'chờ xử lý';
    END IF;

    RETURN QUERY SELECT
      false,
      'pending_input_remaining',
      p_campaign_id,
      v_campaign_status,
      v_pending_input_count;
    RETURN;
  END IF;

  IF v_campaign_status = v_expected_status THEN
    UPDATE public.auto_campaigns AS campaign
    SET status = 'hoàn thành',
        note = CASE
          WHEN COALESCE(p_update_note, false) THEN p_note
          ELSE campaign.note
        END,
        updated_at = clock_timestamp()
    WHERE campaign.id = p_campaign_id;

    RETURN QUERY SELECT
      true,
      'completed',
      p_campaign_id,
      'hoàn thành'::text,
      0::bigint;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_campaign_status = 'hoàn thành',
    'campaign_control_won',
    p_campaign_id,
    v_campaign_status,
    0::bigint;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(p_staff_id bigint, p_organization_id bigint, p_expected_mode_revision text, p_campaign_id bigint, p_note text, p_update_note boolean)
 RETURNS TABLE(completed boolean, reason text, campaign_id bigint, campaign_status text, pending_input_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_authorized_campaign_id bigint;
  v_action_id text;
  v_schedule timestamptz;
  v_original_schedule timestamptz;
  v_schedule_type text;
  v_schedule_days text;
  v_schedule_week_days text;
  v_schedule_end_date timestamptz;
  v_schedule_time time without time zone;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_candidate_date date;
  v_next_schedule timestamptz;
  v_allowed_days integer[] := ARRAY[]::integer[];
  v_day_token text;
  v_day_numeric numeric;
  v_day_number integer;
  v_day_offset integer;
  v_is_birthday_maintenance boolean := false;
  v_is_schedule_end_maintenance boolean := false;
  v_maintenance_note text;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  PERFORM public.aka_agent_internal_require_zalo_server_runtime(
    p_staff_id,
    p_organization_id,
    p_expected_mode_revision
  );

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'zalo_server_maintenance_campaign_invalid';
  END IF;

  -- Avoid locking rows for a local or cross-tenant campaign through this
  -- SECURITY DEFINER surface. The full schedule/candidate proof is repeated
  -- with campaign/account row locks after the input-first barrier.
  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.data_target_source_mode, 'direct') = 'direct'
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Maintenance may complete the campaign based on its current input set.
  -- Stabilize that set before the schedule proof locks campaign/account.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT
    campaign.id,
    campaign.action_id,
    campaign.schedule,
    campaign.original_schedule,
    COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'),
    campaign.schedule_days,
    campaign.schedule_week_days,
    campaign.schedule_end_date
  INTO
    v_authorized_campaign_id,
    v_action_id,
    v_schedule,
    v_original_schedule,
    v_schedule_type,
    v_schedule_days,
    v_schedule_week_days,
    v_schedule_end_date
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.data_target_source_mode, 'direct') = 'direct'
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.schedule IS NOT NULL
    AND campaign.schedule < (
      date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
    )
    AND campaign.status IN ('chờ xử lý', 'hoàn thành')
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  -- Mirror resolveNextSchedule() in campaignRepository.ts. The capability
  -- revision is a freshness/CAS boundary rather than a secret, so the public
  -- Server RPC independently proves this is a real maintenance candidate.
  v_schedule_time := (
    date_trunc(
      'second',
      COALESCE(v_original_schedule, v_schedule)
        AT TIME ZONE 'Asia/Ho_Chi_Minh'
    )
  )::time;

  IF v_schedule_type = 'daily' THEN
    v_candidate_date := v_today;
  ELSIF v_schedule_type IN ('weekly', 'monthly') THEN
    FOREACH v_day_token IN ARRAY string_to_array(
      CASE
        WHEN v_schedule_type = 'weekly' THEN COALESCE(v_schedule_week_days, '')
        ELSE COALESCE(v_schedule_days, '')
      END,
      ','
    )
    LOOP
      BEGIN
        v_day_numeric := btrim(v_day_token)::numeric;
        IF v_day_numeric = trunc(v_day_numeric)
          AND (
            (v_schedule_type = 'weekly' AND v_day_numeric BETWEEN 2 AND 8)
            OR (v_schedule_type = 'monthly' AND v_day_numeric BETWEEN 1 AND 31)
          )
        THEN
          v_day_number := v_day_numeric::integer;
          IF NOT v_day_number = ANY(v_allowed_days) THEN
            v_allowed_days := array_append(v_allowed_days, v_day_number);
          END IF;
        END IF;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          NULL;
      END;
    END LOOP;

    IF cardinality(v_allowed_days) > 0 THEN
      FOR v_day_offset IN 0..(
        CASE WHEN v_schedule_type = 'weekly' THEN 13 ELSE 369 END
      )
      LOOP
        v_candidate_date := v_today + v_day_offset;
        IF (
          v_schedule_type = 'weekly'
          AND (extract(isodow FROM v_candidate_date)::integer + 1) = ANY(v_allowed_days)
        ) OR (
          v_schedule_type = 'monthly'
          AND extract(day FROM v_candidate_date)::integer = ANY(v_allowed_days)
        ) THEN
          EXIT;
        END IF;
        v_candidate_date := NULL;
      END LOOP;
    END IF;
  END IF;

  IF v_candidate_date IS NOT NULL THEN
    v_next_schedule := (
      v_candidate_date + v_schedule_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  END IF;

  v_is_birthday_maintenance := (
    v_schedule_type = 'daily'
    AND v_action_id = 'zalo_message_birthday'
  );
  v_is_schedule_end_maintenance := (
    v_schedule_end_date IS NOT NULL
    AND v_next_schedule IS NOT NULL
    AND v_next_schedule > v_schedule_end_date
  );

  IF NOT v_is_birthday_maintenance AND NOT v_is_schedule_end_maintenance THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  v_maintenance_note := CASE
    WHEN v_is_schedule_end_maintenance THEN 'Chiến dịch đã hết ngày kết thúc'
    ELSE 'Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày'
  END;

  RETURN QUERY
  SELECT
    result.completed,
    result.reason,
    result.campaign_id,
    result.campaign_status,
    result.pending_input_count
  FROM public.aka_agent_internal_finalize_zalo_server_maintenance_guard(
    p_staff_id,
    p_organization_id,
    v_authorized_campaign_id,
    v_maintenance_note,
    true,
    'chờ xử lý'
  ) AS result;
END;
$function$
;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := 'public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '8a1898523d8c45a9a9209f3695de9d6f' THEN
    RAISE EXCEPTION 'Gỡ V674 postflight: định nghĩa desktop %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v674_acl_desktop', true) THEN
    RAISE EXCEPTION 'Gỡ V674 postflight: quyền / chủ sở hữu / cấu hình desktop bị đổi';
  END IF;
  v_oid := 'public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'fb5eed8776a1a6f65dc9c4776a1ececd' THEN
    RAISE EXCEPTION 'Gỡ V674 postflight: định nghĩa server %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v674_acl_server', true) THEN
    RAISE EXCEPTION 'Gỡ V674 postflight: quyền / chủ sở hữu / cấu hình server bị đổi';
  END IF;
END $post$;

COMMIT;
