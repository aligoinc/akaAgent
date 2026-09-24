-- v317: accept late SMS results for deleted sources only against owned history.
-- Derived from production pg_get_functiondef on 2026-09-24; see audit doc.
-- Signature/return type/owner/ACL/config and active-campaign behavior are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE v_oid regprocedure;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) NOT IN
    ('c901687095ea440ca53c90c9fe25b041', '2efe388f627258da23e79842b271a16f') THEN
    RAISE EXCEPTION 'v317_definition_changed: aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)';
  END IF;
  v_oid := to_regprocedure('public.aka_agent_enqueue_group_only_automations()');
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) NOT IN
    ('64b63e1c4c521a6f5bebdde2aaf91e84', 'c6611cee9b1c40772bdb9e41234049de') THEN
    RAISE EXCEPTION 'v317_definition_changed: aka_agent_enqueue_group_only_automations()';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure(
    'public.aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)'
  ))) IS DISTINCT FROM '70ffadf2302e9601f68d1af0dab41469' THEN
    RAISE EXCEPTION 'v317_sms_fetch_definition_changed';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_record_sms_message_status(p_input_data_id bigint, p_account_id bigint, p_detail_status text, p_log text DEFAULT NULL::text, p_data jsonb DEFAULT '{}'::jsonb, p_note text DEFAULT NULL::text)
 RETURNS TABLE(input_data_id bigint, campaign_id bigint, detail_id bigint, detail_status text, counted boolean, input_updated boolean, accepted boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_input record;
  v_existing record;
  v_detail_id bigint := NULL;
  v_final_status text := p_detail_status;
  v_counted boolean := false;
  v_input_updated boolean := false;
  v_note text := p_note;
  v_existing_found boolean := false;
  v_detail_data jsonb := '{}'::jsonb;
BEGIN
  IF p_input_data_id IS NULL OR p_account_id IS NULL THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'input_data_id/account_id không hợp lệ';
    RETURN;
  END IF;

  IF p_detail_status NOT IN ('đã gửi', 'đã nhận', 'thất bại') THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'Trạng thái SMS không hợp lệ';
    RETURN;
  END IF;

  SELECT
    input_data.id,
    input_data.campaign_id,
    input_data.status,
    COALESCE(input_data.is_delete, false) AS input_deleted,
    COALESCE(campaign.is_delete, false) AS campaign_deleted,
    input_data.phone,
    input_data.phone_carrier,
    input_data.content,
    input_data.name,
    input_data.info1,
    input_data.info2,
    input_data.info3,
    input_data.info4,
    input_data.info5,
    input_data.schedule AS input_schedule,
    campaign.account_id,
    campaign.name AS campaign_name,
    campaign.schedule AS campaign_schedule
  INTO v_input
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = input_data.campaign_id
  WHERE input_data.id = p_input_data_id
    AND campaign.account_id = p_account_id
    AND campaign.action_id = 'sms_send'
  FOR UPDATE OF input_data;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'Dữ liệu SMS không thuộc tài khoản đang đăng nhập';
    RETURN;
  END IF;

  v_detail_data := COALESCE(p_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'phone', v_input.phone,
    'phoneCarrier', v_input.phone_carrier,
    'content', v_input.content,
    'name', v_input.name,
    'info1', v_input.info1,
    'info2', v_input.info2,
    'info3', v_input.info3,
    'info4', v_input.info4,
    'info5', v_input.info5,
    'inputSchedule', v_input.input_schedule,
    'campaignSchedule', v_input.campaign_schedule,
    'effectiveSchedule', COALESCE(v_input.input_schedule, v_input.campaign_schedule),
    'campaignName', v_input.campaign_name
  ));

  PERFORM pg_advisory_xact_lock(hashtextextended('aka_agent_sms_status:' || p_input_data_id::text, 0));

  SELECT
    detail.id,
    detail.account_id,
    detail.campaign_id,
    detail.status,
    detail.log,
    detail.data
  INTO v_existing
  FROM public.auto_campaign_details AS detail
  WHERE detail.input_data_id = p_input_data_id
    AND detail.action_code = 'sms_send'
    AND COALESCE(detail.is_delete, false) = false
  ORDER BY detail.created_at DESC NULLS LAST, detail.id DESC
  LIMIT 1
  FOR UPDATE;
  v_existing_found := FOUND;

  -- A late callback is historical evidence, not permission to run a deleted
  -- campaign. Only an existing, undeleted SMS detail owned by this account may
  -- be updated; do not recreate details, count quota or touch input/campaign state.
  IF v_input.input_deleted OR v_input.campaign_deleted THEN
    IF NOT v_existing_found THEN
      RETURN QUERY SELECT
        p_input_data_id, v_input.campaign_id, NULL::bigint, NULL::text,
        false, false, false,
        'Dữ liệu SMS đã xoá chưa có lịch sử gửi để cập nhật kết quả';
      RETURN;
    END IF;

    IF v_existing.account_id IS DISTINCT FROM p_account_id
      OR v_existing.campaign_id IS DISTINCT FROM v_input.campaign_id THEN
      RETURN QUERY SELECT
        p_input_data_id, NULL::bigint, NULL::bigint, NULL::text,
        false, false, false,
        'Dữ liệu SMS không thuộc tài khoản đang đăng nhập';
      RETURN;
    END IF;

    IF v_existing.status IS NULL
      OR v_existing.status NOT IN ('đã gửi', 'đã nhận', 'thất bại') THEN
      RETURN QUERY SELECT
        p_input_data_id, v_input.campaign_id, NULL::bigint, NULL::text,
        false, false, false,
        'Lịch sử SMS không hợp lệ để cập nhật kết quả';
      RETURN;
    END IF;

    v_final_status := v_existing.status;
    IF v_existing.status <> 'đã nhận'
      AND (
        p_detail_status = 'đã nhận'
        OR (p_detail_status = 'thất bại' AND v_existing.status <> 'thất bại')
      )
    THEN
      UPDATE public.auto_campaign_details
      SET
        status = p_detail_status,
        log = p_log,
        data = COALESCE(v_existing.data, '{}'::jsonb) || v_detail_data
      WHERE id = v_existing.id;
      v_final_status := p_detail_status;
    END IF;

    RETURN QUERY SELECT
      p_input_data_id, v_input.campaign_id, v_existing.id, v_final_status,
      false, false, true, NULL::text;
    RETURN;
  END IF;

  IF NOT v_existing_found THEN
    IF p_detail_status = 'đã nhận' THEN
      RETURN QUERY SELECT
        p_input_data_id,
        v_input.campaign_id,
        NULL::bigint,
        NULL::text,
        false,
        false,
        false,
        'Chưa có trạng thái đã gửi để cập nhật đã nhận';
      RETURN;
    END IF;

    INSERT INTO public.auto_campaign_details (
      input_data_id,
      campaign_id,
      account_id,
      action_code,
      action_name,
      status,
      log,
      data,
      counts_toward_limit
    )
    VALUES (
      p_input_data_id,
      v_input.campaign_id,
      p_account_id,
      'sms_send',
      'Gửi tin nhắn SMS',
      p_detail_status,
      p_log,
      v_detail_data,
      true
    )
    RETURNING id INTO v_detail_id;

    PERFORM public.increment_auto_account_action_count(p_account_id, 'sms_send', 1);
    v_counted := true;
    v_input_updated := true;
  ELSE
    v_detail_id := v_existing.id;
    v_final_status := v_existing.status;

    IF v_existing.status <> 'đã nhận'
      AND (
        p_detail_status = 'đã nhận'
        OR (p_detail_status = 'thất bại' AND v_existing.status <> 'thất bại')
      )
    THEN
      UPDATE public.auto_campaign_details
      SET
        status = p_detail_status,
        log = p_log,
        data = COALESCE(v_existing.data, '{}'::jsonb) || v_detail_data
      WHERE id = v_existing.id;

      v_final_status := p_detail_status;
      v_input_updated := true;
    END IF;

    IF NOT v_input_updated AND v_input.status <> 'hoàn thành' THEN
      v_input_updated := true;
      IF v_final_status = 'thất bại' THEN
        v_note := COALESCE(
          v_existing.log,
          v_existing.data ->> 'errorMessage',
          v_existing.data ->> 'errorCode',
          'Gửi SMS thất bại'
        );
      ELSE
        v_note := NULL;
      END IF;
    END IF;
  END IF;

  IF v_input_updated THEN
    IF v_final_status = 'thất bại' THEN
      v_note := COALESCE(v_note, p_log, 'Gửi SMS thất bại');
    ELSE
      v_note := NULL;
    END IF;

    UPDATE public.auto_campaign_input_data
    SET
      status = 'hoàn thành',
      note = v_note,
      date_action = now()
    WHERE id = p_input_data_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS remaining
    WHERE remaining.campaign_id = v_input.campaign_id
      AND COALESCE(remaining.is_delete, false) = false
      AND remaining.status IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
  ) THEN
    UPDATE public.auto_campaigns
    SET
      status = 'hoàn thành',
      note = NULL,
      updated_at = now()
    WHERE id = v_input.campaign_id
      AND action_id = 'sms_send'
      AND COALESCE(is_delete, false) = false;
  END IF;

  RETURN QUERY SELECT
    p_input_data_id,
    v_input.campaign_id,
    v_detail_id,
    v_final_status,
    v_counted,
    v_input_updated,
    true,
    NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_enqueue_group_only_automations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_event_at timestamptz := clock_timestamp();
  v_reconcile_event_at text;
  v_is_reconcile boolean := false;
  v_enqueue_error text;
