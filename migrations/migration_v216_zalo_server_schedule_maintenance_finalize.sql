-- Finalize stale direct campaigns during QR Zalo Server schedule maintenance
-- without depending on the desktop process-only username/password.
--
-- The mode revision is an ownership/CAS boundary, not a secret. This narrow
-- SECURITY DEFINER surface also verifies the live Product 16/18 Server mode
-- and only accepts direct campaigns assigned to QR Zalo accounts in the same
-- tenant. The pending-input behavior mirrors the v214 desktop finalizer.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_require_zalo_server_runtime(
  p_staff_id bigint,
  p_organization_id bigint,
  p_expected_mode_revision text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_staff_organization_id bigint;
  v_mode record;
  v_expected_mode_revision text := btrim(COALESCE(p_expected_mode_revision, ''));
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR v_expected_mode_revision = ''
  THEN
    RAISE EXCEPTION 'zalo_server_runtime_not_owner';
  END IF;

  SELECT staff.organization_id INTO v_staff_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_staff_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'zalo_server_runtime_not_owner';
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(p_organization_id);

  IF NOT COALESCE(v_mode.qr_enabled, false)
    OR COALESCE(v_mode.web_enabled, false)
    OR NOT COALESCE(v_mode.is_zalo_server, false)
    OR btrim(COALESCE(v_mode.mode_revision, '')) IS DISTINCT FROM v_expected_mode_revision
  THEN
    RAISE EXCEPTION 'zalo_server_runtime_not_owner';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_finalize_zalo_server_maintenance_guard(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_note text,
  p_update_note boolean,
  p_expected_status text
)
RETURNS TABLE(
  completed boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  pending_input_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_campaign_status text;
  v_source_mode text;
  v_pending_input_count bigint := 0;
  v_expected_status text := lower(btrim(COALESCE(p_expected_status, '')));
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
  THEN
    RAISE EXCEPTION 'campaign_finalize_identity_invalid';
  END IF;
  IF v_expected_status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RAISE EXCEPTION 'campaign_finalize_expected_status_invalid';
  END IF;

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
    WHERE campaign.id = p_campaign_id
      AND campaign.status = v_expected_status;

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
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_expected_mode_revision text,
  p_campaign_id bigint,
  p_note text,
  p_update_note boolean
)
RETURNS TABLE(
  completed boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  pending_input_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
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
  PERFORM public.aka_agent_internal_require_zalo_server_runtime(
    p_staff_id,
    p_organization_id,
    p_expected_mode_revision
  );

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'zalo_server_maintenance_campaign_invalid';
  END IF;

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
    AND account.flatform_type = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
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

  -- Mirror resolveNextSchedule() in campaignRepository.ts. The runtime mode
  -- revision is a freshness/CAS boundary rather than a secret, so the public
  -- Server RPC must independently prove this is exactly a maintenance
  -- candidate instead of trusting a caller-provided next schedule.
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
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_internal_require_zalo_server_runtime(
  bigint, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_internal_finalize_zalo_server_maintenance_guard(
  bigint, bigint, bigint, text, boolean, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(
  bigint, bigint, text, bigint, text, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(
  bigint, bigint, text, bigint, text, boolean
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(
  bigint, bigint, text, bigint, text, boolean
) IS
  'Finalize one stale direct QR Zalo Server campaign during daily schedule maintenance while preserving the v214 pending-input guard.';

NOTIFY pgrst, 'reload schema';

COMMIT;
