-- v282: create Control Web campaigns independently of account runtime status.
-- Source: linked akachat / cgjbsmqtfhqvttudyjzq, captured 2026-09-15.
-- Built from the captured live v282 definition; preserve tenant/subtype/active/
-- deleted guards, account locks, idempotency, inputs and initial-status behavior.
-- Recognize only the captured pre-v282, deployed v282 and final definitions so
-- this single migration supports both first deployment and the in-place revision.
-- Both bulk creation entrypoints use the repository-required local 60s timeout.
-- Scheduler claim logic is unchanged and still rejects a busy account.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE r record; f oid; checksum text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)', '8b3a0fbce1c143161854a273facb2b21', '1cfc260809f66efc567da34459001c5d', 'c1673974d0982ce6a731741072ca5338'),
    ('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)', '659999b57409fa0b75aa59efce8d735a', '1b04e01063f2d59e23e063794a4574d2', '1b04e01063f2d59e23e063794a4574d2')
  ) AS expected(signature, original_checksum, source_checksum, target_checksum)
  LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL THEN RAISE EXCEPTION 'v282_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.original_checksum, r.source_checksum, r.target_checksum) THEN
      RAISE EXCEPTION 'v282_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=f
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
      AND ((checksum=r.original_checksum AND p.proconfig=ARRAY['search_path=public'])
        OR (checksum IN (r.source_checksum, r.target_checksum)
          AND p.proconfig=ARRAY['search_path=public','statement_timeout=60s']))) THEN
      RAISE EXCEPTION 'v282_unexpected_attributes:%', r.signature;
    END IF;
  END LOOP;
  f := to_regprocedure('public.claim_campaign_runtime(bigint,bigint,bigint,text)');
  IF f IS NULL OR md5(pg_get_functiondef(f)) <> 'e6b1889cda717cb0bea6f7d801633c75' THEN
    RAISE EXCEPTION 'v282_scheduler_claim_changed';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.create_control_campaign(p_staff_id bigint, p_organization_id bigint, p_idempotency_key text, p_campaign jsonb, p_inputs jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign_id bigint;
  v_account_id bigint;
  v_action_id text;
  v_action_platform text;
  v_account_platform text;
  v_input_count integer := 0;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF jsonb_typeof(COALESCE(p_campaign, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_control_campaign_payload';
  END IF;
  IF jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'too_many_campaign_inputs';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_staff_id::text || ':' || v_key, 0));

  SELECT campaign.id INTO v_campaign_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.control_idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    PERFORM account.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = v_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND (
        account.flatform_type = 'sms'
        OR (
          account.flatform_type = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )
      AND COALESCE(account.is_delete, false) = false
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_account_not_found';
    END IF;

    SELECT count(*)::integer INTO v_input_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = v_campaign_id AND COALESCE(is_delete, false) = false;
    RETURN jsonb_build_object(
      'campaign_id', v_campaign_id,
      'input_count', v_input_count,
      'created', false
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff
    WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  v_account_id := NULLIF(p_campaign->>'accountId', '')::bigint;
  v_action_id := NULLIF(btrim(COALESCE(p_campaign->>'actionId', '')), '');
  IF v_account_id IS NULL OR v_action_id IS NULL THEN
    RAISE EXCEPTION 'campaign_account_and_action_required';
  END IF;

  SELECT account.flatform_type INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
      )
    )
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'control_account_not_found';
  END IF;

  SELECT action.flatform_type INTO v_action_platform
  FROM public.auto_campaign_actions AS action
  WHERE action.id = v_action_id
    AND action.flatform_type IN ('zalo', 'sms')
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false;
  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN
    RAISE EXCEPTION 'control_action_not_allowed';
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, schedule, original_schedule,
    content, schedule_type, schedule_end_date,
    daily_stop_time, schedule_days, schedule_week_days, continue_next_day,
    refresh_data, extra_settings, images, is_delete, staff_id, organization_id,
    control_idempotency_key, created_at, updated_at
  ) VALUES (
    btrim(p_campaign->>'name'),
    v_action_id,
    v_account_id,
    'chờ xử lý',
    NULLIF(p_campaign->>'schedule', '')::timestamptz,
    NULLIF(p_campaign->>'schedule', '')::timestamptz,
    COALESCE(p_campaign->>'content', ''),
    COALESCE(NULLIF(p_campaign->>'scheduleType', ''), 'daily'),
    NULLIF(p_campaign->>'scheduleEndDate', '')::timestamptz,
    NULLIF(p_campaign->>'dailyStopTime', '')::time,
    NULLIF(p_campaign->>'scheduleDays', ''),
    NULLIF(p_campaign->>'scheduleWeekDays', ''),
    COALESCE((p_campaign->>'continueNextDay')::boolean, false),
    COALESCE((p_campaign->>'refreshData')::boolean, false),
    CASE WHEN jsonb_typeof(p_campaign->'extraSettings') = 'object'
      THEN p_campaign->'extraSettings' ELSE '{}'::jsonb END,
    CASE WHEN jsonb_typeof(p_campaign->'images') = 'array'
      THEN p_campaign->'images' ELSE '[]'::jsonb END,
    false,
    p_staff_id,
    p_organization_id,
    v_key,
    now(),
    now()
  ) RETURNING id INTO v_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, phone, phone_carrier, uid, email,
    info1, info2, info3, info4, info5, content,
    status, note, schedule, is_delete, created_at
  )
  SELECT
    v_campaign_id,
    NULL,
    NULLIF(item->>'name', ''),
    NULLIF(item->>'phone', ''),
    NULLIF(item->>'phoneCarrier', ''),
    NULLIF(item->>'uid', ''),
    NULLIF(item->>'email', ''),
    NULLIF(item->>'info1', ''),
    NULLIF(item->>'info2', ''),
    NULLIF(item->>'info3', ''),
    NULLIF(item->>'info4', ''),
    NULLIF(item->>'info5', ''),
    NULLIF(item->>'content', ''),
    'chờ xử lý',
    NULLIF(item->>'note', ''),
    NULLIF(item->>'schedule', '')::timestamptz,
    false,
    now()
  FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) AS item;
  GET DIAGNOSTICS v_input_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign_id,
    'input_count', v_input_count,
    'created', true
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_control_campaign_v2(p_staff_id bigint, p_organization_id bigint, p_idempotency_key text, p_campaign jsonb, p_inputs jsonb DEFAULT '[]'::jsonb, p_initial_status text DEFAULT 'chờ xử lý'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_id bigint;
BEGIN
  IF p_initial_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_campaign_initial_status';
  END IF;

  v_result := public.create_control_campaign(
    p_staff_id,
    p_organization_id,
    p_idempotency_key,
    p_campaign,
    p_inputs
  );

  -- The inner insert and this update share a transaction, so a cloned campaign is
  -- never externally visible in the runnable state.
  IF p_initial_status = 'tạm dừng' AND COALESCE((v_result->>'created')::boolean, false) THEN
    v_campaign_id := NULLIF(v_result->>'campaign_id', '')::bigint;
    UPDATE public.auto_campaigns
    SET status = 'tạm dừng', updated_at = now()
    WHERE id = v_campaign_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND COALESCE(is_delete, false) = false;
  END IF;

  RETURN v_result;
END;
$function$
;

DO $postflight$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)', 'c1673974d0982ce6a731741072ca5338'),
    ('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)', '1b04e01063f2d59e23e063794a4574d2')
  ) AS expected(signature, checksum)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature)
      AND md5(pg_get_functiondef(p.oid))=r.checksum
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public','statement_timeout=60s']
      AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
      RAISE EXCEPTION 'v282_postflight_failed:%', r.signature;
    END IF;
  END LOOP;
END;
$postflight$;

-- Existing DDL event triggers refresh the API cache; no extra NOTIFY is needed.
COMMIT;