BEGIN
  v_is_reconcile := COALESCE(
    current_setting('aka_agent.automation_reconcile', true),
    ''
  ) = 'on';
  v_reconcile_event_at := NULLIF(
    current_setting('aka_agent.automation_event_at', true),
    ''
  );
  IF v_is_reconcile AND v_reconcile_event_at IS NOT NULL THEN
    BEGIN
      v_event_at := v_reconcile_event_at::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_event_at := clock_timestamp();
    END;
  END IF;

  IF NEW.input_data_id IS NULL OR COALESCE(NEW.is_delete, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.action_code IS NOT DISTINCT FROM OLD.action_code
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete
    AND NOT v_is_reconcile
  THEN
    RETURN NEW;
  END IF;

  -- Serialize sole-group enqueue against Data Group soft/hard deletion. Lock
  -- every candidate group in a deterministic order, then let the INSERT query
  -- re-check both the group and rule live state.
  PERFORM locked_group.id
  FROM public.auto_account_contact_groups AS locked_group
  WHERE locked_group.purpose = 'data_group'
    AND locked_group.is_delete = false
    AND EXISTS (
      SELECT 1
      FROM public.auto_automation AS automation
      WHERE automation.source_campaign_id = NEW.campaign_id
        AND automation.target_campaign_id IS NULL
        AND automation.target_data_group_id = locked_group.id
        AND automation.staff_id = locked_group.staff_id
        AND automation.organization_id = locked_group.organization_id
        AND automation.is_active = true
        AND automation.is_delete = false
    )
  ORDER BY locked_group.id
  FOR SHARE OF locked_group;

  INSERT INTO public.auto_automation_detail (
    automation_id,
    parent_automation_detail_id,
    source_campaign_detail_id,
    source_campaign_input_data_id,
    source_campaign_id,
    source_account_id,
    source_action_id,
    source_action_code,
    source_status,
    target_campaign_id,
    target_account_id,
    target_action_id,
    data_type_code,
    data_value,
    source_input_snapshot,
    config_snapshot,
    target_contact_group_id,
    target_data_group_id,
    scheduled_at,
    status,
    next_attempt_at,
    last_error,
    processed_at,
    staff_id,
    organization_id,
    created_at,
    updated_at
  )
  SELECT
    automation.id,
    parent_execution.id,
    NEW.id,
    source_input.id,
    source_campaign.id,
    source_campaign.account_id,
    source_campaign.action_id,
    NEW.action_code,
    NEW.status,
    NULL,
    NULL,
    NULL,
    automation.data_type_code,
    NULLIF(btrim(CASE data_type.source_column
      WHEN 'phone' THEN source_input.phone
      WHEN 'email' THEN source_input.email
      ELSE source_input.uid
    END), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'id', source_input.id,
      'campaign_id', source_input.campaign_id,
      'input_id', source_input.input_id,
      'name', source_input.name,
      'phone', source_input.phone,
      'phone_carrier', source_input.phone_carrier,
      'uid', source_input.uid,
      'email', source_input.email,
      'info1', source_input.info1,
      'info2', source_input.info2,
      'info3', source_input.info3,
      'info4', source_input.info4,
      'info5', source_input.info5,
      'content', source_input.content,
      'schedule', source_input.schedule,
      'created_at', source_input.created_at
    )),
    jsonb_build_object(
      'automation_id', automation.id,
      'automation_name', automation.name,
      'automation_action_id', automation.automation_action_id,
      'config_version', automation.config_version,
      'data_type_code', automation.data_type_code,
      'data_type_category_item_id', automation.data_type_category_item_id,
      'target_contact_type', source_mapping.target_contact_type,
      'target_contact_group_id', NULL,
      'target_data_group_id', automation.target_data_group_id,
      'target_campaign', NULL
    ),
    NULL,
    automation.target_data_group_id,
    v_event_at,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN 'bỏ qua'
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN 'bỏ qua'
      ELSE 'chờ xử lý'
    END,
    v_event_at,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN 'fixed_schedule_expired'
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN 'source_data_missing'
      ELSE NULL
    END,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN v_event_at
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN v_event_at
      ELSE NULL
    END,
    automation.staff_id,
    automation.organization_id,
    v_event_at,
    v_event_at
  FROM public.auto_automation AS automation
  JOIN public.auto_automation_actions AS automation_action
    ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type
    ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
   AND COALESCE(source_campaign.is_delete, false) = false
  JOIN public.auto_campaign_input_data AS source_input
    ON source_input.id = NEW.input_data_id
   AND source_input.campaign_id = source_campaign.id
   AND COALESCE(source_input.is_delete, false) = false
  JOIN public.auto_campaign_action_data_types AS source_mapping
    ON source_mapping.campaign_action_id = source_campaign.action_id
   AND source_mapping.data_type_code = automation.data_type_code
   AND source_mapping.can_source = true
   AND source_mapping.is_active = true
   AND source_mapping.is_delete = false
   AND (
     automation.data_type_category_item_id IS NULL
     OR (
       source_mapping.data_type_category_item_id =
         automation.data_type_category_item_id
       AND source_input.data_type_category_item_id =
         automation.data_type_category_item_id
     )
   )
  JOIN public.auto_account_contact_groups AS target_data_group
    ON target_data_group.id = automation.target_data_group_id
   AND target_data_group.staff_id = automation.staff_id
   AND target_data_group.organization_id = automation.organization_id
   AND target_data_group.purpose = 'data_group'
   AND target_data_group.is_delete = false
  LEFT JOIN public.auto_automation_detail AS parent_execution
    ON parent_execution.id = NEW.auto_automation_detail_id
   AND parent_execution.staff_id = automation.staff_id
   AND parent_execution.organization_id = automation.organization_id
  WHERE automation.source_campaign_id = NEW.campaign_id
    AND automation.target_campaign_id IS NULL
    AND automation.target_data_group_id IS NOT NULL
    AND automation.is_active = true
    AND automation.is_delete = false
    AND automation.activated_at IS NOT NULL
    AND automation.activated_at <= v_event_at
    AND automation_action.id = 'campaign_detail_route'
    AND automation_action.is_available = true
    AND automation_action.is_active = true
    AND automation_action.is_delete = false
    AND source_campaign.staff_id = automation.staff_id
    AND source_campaign.organization_id = automation.organization_id
    AND EXISTS (
      SELECT 1
      FROM public.auto_automation_trigger_statuses AS trigger_status
      WHERE trigger_status.automation_id = automation.id
        AND lower(trigger_status.status_value) = lower(NEW.status)
        AND (
          trigger_status.action_code IS NULL
          OR trigger_status.action_code IS NOT DISTINCT FROM NEW.action_code
        )
    )
  ON CONFLICT (automation_id, source_campaign_detail_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  v_enqueue_error := SQLERRM;
  BEGIN
    INSERT INTO public.auto_automation_enqueue_failures (
      source_campaign_detail_id, source_campaign_id, source_status,
      source_action_code, source_is_delete, event_at, status,
      next_attempt_at, last_error, resolved_at, staff_id,
      organization_id, updated_at
    )
    SELECT
      NEW.id, campaign.id, NEW.status, NEW.action_code,
      COALESCE(NEW.is_delete, false), v_event_at, 'pending',
      clock_timestamp(), left(v_enqueue_error, 2000), NULL,
      campaign.staff_id, campaign.organization_id, clock_timestamp()
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = NEW.campaign_id
    ON CONFLICT (source_campaign_detail_id) DO UPDATE SET
      source_campaign_id = EXCLUDED.source_campaign_id,
      source_status = EXCLUDED.source_status,
      source_action_code = EXCLUDED.source_action_code,
      source_is_delete = EXCLUDED.source_is_delete,
      event_at = EXCLUDED.event_at,
      status = 'pending',
      next_attempt_at = clock_timestamp(),
      last_error = EXCLUDED.last_error,
      resolved_at = NULL,
      staff_id = EXCLUDED.staff_id,
      organization_id = EXCLUDED.organization_id,
      updated_at = clock_timestamp();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'Group-only Automation enqueue failure could not be persisted for detail %: %',
      NEW.id, SQLERRM;
  END;
  RAISE WARNING
    'Group-only Automation enqueue deferred for campaign detail %: %',
    NEW.id, v_enqueue_error;
  RETURN NEW;
END;
$function$;

-- No explicit schema reload: existing signatures and permissions are unchanged.
COMMIT;
