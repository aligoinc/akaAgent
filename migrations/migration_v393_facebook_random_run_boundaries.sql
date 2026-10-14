-- V393: preserve interrupted random turns through desktop startup reset.
-- Source captured live on akachat during this task; no schema/signature/ACL change.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
IF to_regprocedure('aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)'))) <> '048ea7194cd77589ffeb1820353f500c' THEN RAISE EXCEPTION 'v393 source drift: aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)'; END IF;
IF to_regprocedure('aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)'))) <> '861b73d8875f871139cf31ac165cf959' THEN RAISE EXCEPTION 'v393 source drift: aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)'; END IF;
IF to_regprocedure('private.facebook_random_finalize_on_release()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_finalize_on_release()'))) <> 'fe9cfbe03cf37328f45dabfb1ddbb155' THEN RAISE EXCEPTION 'v393 source drift: private.facebook_random_finalize_on_release()'; END IF;
IF to_regprocedure('private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)'))) <> '687fc3efe8378dd175f88f852bc47a51' THEN RAISE EXCEPTION 'v393 source drift: private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)'; END IF;
IF to_regprocedure('private.facebook_random_orphan_turns(bigint,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_orphan_turns(bigint,bigint)'))) <> 'ea0c365929e5731b4e6436bfc1c58883' THEN RAISE EXCEPTION 'v393 source drift: private.facebook_random_orphan_turns(bigint,bigint)'; END IF;
IF to_regprocedure('reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)'))) <> 'e1a49a6ef67e3e6359cf8c8163e98418' THEN RAISE EXCEPTION 'v393 source drift: reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)'; END IF;
IF to_regprocedure('reset_desktop_running_statuses(bigint,boolean,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('reset_desktop_running_statuses(bigint,boolean,boolean)'))) <> 'db9b98d9a64b555f149bfce8fc658a2c' THEN RAISE EXCEPTION 'v393 source drift: reset_desktop_running_statuses(bigint,boolean,boolean)'; END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION private.facebook_random_finalize_on_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 -- Only this staff's startup reset defers finalization. The reset restores the
 -- previous transaction-local setting immediately after its campaign update.
 IF current_setting('aka_agent.facebook_random_reset_staff', true) = NEW.staff_id::text THEN
   RETURN NEW;
 END IF;
 PERFORM private.facebook_random_finalize_turn(NEW.id,NEW.account_id,OLD.runtime_claim_token,OLD.runtime_unit_token);
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses_no_retry(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false, p_zalo_uncertain_no_retry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_non_zalo_accounts_reset integer := 0;
  v_non_zalo_campaigns_reset integer := 0;
  v_non_zalo_campaign_notes_reset integer := 0;
  v_interrupted_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_campaign_id bigint;
  v_previous_random_reset_staff text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  -- Hold the same staff-row barrier as campaign/account claims for the entire
  -- no-retry completion + existing recovery sequence.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  -- Match the delegated recovery's global order exactly:
  -- staff -> entitlement (shared) -> campaign barriers -> rows.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.action_id IS DISTINCT FROM 'sms_send'
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
      AND COALESCE(account.is_delete, false) = false
      AND (
        lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
        OR COALESCE(account.is_zalo_server, false) = false
      )
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  UPDATE public.auto_campaign_input_data AS input_data
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

  SELECT count(*)::integer INTO v_non_zalo_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;

  -- Startup reset is not a successful random-turn release. Defer output to
  -- the existing lease/orphan recovery, including when random mode is off.
  v_previous_random_reset_staff := current_setting('aka_agent.facebook_random_reset_staff', true);
  PERFORM set_config('aka_agent.facebook_random_reset_staff', p_staff_id::text, true);
  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;
  GET DIAGNOSTICS v_non_zalo_campaigns_reset = ROW_COUNT;
  PERFORM set_config('aka_agent.facebook_random_reset_staff', COALESCE(v_previous_random_reset_staff, ''), true);

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_non_zalo_accounts_reset = ROW_COUNT;

  v_result := public.reset_desktop_running_statuses(
    p_staff_id,
    COALESCE(p_exclude_zalo, false),
    COALESCE(p_zalo_uncertain_no_retry, false)
  );

  RETURN v_result || jsonb_build_object(
    'accounts_reset', COALESCE((v_result ->> 'accounts_reset')::integer, 0) + v_non_zalo_accounts_reset,
    'campaigns_reset', COALESCE((v_result ->> 'campaigns_reset')::integer, 0) + v_non_zalo_campaigns_reset,
    'campaign_notes_reset', COALESCE((v_result ->> 'campaign_notes_reset')::integer, 0) + v_non_zalo_campaign_notes_reset,
    'non_zalo_uncertain_no_retry', true,
    'non_zalo_campaign_inputs_completed', v_campaign_inputs_completed,
    'non_zalo_campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false, p_zalo_uncertain_no_retry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_notes_reset integer := 0;
  v_campaign_inputs_reset integer := 0;
  v_campaign_input_data_reset integer := 0;
  v_exclude_zalo boolean := COALESCE(p_exclude_zalo, false);
  v_zalo_uncertain_no_retry boolean := COALESCE(p_zalo_uncertain_no_retry, false);
  v_handoff_note constant text := 'Dừng do thay đổi chế độ runtime, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_campaign_id bigint;
  v_previous_random_reset_staff text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  -- Acquire every campaign/input barrier in one deterministic pass before the
  -- bulk child updates below. This is the same superset used by the no-retry
  -- wrapper, so the wrapper can safely delegate back into this function.
  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.action_id <> 'sms_send'
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
      AND COALESCE(account.is_delete, false) = false
      AND (
        lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
        OR COALESCE(account.is_zalo_server, false) = false
      )
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE input_data.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_reset = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE campaign_input.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_reset = ROW_COUNT;

  SELECT count(*)::integer INTO v_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON campaign.account_id = account.id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    );

  -- Startup reset is not a successful random-turn release. Defer output to
  -- the existing lease/orphan recovery, including when random mode is off.
  v_previous_random_reset_staff := current_setting('aka_agent.facebook_random_reset_staff', true);
  PERFORM set_config('aka_agent.facebook_random_reset_staff', p_staff_id::text, true);
  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    );
  GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;
  PERFORM set_config('aka_agent.facebook_random_reset_staff', COALESCE(v_previous_random_reset_staff, ''), true);

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'exclude_zalo', v_exclude_zalo,
    'zalo_uncertain_no_retry', v_zalo_uncertain_no_retry,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_notes_reset', v_campaign_notes_reset,
    'campaign_inputs_reset', v_campaign_inputs_reset,
    'campaign_input_data_reset', v_campaign_input_data_reset
  );
END;
$function$
;
COMMIT;
