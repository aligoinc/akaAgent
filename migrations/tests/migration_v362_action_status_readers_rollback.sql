-- Retain this file and the apply/rollback history. No historical recalculation.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='2s';
-- An empty new-column partial index must not fall back to a historical heap scan.
SET LOCAL enable_seqscan=off;
LOCK TABLE public.auto_account_action_status_policies IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.auto_campaign_details IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $guard$ BEGIN
IF to_regprocedure('public.aka_agent_mark_email_open(text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_mark_email_open(text,text)')))<>'43fa1d3a95fca0448e714a9dddff16c3' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_mark_email_open(text,text)'; END IF;
IF to_regprocedure('public.aka_agent_mark_email_click(text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_mark_email_click(text,text)')))<>'13bd35c961fe486823ff0263887911f0' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_mark_email_click(text,text)'; END IF;
IF to_regprocedure('public.aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)')))<>'c06650808d8a4c26b1ad8e8fa21c81f6' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)'; END IF;
IF to_regprocedure('public.auto_automation_to_json(bigint,bigint,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.auto_automation_to_json(bigint,bigint,bigint)')))<>'c13373cfefa4f19eed801d20bdae216a' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: auto_automation_to_json(bigint,bigint,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_get_automation_options(bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_get_automation_options(bigint,bigint,text,text)')))<>'971cae0a816058b9213b6e85b4fd252d' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_get_automation_options(bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.auto_save_automation_v171_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.auto_save_automation_v171_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text)')))<>'b84327bdc57c58a9df6404f3ce50ea09' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: auto_save_automation_v171_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_enqueue_campaign_detail_automations()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_enqueue_campaign_detail_automations()')))<>'9858143987af45606d6da1ba5ea4dbb4' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_enqueue_campaign_detail_automations()'; END IF;
IF to_regprocedure('public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)')))<>'eabd2a7730a2ff803918e4cdbc70e5c5' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)'; END IF;
IF to_regprocedure('public.aka_agent_save_automation_v205_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_save_automation_v205_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)')))<>'566456a7a9a2244f707bcbe668c5bb3d' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_save_automation_v205_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)'; END IF;
IF to_regprocedure('public.aka_agent_enqueue_group_only_automations()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_enqueue_group_only_automations()')))<>'8e520c75e512e99aeba552e4792d873d' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_enqueue_group_only_automations()'; END IF;
IF to_regprocedure('public.fn_opp_trial_state(bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.fn_opp_trial_state(bigint)')))<>'460abfed9f0f52131c6e0475ffb347bb' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: fn_opp_trial_state(bigint)'; END IF;
IF to_regprocedure('public.fn_opp_ctx(aka_salesopportunity)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.fn_opp_ctx(aka_salesopportunity)')))<>'1c3ab0533a7a2ebf1fd868b8a73dc7d4' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: fn_opp_ctx(aka_salesopportunity)'; END IF;
IF to_regprocedure('public.crm_agent_campaign_results(bigint[],bigint[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.crm_agent_campaign_results(bigint[],bigint[])')))<>'53da13aaf1f735071e4a50c74a2b862f' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: crm_agent_campaign_results(bigint[],bigint[])'; END IF;
IF to_regprocedure('public.crm_trial_campaign_signal_counts(bigint[],bigint[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.crm_trial_campaign_signal_counts(bigint[],bigint[])')))<>'f36e7da0909e3acc2ac43aff1f50b8e5' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: crm_trial_campaign_signal_counts(bigint[],bigint[])'; END IF;
IF to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)')))<>'593cdd93a81e86d37ce026465550d4f9' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)')))<>'10faa8adcee8daef16c7a9b60aca5d97' THEN RAISE EXCEPTION 'migration_v362_action_status_readers target drift: aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)'; END IF;
IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.auto_campaign_details'::regclass AND tgname='trg_aka_agent_enqueue_campaign_detail_automations') IS DISTINCT FROM 'CREATE TRIGGER trg_aka_agent_enqueue_campaign_detail_automations AFTER INSERT OR UPDATE OF status, action_code, is_delete, sub_status_id ON public.auto_campaign_details FOR EACH ROW EXECUTE FUNCTION aka_agent_enqueue_campaign_detail_automations()' THEN RAISE EXCEPTION 'rollback trigger drift: trg_aka_agent_enqueue_campaign_detail_automations'; END IF;
IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.auto_campaign_details'::regclass AND tgname='trg_aka_agent_enqueue_group_only_automations') IS DISTINCT FROM 'CREATE TRIGGER trg_aka_agent_enqueue_group_only_automations AFTER INSERT OR UPDATE OF status, action_code, is_delete, sub_status_id ON public.auto_campaign_details FOR EACH ROW EXECUTE FUNCTION aka_agent_enqueue_group_only_automations()' THEN RAISE EXCEPTION 'rollback trigger drift: trg_aka_agent_enqueue_group_only_automations'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE status_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE result_key IS NOT NULL) THEN RAISE EXCEPTION 'result catalog already used; retain readers/schema and rollback future runtime only'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.aka_agent_enqueue_campaign_detail_automations()
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
  v_source_action_id text;
  v_semantic_status_id bigint;
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
    EXCEPTION
      WHEN OTHERS THEN
        v_event_at := clock_timestamp();
    END;
  END IF;

  IF NEW.input_data_id IS NULL OR COALESCE(NEW.is_delete, false) THEN
    UPDATE public.auto_automation_enqueue_failures AS failure
    SET
      status = 'resolved',
      resolved_at = clock_timestamp(),
      last_error = NULL,
      updated_at = clock_timestamp()
    WHERE failure.source_campaign_detail_id = NEW.id
      AND failure.status = 'pending';
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.action_code IS NOT DISTINCT FROM OLD.action_code
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete
    AND NOT v_is_reconcile THEN
    RETURN NEW;
  END IF;

  SELECT campaign.action_id
  INTO v_source_action_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = NEW.campaign_id
    AND COALESCE(campaign.is_delete, false) = false;

  IF v_source_action_id IS NULL THEN
    UPDATE public.auto_automation_enqueue_failures AS failure
    SET
      status = 'resolved',
      resolved_at = clock_timestamp(),
      last_error = 'source_campaign_missing_or_deleted',
      updated_at = clock_timestamp()
    WHERE failure.source_campaign_detail_id = NEW.id
      AND failure.status = 'pending';
    RETURN NEW;
  END IF;

  -- Keep the open-ended status catalog useful even before a rule selects a new
  -- runtime value. This is metadata-only and stays inside the protected outbox
  -- trigger subtransaction.
  BEGIN
    SELECT status_catalog.id
    INTO v_semantic_status_id
    FROM public.auto_status AS status_catalog
    WHERE status_catalog.component_type = 'campaign_detail'
      AND status_catalog.is_active = true
      AND status_catalog.is_delete = false
      AND lower(status_catalog.name) = lower(NEW.status)
    ORDER BY status_catalog.sort_order, status_catalog.id
    LIMIT 1;

    INSERT INTO public.auto_campaign_action_detail_statuses (
      campaign_action_id,
      action_code,
      status_id,
      status_value,
      label,
      is_active,
      is_delete,
      updated_at
    )
    VALUES (
      v_source_action_id,
      NEW.action_code,
      v_semantic_status_id,
      NEW.status,
      NEW.status,
      true,
      false,
      v_event_at
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.auto_campaign_action_detail_statuses AS status_mapping
    SET
      is_active = true,
      label = NEW.status,
      status_id = COALESCE(status_mapping.status_id, v_semantic_status_id),
      updated_at = v_event_at
    WHERE status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.action_code IS NOT DISTINCT FROM NEW.action_code
      AND lower(status_mapping.status_value) = lower(NEW.status)
      AND status_mapping.is_delete = false;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING
        'Automation status catalog update ignored for campaign detail %: %',
        NEW.id,
        SQLERRM;
  END;

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
    target_campaign.id,
    target_campaign.account_id,
    target_campaign.action_id,
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
      'target_contact_type', target_mapping.target_contact_type,
      'target_contact_group_id', automation.target_contact_group_id,
      'schedule_mode', automation.schedule_mode,
      'delay_days', automation.delay_days,
      'delay_hours', automation.delay_hours,
      'fixed_at', automation.fixed_at,
      'target_campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', target_campaign.id,
        'name', target_campaign.name,
        'action_id', target_campaign.action_id,
        'account_id', target_campaign.account_id,
        'status', target_campaign.status,
        'schedule', target_campaign.schedule,
        'original_schedule', target_campaign.original_schedule,
        'content', target_campaign.content,
        'extra_settings', target_campaign.extra_settings,
        'images', target_campaign.images
      ))
    ),
    automation.target_contact_group_id,
    CASE automation.schedule_mode
      WHEN 'after_delay' THEN v_event_at + make_interval(
        days => automation.delay_days,
        hours => automation.delay_hours
      )
      WHEN 'fixed_at' THEN automation.fixed_at
      ELSE v_event_at
    END,
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
    CASE automation.schedule_mode
      WHEN 'after_delay' THEN v_event_at + make_interval(
        days => automation.delay_days,
        hours => automation.delay_hours
      )
      WHEN 'fixed_at' THEN automation.fixed_at
      ELSE v_event_at
    END,
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
  JOIN public.auto_campaign_input_data AS source_input
    ON source_input.id = NEW.input_data_id
   AND source_input.campaign_id = source_campaign.id
   AND COALESCE(source_input.is_delete, false) = false
  JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = automation.target_campaign_id
   AND COALESCE(target_campaign.is_delete, false) = false
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
  JOIN public.auto_campaign_action_data_types AS target_mapping
    ON target_mapping.campaign_action_id = target_campaign.action_id
   AND target_mapping.data_type_code = automation.data_type_code
   AND target_mapping.can_target = true
   AND target_mapping.is_active = true
   AND target_mapping.is_delete = false
   AND (
     automation.data_type_category_item_id IS NULL
     OR target_mapping.data_type_category_item_id =
       automation.data_type_category_item_id
   )
  LEFT JOIN public.auto_automation_detail AS parent_execution
    ON parent_execution.id = NEW.auto_automation_detail_id
   AND parent_execution.staff_id = automation.staff_id
   AND parent_execution.organization_id = automation.organization_id
  WHERE automation.source_campaign_id = NEW.campaign_id
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
    AND target_campaign.staff_id = automation.staff_id
    AND target_campaign.organization_id = automation.organization_id
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

  UPDATE public.auto_automation_enqueue_failures AS failure
  SET
    status = 'resolved',
    resolved_at = clock_timestamp(),
    last_error = NULL,
    updated_at = clock_timestamp()
  WHERE failure.source_campaign_detail_id = NEW.id
    AND failure.status = 'pending';

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    v_enqueue_error := SQLERRM;
    BEGIN
      INSERT INTO public.auto_automation_enqueue_failures (
        source_campaign_detail_id,
        source_campaign_id,
        source_status,
        source_action_code,
        source_is_delete,
        event_at,
        status,
        next_attempt_at,
        last_error,
        resolved_at,
        staff_id,
        organization_id,
        updated_at
      )
      SELECT
        NEW.id,
        campaign.id,
        NEW.status,
        NEW.action_code,
        COALESCE(NEW.is_delete, false),
        v_event_at,
        'pending',
        clock_timestamp(),
        left(v_enqueue_error, 2000),
        NULL,
        campaign.staff_id,
        campaign.organization_id,
        clock_timestamp()
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
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING
          'Automation enqueue failure could not be persisted for campaign detail %: %',
          NEW.id,
          SQLERRM;
    END;

    RAISE WARNING
      'Automation enqueue deferred for campaign detail %: %',
      NEW.id,
      v_enqueue_error;
    RETURN NEW;
END;
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.auto_automation_to_json(p_automation_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    public.aka_agent_semantic_row_json(to_jsonb(automation))
    || jsonb_build_object(
      'automation_action_name', automation_action.name,
      'data_type_name', data_type.name,
      'target_data_group_name', target_data_group.name,
      'source_campaign', jsonb_build_object(
        'id', source_campaign.id,
        'name', source_campaign.name,
        'action_id', source_campaign.action_id,
        'action_name', source_action.name,
        'account_id', source_campaign.account_id,
        'account_name', source_account.name,
        'flatform_type', source_action.flatform_type
      ),
      'target_campaign', CASE
        WHEN target_campaign.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', target_campaign.id,
          'name', target_campaign.name,
          'action_id', target_campaign.action_id,
          'action_name', target_action.name,
          'account_id', target_campaign.account_id,
          'account_name', target_account.name,
          'flatform_type', target_action.flatform_type
        )
      END,
      'target_contact_group', CASE
        WHEN target_group.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', target_group.id,
          'name', target_group.name,
          'contact_type', target_group.contact_type,
          'purpose', target_group.purpose
        )
      END,
      'trigger_statuses', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', trigger_status.id,
          'status_mapping_id', trigger_status.status_mapping_id,
          'semantic_status_id', status_mapping.status_id,
          'action_code', trigger_status.action_code,
          'action_name', account_action.name,
          'is_wildcard', trigger_status.action_code IS NULL,
          'status_value', trigger_status.status_value,
          'status_label', COALESCE(status_mapping.label, trigger_status.status_value)
        ) ORDER BY
          lower(trigger_status.status_value),
          status_mapping.sort_order,
          trigger_status.id
        )
        FROM public.auto_automation_trigger_statuses AS trigger_status
        JOIN public.auto_campaign_action_detail_statuses AS status_mapping
          ON status_mapping.id = trigger_status.status_mapping_id
        LEFT JOIN public.auto_account_actions AS account_action
          ON account_action.code = trigger_status.action_code
        WHERE trigger_status.automation_id = automation.id
      ), '[]'::jsonb),
      'execution_summary', jsonb_build_object(
        'total', COALESCE(execution_count.total, 0),
        'queued', COALESCE(execution_count.queued, 0),
        'processing', COALESCE(execution_count.processing, 0),
        'materialized', COALESCE(execution_count.materialized, 0),
        'skipped', COALESCE(execution_count.skipped, 0),
        'failed', COALESCE(execution_count.failed, 0),
        'latest_status', latest_execution.status,
        'latest_created_at', latest_execution.created_at,
        'latest_processed_at', latest_execution.processed_at
      )
    )
  FROM public.auto_automation AS automation
  JOIN public.auto_automation_actions AS automation_action
    ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type
    ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_actions AS source_action
    ON source_action.id = source_campaign.action_id
  JOIN public.auto_accounts AS source_account
    ON source_account.id = source_campaign.account_id
  LEFT JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = automation.target_campaign_id
  LEFT JOIN public.auto_campaign_actions AS target_action
    ON target_action.id = target_campaign.action_id
  LEFT JOIN public.auto_accounts AS target_account
    ON target_account.id = target_campaign.account_id
  LEFT JOIN public.auto_account_contact_groups AS target_group
    ON target_group.id = automation.target_contact_group_id
  LEFT JOIN public.auto_account_contact_groups AS target_data_group
    ON target_data_group.id = automation.target_data_group_id
   AND target_data_group.purpose = 'data_group'
   AND target_data_group.is_delete = false
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE detail.status = 'chờ xử lý')::integer AS queued,
      count(*) FILTER (WHERE detail.status = 'đang xử lý')::integer AS processing,
      count(*) FILTER (WHERE detail.status = 'đã thêm')::integer AS materialized,
      count(*) FILTER (WHERE detail.status = 'bỏ qua')::integer AS skipped,
      count(*) FILTER (WHERE detail.status = 'lỗi')::integer AS failed
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
  ) AS execution_count ON true
  LEFT JOIN LATERAL (
    SELECT detail.status, detail.created_at, detail.processed_at
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
    ORDER BY detail.created_at DESC, detail.id DESC
    LIMIT 1
  ) AS latest_execution ON true
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_get_automation_options(p_staff_id bigint, p_organization_id bigint, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT jsonb_build_object(
    'automation_actions', COALESCE((
      SELECT jsonb_agg(to_jsonb(automation_action) ORDER BY automation_action.sort_order, automation_action.id)
      FROM public.auto_automation_actions AS automation_action
      WHERE automation_action.is_active = true
        AND automation_action.is_delete = false
    ), '[]'::jsonb),
    'data_types', COALESCE((
      SELECT jsonb_agg(to_jsonb(data_type) ORDER BY data_type.sort_order, data_type.code)
      FROM public.auto_automation_data_types AS data_type
      WHERE data_type.is_active = true
        AND data_type.is_delete = false
    ), '[]'::jsonb),
    'action_data_types', COALESCE((
      SELECT jsonb_agg(public.aka_agent_semantic_row_json(to_jsonb(mapping)) ORDER BY mapping.sort_order, mapping.campaign_action_id, mapping.data_type_code, mapping.data_type_category_item_id)
      FROM public.auto_campaign_action_data_types AS mapping
      WHERE mapping.is_active = true
        AND mapping.is_delete = false
    ), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', campaign.id,
          'name', campaign.name,
          'action_id', campaign.action_id,
          'action_name', campaign_action.name,
          'account_id', campaign.account_id,
          'account_name', account.name,
          'flatform_type', campaign_action.flatform_type,
          'status', campaign.status,
          'schedule', campaign.schedule,
          'original_schedule', campaign.original_schedule,
          'data_types', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'code', mapping.data_type_code,
                'can_source', mapping.can_source,
                'can_target', mapping.can_target,
                'target_contact_type', mapping.target_contact_type
              )
              ORDER BY mapping.sort_order, mapping.data_type_code
            )
            FROM public.auto_campaign_action_data_types AS mapping
            WHERE mapping.campaign_action_id = campaign.action_id
              AND mapping.is_active = true
              AND mapping.is_delete = false
          ), '[]'::jsonb)
        )
        ORDER BY campaign.updated_at DESC, campaign.id DESC
      )
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_campaign_actions AS campaign_action
        ON campaign_action.id = campaign.action_id
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
      WHERE campaign.staff_id = p_staff_id
        AND campaign.organization_id = p_organization_id
        AND COALESCE(campaign.is_delete, false) = false
        AND campaign_action.is_active = true
        AND COALESCE(campaign_action.is_delete, false) = false
        AND account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND COALESCE(account.is_delete, false) = false
        AND EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id = campaign.action_id
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
    ), '[]'::jsonb),
    'contact_groups', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', contact_group.id,
          'name', contact_group.name,
          'account_id', contact_group.account_id,
          'contact_type', contact_group.contact_type,
          'purpose', contact_group.purpose
        )
        ORDER BY lower(contact_group.name), contact_group.id
      )
      FROM public.auto_account_contact_groups AS contact_group
      JOIN public.auto_accounts AS account
        ON account.id = contact_group.account_id
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
        AND account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND COALESCE(account.is_delete, false) = false
    ), '[]'::jsonb),
    'catalog_statuses', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', status_mapping.id,
          'status_mapping_id', status_mapping.id,
          'campaign_action_id', status_mapping.campaign_action_id,
          'action_code', status_mapping.action_code,
          'action_name', account_action.name,
          'is_wildcard', status_mapping.action_code IS NULL,
          'status_id', status_mapping.status_id,
          'semantic_status_id', status_mapping.status_id,
          'status_value', status_mapping.status_value,
          'status_label', COALESCE(status_mapping.label, status_mapping.status_value),
          'label', COALESCE(status_mapping.label, status_mapping.status_value)
        )
        ORDER BY status_mapping.campaign_action_id,
          status_mapping.sort_order,
          status_mapping.id
      )
      FROM public.auto_campaign_action_detail_statuses AS status_mapping
      LEFT JOIN public.auto_account_actions AS account_action
        ON account_action.code = status_mapping.action_code
      WHERE status_mapping.is_active = true
        AND status_mapping.is_delete = false
    ), '[]'::jsonb),
    'status_options', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'campaign_action_id', observed.campaign_action_id,
          'status_mapping_id', NULL,
          'action_code', observed.action_code,
          'action_name', account_action.name,
          'is_wildcard', observed.action_code IS NULL,
          'status_id', semantic_status.id,
          'semantic_status_id', semantic_status.id,
          'status_value', observed.status_value,
          'status_label', observed.status_value,
          'occurrence_count', observed.occurrence_count,
          'last_seen_at', observed.last_seen_at
        )
        ORDER BY observed.campaign_action_id,
          lower(observed.status_value),
          observed.action_code
      )
      FROM (
        SELECT
          campaign.action_id AS campaign_action_id,
          detail.action_code,
          detail.status AS status_value,
          count(*)::integer AS occurrence_count,
          max(detail.created_at) AS last_seen_at
        FROM public.auto_campaigns AS campaign
        JOIN public.auto_campaign_details AS detail
          ON detail.campaign_id = campaign.id
        WHERE campaign.staff_id = p_staff_id
          AND campaign.organization_id = p_organization_id
          AND COALESCE(campaign.is_delete, false) = false
          AND COALESCE(detail.is_delete, false) = false
        GROUP BY campaign.action_id, detail.action_code, detail.status
      ) AS observed
      LEFT JOIN public.auto_account_actions AS account_action
        ON account_action.code = observed.action_code
      LEFT JOIN LATERAL (
        SELECT status_catalog.id
        FROM public.auto_status AS status_catalog
        WHERE status_catalog.component_type = 'campaign_detail'
          AND status_catalog.is_active = true
          AND status_catalog.is_delete = false
          AND lower(status_catalog.name) = lower(observed.status_value)
        ORDER BY status_catalog.sort_order, status_catalog.id
        LIMIT 1
      ) AS semantic_status ON true
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_action_detail_statuses AS status_mapping
        WHERE status_mapping.campaign_action_id = observed.campaign_action_id
          AND status_mapping.action_code IS NOT DISTINCT FROM observed.action_code
          AND lower(status_mapping.status_value) = lower(observed.status_value)
          AND status_mapping.is_active = true
          AND status_mapping.is_delete = false
      )
    ), '[]'::jsonb)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.auto_save_automation_v171_internal(p_staff_id bigint, p_organization_id bigint, p_automation_id bigint, p_name text, p_source_campaign_id bigint, p_target_campaign_id bigint, p_data_type_code text, p_target_contact_group_id bigint, p_schedule_mode text, p_delay_days integer, p_delay_hours integer, p_fixed_at timestamp with time zone, p_note text, p_is_active boolean, p_trigger_statuses jsonb, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_existing public.auto_automation%ROWTYPE;
  v_rule_id bigint;
  v_validation jsonb;
  v_source_action_id text;
  v_status jsonb;
  v_action_code text;
  v_status_value text;
  v_status_mapping_id bigint;
  v_semantic_status_id bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL
    OR length(btrim(p_name)) > 200 THEN
    RAISE EXCEPTION 'invalid_automation_name';
  END IF;

  IF jsonb_typeof(COALESCE(p_trigger_statuses, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_trigger_statuses) = 0
    OR jsonb_array_length(p_trigger_statuses) > 100 THEN
    RAISE EXCEPTION 'invalid_automation_trigger_statuses';
  END IF;

  -- Validate tenant/campaign/data/schedule before any rule mutation. Trigger
  -- status validation happens again after the replacement set is inserted.
  v_validation := public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    false
  );
  v_source_action_id := v_validation ->> 'source_action_id';

  IF p_automation_id IS NULL THEN
    INSERT INTO public.auto_automation (
      automation_action_id,
      name,
      source_campaign_id,
      target_campaign_id,
      data_type_code,
      target_contact_group_id,
      schedule_mode,
      delay_days,
      delay_hours,
      fixed_at,
      note,
      is_active,
      activated_at,
      config_version,
      is_delete,
      staff_id,
      organization_id
    )
    VALUES (
      'campaign_detail_route',
      btrim(p_name),
      p_source_campaign_id,
      p_target_campaign_id,
      p_data_type_code,
      p_target_contact_group_id,
      p_schedule_mode,
      COALESCE(p_delay_days, 0),
      COALESCE(p_delay_hours, 0),
      p_fixed_at,
      NULLIF(btrim(COALESCE(p_note, '')), ''),
      COALESCE(p_is_active, false),
      CASE WHEN COALESCE(p_is_active, false) THEN clock_timestamp() ELSE NULL END,
      1,
      false,
      p_staff_id,
      p_organization_id
    )
    RETURNING id INTO v_rule_id;
  ELSE
    SELECT *
    INTO v_existing
    FROM public.auto_automation AS automation
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'automation_not_found';
    END IF;

    UPDATE public.auto_automation AS automation
    SET
      name = btrim(p_name),
      source_campaign_id = p_source_campaign_id,
      target_campaign_id = p_target_campaign_id,
      data_type_code = p_data_type_code,
      target_contact_group_id = p_target_contact_group_id,
      schedule_mode = p_schedule_mode,
      delay_days = COALESCE(p_delay_days, 0),
      delay_hours = COALESCE(p_delay_hours, 0),
      fixed_at = p_fixed_at,
      note = NULLIF(btrim(COALESCE(p_note, '')), ''),
      is_active = COALESCE(p_is_active, false),
      -- A configuration edit starts a new event boundary. Existing executions
      -- keep their snapshot and the rule never backfills older result rows.
      activated_at = CASE
        WHEN COALESCE(p_is_active, false) THEN clock_timestamp()
        ELSE automation.activated_at
      END,
      config_version = automation.config_version + 1,
      updated_at = clock_timestamp()
    WHERE automation.id = v_existing.id
    RETURNING automation.id INTO v_rule_id;

    DELETE FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id;
  END IF;

  FOR v_status IN
    SELECT item.value
    FROM jsonb_array_elements(p_trigger_statuses) AS item(value)
  LOOP
    IF jsonb_typeof(v_status) <> 'object' THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    v_action_code := NULLIF(btrim(COALESCE(
      v_status ->> 'actionCode',
      v_status ->> 'action_code',
      ''
    )), '');
    v_status_value := NULLIF(btrim(COALESCE(
      v_status ->> 'statusValue',
      v_status ->> 'status_value',
      v_status ->> 'status',
      ''
    )), '');

    IF v_status_value IS NULL OR length(v_status_value) > 200 THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status_value';
    END IF;

    IF v_action_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_account_actions AS account_action
        WHERE account_action.code = v_action_code
          AND account_action.is_active = true
          AND account_action.is_delete = false
      ) THEN
      RAISE EXCEPTION 'invalid_automation_trigger_action_code';
    END IF;

    SELECT status_catalog.id
    INTO v_semantic_status_id
    FROM public.auto_status AS status_catalog
    WHERE status_catalog.component_type = 'campaign_detail'
      AND status_catalog.is_active = true
      AND status_catalog.is_delete = false
      AND lower(status_catalog.name) = lower(v_status_value)
    ORDER BY status_catalog.sort_order, status_catalog.id
    LIMIT 1;

    INSERT INTO public.auto_campaign_action_detail_statuses (
      campaign_action_id,
      action_code,
      status_id,
      status_value,
      label,
      is_active,
      is_delete,
      updated_at
    )
    VALUES (
      v_source_action_id,
      v_action_code,
      v_semantic_status_id,
      v_status_value,
      v_status_value,
      true,
      false,
      clock_timestamp()
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.auto_campaign_action_detail_statuses AS status_mapping
    SET
      is_active = true,
      label = v_status_value,
      status_id = COALESCE(status_mapping.status_id, v_semantic_status_id),
      updated_at = clock_timestamp()
    WHERE status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
      AND lower(status_mapping.status_value) = lower(v_status_value)
      AND status_mapping.is_delete = false;

    SELECT status_mapping.id
    INTO v_status_mapping_id
    FROM public.auto_campaign_action_detail_statuses AS status_mapping
    WHERE status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
      AND lower(status_mapping.status_value) = lower(v_status_value)
      AND status_mapping.is_delete = false
    ORDER BY status_mapping.id
    LIMIT 1;

    IF v_status_mapping_id IS NULL THEN
      RAISE EXCEPTION 'automation_status_mapping_failed';
    END IF;

    INSERT INTO public.auto_automation_trigger_statuses (
      automation_id,
      status_mapping_id,
      action_code,
      status_value
    )
    VALUES (
      v_rule_id,
      v_status_mapping_id,
      v_action_code,
      v_status_value
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id
  ) THEN
    RAISE EXCEPTION 'automation_trigger_status_required';
  END IF;

  PERFORM public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    v_rule_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    true
  );

  RETURN public.auto_automation_to_json(
    v_rule_id,
    p_staff_id,
    p_organization_id
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_save_automation_v205_internal(p_staff_id bigint, p_organization_id bigint, p_automation_id bigint, p_name text, p_source_campaign_id bigint, p_target_campaign_id bigint, p_data_type_code text, p_target_contact_group_id bigint, p_target_data_group_id bigint, p_schedule_mode text, p_delay_days integer, p_delay_hours integer, p_fixed_at timestamp with time zone, p_note text, p_is_active boolean, p_trigger_statuses jsonb, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text, p_delay_value integer DEFAULT NULL::integer, p_delay_unit text DEFAULT NULL::text, p_daily_time time without time zone DEFAULT NULL::time without time zone, p_delay_exact_time time without time zone DEFAULT NULL::time without time zone, p_delay_exact_time_present boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_existing public.auto_automation%ROWTYPE;
  v_rule_id bigint;
  v_source_action_id text;
  v_schedule_mode text := lower(NULLIF(btrim(COALESCE(p_schedule_mode, '')), ''));
  v_delay_value integer := p_delay_value;
  v_delay_unit text := lower(NULLIF(btrim(COALESCE(p_delay_unit, '')), ''));
  v_effective_delay_exact_time time without time zone;
  v_status jsonb;
  v_status_mapping_id bigint;
  v_status_mapping_id_text text;
  v_action_code text;
  v_status_value text;
  v_semantic_status_id bigint;
  v_mapping record;
BEGIN
  -- Authentication must precede every tenant-scoped existence check.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF p_target_campaign_id IS NULL AND p_target_data_group_id IS NULL THEN
    RAISE EXCEPTION 'automation_destination_required';
  END IF;

  IF p_target_campaign_id IS NOT NULL THEN
    -- The established campaign validator/save stack remains authoritative for
    -- campaign-only and dual-destination rules.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
      0
    ));
    IF p_target_data_group_id IS NOT NULL THEN
      PERFORM contact_group.id
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.id = p_target_data_group_id
        AND contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
      FOR SHARE OF contact_group;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_target_data_group';
      END IF;
    END IF;
    RETURN public.aka_agent_save_automation_v201_campaign_internal(
      p_staff_id, p_organization_id, p_automation_id, p_name,
      p_source_campaign_id, p_target_campaign_id, p_data_type_code,
      p_target_contact_group_id, p_target_data_group_id, p_schedule_mode,
      p_delay_days, p_delay_hours, p_fixed_at, p_note, p_is_active,
      p_trigger_statuses, p_auth_username, p_auth_password, p_delay_value,
      p_delay_unit, p_daily_time, p_delay_exact_time,
      p_delay_exact_time_present
    );
  END IF;

  IF p_target_contact_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'target_contact_group_requires_campaign';
  END IF;
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL
    OR length(btrim(p_name)) > 200
  THEN
    RAISE EXCEPTION 'invalid_automation_name';
  END IF;
  IF length(COALESCE(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'invalid_automation_note';
  END IF;
  IF jsonb_typeof(COALESCE(p_trigger_statuses, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_trigger_statuses) = 0
    OR jsonb_array_length(p_trigger_statuses) > 100
  THEN
    RAISE EXCEPTION 'invalid_automation_trigger_statuses';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_automation_staff';
  END IF;

  SELECT campaign.action_id
  INTO v_source_action_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_campaign_actions AS campaign_action
    ON campaign_action.id = campaign.action_id
   AND campaign_action.is_active = true
   AND COALESCE(campaign_action.is_delete, false) = false
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = p_organization_id
   AND COALESCE(account.is_delete, false) = false
  WHERE campaign.id = p_source_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false;
  IF v_source_action_id IS NULL THEN
    RAISE EXCEPTION 'invalid_source_campaign';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_automation_data_types AS data_type
    JOIN public.auto_campaign_action_data_types AS mapping
      ON mapping.data_type_code = data_type.code
     AND mapping.campaign_action_id = v_source_action_id
     AND mapping.can_source = true
     AND mapping.is_active = true
     AND mapping.is_delete = false
    WHERE data_type.code = p_data_type_code
      AND data_type.is_active = true
      AND data_type.is_delete = false
  ) THEN
    RAISE EXCEPTION 'source_campaign_data_type_not_supported';
  END IF;

  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_target_data_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR SHARE OF contact_group;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_target_data_group';
  END IF;

  IF v_schedule_mode NOT IN ('immediate', 'after_delay', 'daily_time', 'fixed_at')
    OR COALESCE(p_delay_days, 0) NOT BETWEEN 0 AND 3650
    OR COALESCE(p_delay_hours, 0) NOT BETWEEN 0 AND 23
  THEN
    RAISE EXCEPTION 'invalid_automation_schedule';
  END IF;

  -- Preserve the v176 compatibility contract for clients that still send only
  -- delay_days/delay_hours.
  IF v_schedule_mode = 'after_delay'
    AND v_delay_value IS NULL
    AND v_delay_unit IS NULL
    AND (
      COALESCE(p_delay_days, 0) > 0
      OR COALESCE(p_delay_hours, 0) > 0
    )
  THEN
    IF COALESCE(p_delay_hours, 0) = 0 THEN
      v_delay_value := COALESCE(p_delay_days, 0);
      v_delay_unit := 'day';
    ELSE
      v_delay_value := LEAST(
        (
          COALESCE(p_delay_days, 0) * 24
        ) + COALESCE(p_delay_hours, 0),
        87600
      );
      v_delay_unit := 'hour';
    END IF;
  END IF;

  IF v_schedule_mode = 'after_delay' THEN
    IF COALESCE(p_delay_exact_time_present, false) THEN
      v_effective_delay_exact_time := p_delay_exact_time;
    ELSIF p_automation_id IS NOT NULL THEN
      SELECT automation.delay_exact_time
      INTO v_effective_delay_exact_time
      FROM public.auto_automation AS automation
      WHERE automation.id = p_automation_id
        AND automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
        AND automation.is_delete = false;
    END IF;
  END IF;

  IF v_schedule_mode = 'immediate' AND (
    COALESCE(p_delay_days, 0) <> 0
    OR COALESCE(p_delay_hours, 0) <> 0
    OR v_delay_value IS NOT NULL OR v_delay_unit IS NOT NULL
    OR p_daily_time IS NOT NULL OR p_fixed_at IS NOT NULL
    OR v_effective_delay_exact_time IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid_immediate_schedule';
  ELSIF v_schedule_mode = 'after_delay' AND (
    v_delay_value IS NULL
    OR v_delay_unit NOT IN ('minute', 'hour', 'day')
    OR v_delay_value <= 0
    OR (v_delay_unit = 'minute' AND v_delay_value > 5256000)
    OR (v_delay_unit = 'hour' AND v_delay_value > 87600)
    OR (v_delay_unit = 'day' AND v_delay_value > 3650)
    OR p_daily_time IS NOT NULL OR p_fixed_at IS NOT NULL
    OR (
      v_effective_delay_exact_time IS NOT NULL
      AND (
        v_effective_delay_exact_time >= time '24:00'
        OR EXTRACT(SECOND FROM v_effective_delay_exact_time) <> 0
      )
    )
  ) THEN
    RAISE EXCEPTION 'invalid_delay_schedule';
  ELSIF v_schedule_mode = 'daily_time' AND (
    COALESCE(p_delay_days, 0) <> 0
    OR COALESCE(p_delay_hours, 0) <> 0
    OR v_delay_value IS NOT NULL OR v_delay_unit IS NOT NULL
    OR p_daily_time IS NULL
    OR EXTRACT(SECOND FROM p_daily_time) <> 0
    OR p_fixed_at IS NOT NULL
    OR v_effective_delay_exact_time IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid_daily_time_schedule';
  ELSIF v_schedule_mode = 'fixed_at' AND (
    p_fixed_at IS NULL
    OR COALESCE(p_delay_days, 0) <> 0
    OR COALESCE(p_delay_hours, 0) <> 0
    OR v_delay_value IS NOT NULL OR v_delay_unit IS NOT NULL
    OR p_daily_time IS NOT NULL
    OR v_effective_delay_exact_time IS NOT NULL
    OR (COALESCE(p_is_active, false) AND p_fixed_at <= clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'invalid_fixed_schedule';
  END IF;

  IF p_automation_id IS NULL THEN
    INSERT INTO public.auto_automation (
      automation_action_id, name, source_campaign_id, target_campaign_id,
      data_type_code, target_contact_group_id, target_data_group_id,
      schedule_mode, delay_days, delay_hours, delay_value, delay_unit,
      delay_exact_time, daily_time, fixed_at, note, is_active, activated_at,
      config_version, is_delete, staff_id, organization_id
    ) VALUES (
      'campaign_detail_route', btrim(p_name), p_source_campaign_id, NULL,
      p_data_type_code, NULL, p_target_data_group_id,
      v_schedule_mode, COALESCE(p_delay_days, 0), COALESCE(p_delay_hours, 0),
      v_delay_value, v_delay_unit, v_effective_delay_exact_time, p_daily_time,
      p_fixed_at, NULLIF(btrim(COALESCE(p_note, '')), ''),
      COALESCE(p_is_active, false),
      CASE WHEN COALESCE(p_is_active, false) THEN clock_timestamp() ELSE NULL END,
      1, false, p_staff_id, p_organization_id
    )
    RETURNING id INTO v_rule_id;
  ELSE
    SELECT *
    INTO v_existing
    FROM public.auto_automation AS automation
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'automation_not_found';
    END IF;

    UPDATE public.auto_automation AS automation
    SET name = btrim(p_name),
        source_campaign_id = p_source_campaign_id,
        target_campaign_id = NULL,
        data_type_code = p_data_type_code,
        target_contact_group_id = NULL,
        target_data_group_id = p_target_data_group_id,
        schedule_mode = v_schedule_mode,
        delay_days = COALESCE(p_delay_days, 0),
        delay_hours = COALESCE(p_delay_hours, 0),
        delay_value = v_delay_value,
        delay_unit = v_delay_unit,
        delay_exact_time = v_effective_delay_exact_time,
        daily_time = p_daily_time,
        fixed_at = p_fixed_at,
        note = NULLIF(btrim(COALESCE(p_note, '')), ''),
        is_active = COALESCE(p_is_active, false),
        activated_at = CASE
          WHEN COALESCE(p_is_active, false) THEN clock_timestamp()
          ELSE automation.activated_at
        END,
        config_version = automation.config_version + 1,
        updated_at = clock_timestamp()
    WHERE automation.id = v_existing.id
    RETURNING automation.id INTO v_rule_id;

    DELETE FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id;
  END IF;

  FOR v_status IN
    SELECT item.value
    FROM jsonb_array_elements(p_trigger_statuses) AS item(value)
  LOOP
    IF jsonb_typeof(v_status) <> 'object' THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    v_status_mapping_id := NULL;
    v_status_mapping_id_text := NULLIF(btrim(COALESCE(
      v_status ->> 'statusMappingId',
      v_status ->> 'status_mapping_id',
      ''
    )), '');

    IF v_status_mapping_id_text IS NOT NULL THEN
      IF v_status_mapping_id_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status';
      END IF;
      v_status_mapping_id := v_status_mapping_id_text::bigint;
    ELSE
      v_action_code := NULLIF(btrim(COALESCE(
        v_status ->> 'actionCode', v_status ->> 'action_code', ''
      )), '');
      v_status_value := NULLIF(btrim(COALESCE(
        v_status ->> 'statusValue', v_status ->> 'status_value',
        v_status ->> 'status', ''
      )), '');
      IF v_status_value IS NULL OR length(v_status_value) > 200 THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status_value';
      END IF;
      IF v_action_code IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_actions AS account_action
        WHERE account_action.code = v_action_code
          AND account_action.is_active = true
          AND account_action.is_delete = false
      ) THEN
        RAISE EXCEPTION 'invalid_automation_trigger_action_code';
      END IF;

      SELECT status_mapping.id
      INTO v_status_mapping_id
      FROM public.auto_campaign_action_detail_statuses AS status_mapping
      WHERE status_mapping.campaign_action_id = v_source_action_id
        AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
        AND lower(status_mapping.status_value) = lower(v_status_value)
        AND status_mapping.is_active = true
        AND status_mapping.is_delete = false
      ORDER BY status_mapping.id
      LIMIT 1;

      IF v_status_mapping_id IS NULL THEN
        SELECT status_catalog.id
        INTO v_semantic_status_id
        FROM public.auto_status AS status_catalog
        WHERE status_catalog.component_type = 'campaign_detail'
          AND status_catalog.is_active = true
          AND status_catalog.is_delete = false
          AND lower(status_catalog.name) = lower(v_status_value)
        ORDER BY status_catalog.sort_order, status_catalog.id
        LIMIT 1;

        INSERT INTO public.auto_campaign_action_detail_statuses (
          campaign_action_id, action_code, status_id, status_value, label,
          is_active, is_delete, updated_at
        ) VALUES (
          v_source_action_id, v_action_code, v_semantic_status_id,
          v_status_value, v_status_value, true, false, clock_timestamp()
        )
        ON CONFLICT DO NOTHING;

        UPDATE public.auto_campaign_action_detail_statuses AS status_mapping
        SET is_active = true,
            label = v_status_value,
            status_id = COALESCE(
              status_mapping.status_id,
              v_semantic_status_id
            ),
            updated_at = clock_timestamp()
        WHERE status_mapping.campaign_action_id = v_source_action_id
          AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
          AND lower(status_mapping.status_value) = lower(v_status_value)
          AND status_mapping.is_delete = false;

        SELECT status_mapping.id
        INTO v_status_mapping_id
        FROM public.auto_campaign_action_detail_statuses AS status_mapping
        WHERE status_mapping.campaign_action_id = v_source_action_id
          AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
          AND lower(status_mapping.status_value) = lower(v_status_value)
          AND status_mapping.is_active = true
          AND status_mapping.is_delete = false
        ORDER BY status_mapping.id
        LIMIT 1;
      END IF;
    END IF;

    SELECT
      status_mapping.id,
      status_mapping.action_code,
      status_mapping.status_value
    INTO v_mapping
    FROM public.auto_campaign_action_detail_statuses AS status_mapping
    WHERE status_mapping.id = v_status_mapping_id
      AND status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.is_active = true
      AND status_mapping.is_delete = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    INSERT INTO public.auto_automation_trigger_statuses (
      automation_id, status_mapping_id, action_code, status_value
    ) VALUES (
      v_rule_id, v_mapping.id, v_mapping.action_code, v_mapping.status_value
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- A wildcard already covers specifics with the same semantic status.
  DELETE FROM public.auto_automation_trigger_statuses AS specific
  USING public.auto_campaign_action_detail_statuses AS specific_mapping,
    public.auto_automation_trigger_statuses AS wildcard,
    public.auto_campaign_action_detail_statuses AS wildcard_mapping
  WHERE specific.automation_id = v_rule_id
    AND specific.status_mapping_id = specific_mapping.id
    AND specific.action_code IS NOT NULL
    AND wildcard.automation_id = specific.automation_id
    AND wildcard.action_code IS NULL
    AND wildcard.status_mapping_id = wildcard_mapping.id
    AND (
      lower(wildcard.status_value) = lower(specific.status_value)
      OR (
        wildcard_mapping.status_id IS NOT NULL
        AND specific_mapping.status_id IS NOT NULL
        AND wildcard_mapping.status_id = specific_mapping.status_id
      )
    );

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id
  ) THEN
    RAISE EXCEPTION 'automation_trigger_status_required';
  END IF;

  RETURN public.auto_automation_to_json(
    v_rule_id, p_staff_id, p_organization_id
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_save_automation(p_staff_id bigint, p_organization_id bigint, p_automation_id bigint, p_name text, p_source_campaign_id bigint, p_target_campaign_id bigint, p_data_type_code text, p_target_contact_group_id bigint, p_schedule_mode text, p_delay_days integer, p_delay_hours integer, p_fixed_at timestamp with time zone, p_note text, p_is_active boolean, p_trigger_statuses jsonb, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text, p_delay_value integer DEFAULT NULL::integer, p_delay_unit text DEFAULT NULL::text, p_daily_time time without time zone DEFAULT NULL::time without time zone, p_delay_exact_time time without time zone DEFAULT NULL::time without time zone, p_delay_exact_time_present boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_saved jsonb;
  v_rule_id bigint;
  v_source_action_id text;
  v_schedule_mode text := lower(NULLIF(btrim(COALESCE(p_schedule_mode, '')), ''));
  v_effective_delay_exact_time time without time zone;
  v_status jsonb;
  v_status_mapping_id bigint;
  v_status_mapping_id_text text;
  v_mapping record;
  v_normalized_statuses jsonb := '[]'::jsonb;
  v_canonical_statuses jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  SELECT campaign.action_id
  INTO v_source_action_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_source_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false;

  IF v_source_action_id IS NULL THEN
    RAISE EXCEPTION 'invalid_source_campaign';
  END IF;

  IF jsonb_typeof(COALESCE(p_trigger_statuses, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_trigger_statuses) = 0
    OR jsonb_array_length(p_trigger_statuses) > 100 THEN
    RAISE EXCEPTION 'invalid_automation_trigger_statuses';
  END IF;

  FOR v_status IN
    SELECT item.value
    FROM jsonb_array_elements(p_trigger_statuses) AS item(value)
  LOOP
    IF jsonb_typeof(v_status) <> 'object' THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    v_status_mapping_id := NULL;
    v_status_mapping_id_text := NULLIF(btrim(COALESCE(
      v_status ->> 'statusMappingId',
      v_status ->> 'status_mapping_id',
      ''
    )), '');

    IF v_status_mapping_id_text IS NOT NULL THEN
      IF v_status_mapping_id_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status';
      END IF;

      v_status_mapping_id := v_status_mapping_id_text::bigint;

      SELECT
        status_mapping.id,
        status_mapping.action_code,
        status_mapping.status_id,
        status_mapping.status_value,
        status_mapping.label
      INTO v_mapping
      FROM public.auto_campaign_action_detail_statuses AS status_mapping
      WHERE status_mapping.id = v_status_mapping_id
        AND status_mapping.campaign_action_id = v_source_action_id
        AND status_mapping.is_active = true
        AND status_mapping.is_delete = false;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status';
      END IF;

      v_normalized_statuses := v_normalized_statuses || jsonb_build_array(
        jsonb_build_object(
          'statusMappingId', v_mapping.id,
          'semanticStatusId', v_mapping.status_id,
          'actionCode', v_mapping.action_code,
          'statusValue', v_mapping.status_value
        )
      );
    ELSE
      -- Legacy clients continue to submit actionCode + statusValue. The v173
      -- implementation remains the compatibility resolver/create path.
      v_normalized_statuses := v_normalized_statuses || jsonb_build_array(
        jsonb_build_object(
          'actionCode', NULLIF(btrim(COALESCE(
            v_status ->> 'actionCode',
            v_status ->> 'action_code',
            ''
          )), ''),
          'statusValue', NULLIF(btrim(COALESCE(
            v_status ->> 'statusValue',
            v_status ->> 'status_value',
            v_status ->> 'status',
            ''
          )), '')
        )
      );
    END IF;
  END LOOP;

  -- A wildcard status already includes every specific action with the same
  -- semantic status. Keep it and discard only those redundant specifics.
  SELECT COALESCE(jsonb_agg(candidate.value ORDER BY candidate.ordinality), '[]'::jsonb)
  INTO v_canonical_statuses
  FROM jsonb_array_elements(v_normalized_statuses) WITH ORDINALITY AS candidate(value, ordinality)
  WHERE NULLIF(btrim(COALESCE(candidate.value ->> 'actionCode', '')), '') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_normalized_statuses) AS wildcard(value)
      WHERE NULLIF(btrim(COALESCE(wildcard.value ->> 'actionCode', '')), '') IS NULL
        AND (
          lower(COALESCE(wildcard.value ->> 'statusValue', ''))
            = lower(COALESCE(candidate.value ->> 'statusValue', ''))
          OR (
            NULLIF(wildcard.value ->> 'semanticStatusId', '') IS NOT NULL
            AND NULLIF(candidate.value ->> 'semanticStatusId', '') IS NOT NULL
            AND (wildcard.value ->> 'semanticStatusId')
              = (candidate.value ->> 'semanticStatusId')
          )
        )
    );

  IF v_schedule_mode = 'after_delay' THEN
    IF COALESCE(p_delay_exact_time_present, false) THEN
      v_effective_delay_exact_time := p_delay_exact_time;
    ELSIF p_automation_id IS NOT NULL THEN
      SELECT automation.delay_exact_time
      INTO v_effective_delay_exact_time
      FROM public.auto_automation AS automation
      WHERE automation.id = p_automation_id
        AND automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
        AND automation.is_delete = false
      FOR UPDATE;
    END IF;
  END IF;

  -- Validate before touching the existing row so invalid HH:mm values return
  -- the domain error rather than a generic CHECK violation.
  PERFORM public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    false,
    p_delay_value,
    p_delay_unit,
    p_daily_time,
    v_effective_delay_exact_time
  );

  IF p_automation_id IS NOT NULL THEN
    -- v173 temporarily neutralizes the schedule to immediate. Clear the new
    -- field first so that neutral state remains constraint-valid.
    UPDATE public.auto_automation AS automation
    SET delay_exact_time = NULL
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false;
  END IF;

  v_saved := public.aka_agent_save_automation_v173_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_name,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    p_note,
    p_is_active,
    v_canonical_statuses,
    p_auth_username,
    p_auth_password,
    p_delay_value,
    p_delay_unit,
    p_daily_time
  );

  v_rule_id := NULLIF(v_saved ->> 'id', '')::bigint;
  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'automation_save_failed';
  END IF;

  UPDATE public.auto_automation AS automation
  SET
    delay_exact_time = CASE
      WHEN automation.schedule_mode = 'after_delay'
        THEN v_effective_delay_exact_time
      ELSE NULL
    END,
    updated_at = clock_timestamp()
  WHERE automation.id = v_rule_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;

  PERFORM public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    v_rule_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    true,
    p_delay_value,
    p_delay_unit,
    p_daily_time,
    v_effective_delay_exact_time
  );

  RETURN public.auto_automation_to_json(
    v_rule_id,
    p_staff_id,
    p_organization_id
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_mark_email_open(p_open_token text, p_user_agent text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message_tracking_id bigint, campaign_detail_id bigint, open_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_message public.auto_email_message_trackings%ROWTYPE;
  v_now timestamptz := now();
  v_user_agent text := NULLIF(left(COALESCE(p_user_agent, ''), 1000), '');
  v_raw_token text := trim(COALESCE(p_open_token, ''));
  v_open_token uuid;
BEGIN
  IF v_raw_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, 0;
    RETURN;
  END IF;

  v_open_token := v_raw_token::uuid;

  SELECT *
  INTO v_message
  FROM public.auto_email_message_trackings
  WHERE open_token = v_open_token
    AND is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, 0;
    RETURN;
  END IF;

  UPDATE public.auto_email_message_trackings AS message_tracking
  SET open_count = message_tracking.open_count + 1,
      first_opened_at = COALESCE(message_tracking.first_opened_at, v_now),
      last_opened_at = v_now,
      last_open_user_agent = v_user_agent,
      updated_at = v_now
  WHERE message_tracking.id = v_message.id
  RETURNING message_tracking.* INTO v_message;

  IF v_message.campaign_detail_id IS NOT NULL THEN
    UPDATE public.auto_campaign_details
    SET status = 'đã xem'
    WHERE id = v_message.campaign_detail_id
      AND action_code = 'email_send'
      AND status = 'thành công'
      AND is_delete = false;
  END IF;

  RETURN QUERY SELECT true, v_message.id, v_message.campaign_detail_id, v_message.open_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_mark_email_click(p_click_token text, p_user_agent text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message_tracking_id bigint, link_tracking_id bigint, original_url text, click_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.auto_email_link_trackings%ROWTYPE;
  v_message public.auto_email_message_trackings%ROWTYPE;
  v_now timestamptz := now();
  v_user_agent text := NULLIF(left(COALESCE(p_user_agent, ''), 1000), '');
  v_raw_token text := trim(COALESCE(p_click_token, ''));
  v_click_token uuid;
BEGIN
  IF v_raw_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, NULL::text, 0;
    RETURN;
  END IF;

  v_click_token := v_raw_token::uuid;

  SELECT *
  INTO v_link
  FROM public.auto_email_link_trackings
  WHERE click_token = v_click_token
    AND is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, NULL::text, 0;
    RETURN;
  END IF;

  SELECT *
  INTO v_message
  FROM public.auto_email_message_trackings
  WHERE id = v_link.message_tracking_id
    AND is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, v_link.id, NULL::text, 0;
    RETURN;
  END IF;

  UPDATE public.auto_email_link_trackings AS link_tracking
  SET click_count = link_tracking.click_count + 1,
      first_clicked_at = COALESCE(link_tracking.first_clicked_at, v_now),
      last_clicked_at = v_now,
      last_click_user_agent = v_user_agent,
      updated_at = v_now
  WHERE link_tracking.id = v_link.id
  RETURNING link_tracking.* INTO v_link;

  UPDATE public.auto_email_message_trackings AS message_tracking
  SET click_count = message_tracking.click_count + 1,
      first_clicked_at = COALESCE(message_tracking.first_clicked_at, v_now),
      last_clicked_at = v_now,
      first_opened_at = COALESCE(message_tracking.first_opened_at, v_now),
      last_opened_at = COALESCE(message_tracking.last_opened_at, v_now),
      open_count = GREATEST(message_tracking.open_count, 1),
      last_click_user_agent = v_user_agent,
      updated_at = v_now
  WHERE message_tracking.id = v_message.id
  RETURNING message_tracking.* INTO v_message;

  IF v_message.campaign_detail_id IS NOT NULL THEN
    UPDATE public.auto_campaign_details
    SET status = 'đã click'
    WHERE id = v_message.campaign_detail_id
      AND action_code = 'email_send'
      AND status IN ('thành công', 'đã xem')
      AND is_delete = false;
  END IF;

  RETURN QUERY SELECT true, v_message.id, v_link.id, v_link.original_url, v_link.click_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.crm_agent_campaign_results(p_organization_ids bigint[], p_campaign_ids bigint[])
 RETURNS TABLE(campaign_id bigint, successful bigint, failed bigint, pending bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT c.id, result.successful, result.failed, queue.pending
  FROM public.auto_campaigns c
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')) AS successful,
      count(*) FILTER (WHERE d.status IN ('thất bại', 'lỗi', 'không tồn tại')) AS failed
    FROM public.auto_campaign_details d
    WHERE d.campaign_id = c.id AND d.is_delete = false
  ) result
  CROSS JOIN LATERAL (
    SELECT count(*) AS pending
    FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = c.id AND i.is_delete = false AND i.status = 'chờ xử lý'
  ) queue
  WHERE c.organization_id = ANY(p_organization_ids) AND c.id = ANY(p_campaign_ids) AND c.is_delete = false;
$function$
;
CREATE OR REPLACE FUNCTION public.crm_trial_campaign_signal_counts(p_organization_ids bigint[], p_campaign_ids bigint[])
 RETURNS TABLE(campaign_id bigint, input_total bigint, successful bigint, failed bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT c.id, inputs.input_total, result.successful, result.failed
  FROM public.auto_campaigns c
  CROSS JOIN LATERAL (
    SELECT count(*) AS input_total
    FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = c.id AND i.is_delete = false
  ) inputs
  CROSS JOIN LATERAL (
    -- Số LIÊN HỆ có ít nhất một lượt thành công / lỗi (một liên hệ có thể được gửi nhiều lượt), để tỷ lệ
    -- "đã gửi / tệp nạp" cùng nghĩa với SQL autoCampaignDetail và tracking desktop (mỗi dòng = một liên hệ).
    SELECT count(DISTINCT COALESCE(d.input_data_id, d.id)) FILTER (
             WHERE d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
           ) AS successful,
           count(DISTINCT COALESCE(d.input_data_id, d.id)) FILTER (
             WHERE d.status IN ('thất bại', 'lỗi', 'không tồn tại')
           ) AS failed
    FROM public.auto_campaign_details d
    WHERE d.campaign_id = c.id AND d.is_delete = false
  ) result
  WHERE c.organization_id = ANY(p_organization_ids) AND c.id = ANY(p_campaign_ids) AND c.is_delete = false;
$function$
;
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
      'Không tìm thấy dữ liệu SMS cần cập nhật';
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

  -- Accept the result without restoring or finalizing a deleted source.
  IF v_input.input_deleted OR v_input.campaign_deleted THEN
    RETURN QUERY SELECT
      p_input_data_id, v_input.campaign_id, v_detail_id, v_final_status,
      v_counted, false, true, NULL::text;
    RETURN;
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
$function$
;
CREATE OR REPLACE FUNCTION public.fn_opp_ctx(p_opp aka_salesopportunity)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare t record; cu record; st record; v_ctx jsonb; v_pc jsonb; v_seg text; v_state text; v_ren jsonb; v_trial date; v_ref text; v_ok bigint := 0; v_camp bigint := 0; cfg jsonb;
begin
  select * into t from public.aka_salesopportunity_type where id = p_opp.type_id;
  select name, phone, email, referrer_id, inbox_url, linh_vuc into cu from public.aka_customer where id = p_opp.customer_id;
  select name, phone into st from public.org_staff where id = p_opp.owner_org_staff_id;
  cfg := public.fn_opp_config();
  v_pc := public.fn_opp_product_context(p_opp.customer_id);
  v_trial := coalesce(p_opp.trial_start_date, public.fn_opp_trial_start(p_opp.customer_id));
  v_state := public.fn_opp_trial_state(p_opp.customer_id);
  if cu.referrer_id is not null then select name into v_ref from public.aka_customer where id = cu.referrer_id; end if;
  if t.anchor_kind = 'expiration' then
    v_ren := public.fn_opp_renewal_score(p_opp.customer_id, p_opp.anchor_date);
    v_seg := v_ren->>'group';
  elsif t.code = 'new_crm_data' then v_seg := public.fn_opp_lead_grade(p_opp.customer_id);
  elsif t.code = 'new_zalo' then
    select coalesce(c.gen_meta->>'ai_tier', c.gen_meta->>'tier') into v_seg from public.aka_crm c where c.id = p_opp.source_crm_id;
    v_seg := coalesce(v_seg, 'TRIAL');
  end if;
  -- số liệu bản thử / chiến dịch (hệ mới + cũ)
  select coalesce(sum(cnt),0), coalesce(sum(camps),0) into v_ok, v_camp from (
    select count(*) filter (where d.status in ('thành công','đã xem','đã tham gia')) cnt, count(distinct c.id) camps
      from public.auto_campaigns c join public.org_organization g on g.id=c.organization_id
      left join public.auto_campaign_details d on d.campaign_id=c.id
     where g.customer_id=p_opp.customer_id and coalesce(c.is_delete,false)=false
    union all
    select coalesce(sum(tr.status_thanh_cong),0), count(distinct tr.campaign_id)
      from public.aka_order o join public.aka_tracking_app tr on tr.account_id=o.account_id_old
     where o.customer_id=p_opp.customer_id and tr.event_timestamp >= now()-interval '60 days') x;
  v_ctx := jsonb_build_object(
    'today', public.fn_opp_today_vn(), 'trial_start', v_trial, 'state', v_state, 'segment', v_seg,
    'product_group', v_pc->>'product_group', 'package', v_pc->>'package', 'renewal', v_ren,
    'h_date', case when t.anchor_kind='expiration' then p_opp.anchor_date end,
    'has_phone', nullif(cu.phone,'') is not null, 'has_email', nullif(cu.email,'') is not null,
    'ten', coalesce(cu.name,'anh/chị'), 'san_pham', coalesce(nullif(v_pc->>'product_raw',''),'akaBiz'),
    'goi', v_pc->>'package', 'ngay_het_han', case when t.anchor_kind='expiration' then to_char(p_opp.anchor_date,'DD/MM/YYYY') end,
    'so_ngay_con', case when t.anchor_kind='expiration' then (p_opp.anchor_date - public.fn_opp_today_vn())::text end,
    'nv_ten', coalesce(st.name,''), 'nv_sdt', coalesce(st.phone,''), 'nguoi_gioi_thieu', coalesce(v_ref,''),
    'so_tin_thanh_cong', v_ok::text, 'so_chien_dich', v_camp::text, 'nganh', coalesce(cu.linh_vuc,'{nganh}'), 'inbox_url', cu.inbox_url)
    || coalesce(cfg->'placeholders', '{}'::jsonb);
  return v_ctx;
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_opp_trial_state(p_customer_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_start date; v_login boolean := false; v_camp boolean := false; v_ok boolean := false;
begin
  v_start := public.fn_opp_trial_start(p_customer_id);
  if v_start is null then return null; end if;
  -- hệ mới
  select exists (select 1 from public.auto_accounts a join public.org_organization g on g.id=a.organization_id
                  where g.customer_id=p_customer_id and coalesce(a.is_delete,false)=false) into v_login;
  select exists (select 1 from public.auto_campaigns c join public.org_organization g on g.id=c.organization_id
                  where g.customer_id=p_customer_id and coalesce(c.is_delete,false)=false) into v_camp;
  if v_camp then
    select exists (select 1 from public.auto_campaign_details d join public.auto_campaigns c on c.id=d.campaign_id
                    join public.org_organization g on g.id=c.organization_id
                   where g.customer_id=p_customer_id and d.status in ('thành công','đã xem','đã tham gia')) into v_ok;
  end if;
  -- hệ cũ
  if not v_ok then
    perform 1;
    select bool_or(t.event_type in ('login','login_app_akabiz','open_app_akabiz')) or v_login,
           bool_or(t.event_type='add' and t.campaign_id is not null) or v_camp,
           bool_or(coalesce(t.status_thanh_cong,0) > 0 or coalesce(t.status_da_xem,0) > 0) or v_ok
      into v_login, v_camp, v_ok
      from public.aka_order o join public.aka_tracking_app t on t.account_id = o.account_id_old
     where o.customer_id = p_customer_id and (coalesce(o.is_demo,false) or lower(coalesce(o.package,''))='demo')
       and t.event_timestamp >= v_start::timestamp;
  end if;
  if v_ok then return 'S3'; elsif v_camp then return 'S2'; elsif v_login then return 'S1'; else return 'S0'; end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer, p_sort text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_sort text := COALESCE(p_sort, 'created_desc');
  v_search text := NULLIF(btrim(left(p_search, 200)), '');
  v_status text := NULLIF(btrim(left(p_status, 120)), '');
  v_where text := 'd.campaign_id = $1 AND d.is_delete = false';
  v_direction text;
  v_result jsonb;
BEGIN
  -- Same credential + campaign ownership guard as the live detail provenance RPC.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0 OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_campaign_details_page';
  END IF;
  IF v_sort NOT IN ('created_asc', 'created_desc') THEN
    RAISE EXCEPTION 'invalid_campaign_details_sort';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'invalid_campaign_details_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Only fixed SQL fragments are concatenated. All user values are bound.
  -- Omitting inactive predicates avoids generic OR plans scanning wide rows.
  IF v_status IS NOT NULL THEN v_where := v_where || ' AND d.status = $2'; END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5)';
  END IF;
  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;

  -- Both keys are NOT NULL in the live schema (checked by preflight). Default
  -- NULL placement is therefore equivalent to NULLS LAST for both directions,
  -- and allows one index to support forward and backward index-only scans.
  -- MATERIALIZED limits the narrow ID set before any full-row payload lookup.
  -- Count, page IDs and payload are read by one statement / MVCC snapshot;
  -- count remains available even when the requested page has no items.
  EXECUTE format($query$
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM public.auto_campaign_details AS d
      WHERE %1$s
      ORDER BY d.created_at %2$s, d.id %2$s
      LIMIT $6 OFFSET $7
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(to_jsonb(detail) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.auto_campaign_details AS d WHERE %1$s)
    )
  $query$, v_where, v_direction)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0);
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page_v2(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer, p_sort text, p_auth_username text, p_auth_password text, p_engagement_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_sort text := COALESCE(p_sort, 'created_desc');
  v_search text := NULLIF(btrim(left(p_search, 200)), '');
  v_status text := NULLIF(btrim(left(p_status, 120)), '');
  v_where text := 'd.campaign_id = $1 AND d.is_delete = false';
  v_direction text;
  v_result jsonb;
BEGIN
  -- Same credential + campaign ownership guard as the live detail provenance RPC.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0 OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_campaign_details_page';
  END IF;
  IF v_sort NOT IN ('created_asc', 'created_desc') THEN
    RAISE EXCEPTION 'invalid_campaign_details_sort';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'invalid_campaign_details_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Only fixed SQL fragments are concatenated. All user values are bound.
  -- Omitting inactive predicates avoids generic OR plans scanning wide rows.
  IF v_status IS NOT NULL THEN v_where := v_where || ' AND d.status = $2'; END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5)';
  END IF;
  IF COALESCE(p_engagement_filter, 'all') NOT IN ('all','seen','responded','reacted','friended','none') THEN
    RAISE EXCEPTION 'invalid_engagement_filter';
  END IF;
  IF p_engagement_filter IN ('seen','responded','reacted','friended','none') THEN
    v_where := v_where || ' AND EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND ' ||
      CASE p_engagement_filter WHEN 'seen' THEN 'e.seen_at IS NOT NULL' WHEN 'responded' THEN 'e.responded_at IS NOT NULL'
        WHEN 'reacted' THEN 'e.reacted_at IS NOT NULL' WHEN 'friended' THEN 'e.friended_at IS NOT NULL'
        ELSE 'e.seen_at IS NULL AND e.responded_at IS NULL AND e.reacted_at IS NULL AND e.friended_at IS NULL' END || ')';
  END IF;
  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;

  -- Both keys are NOT NULL in the live schema (checked by preflight). Default
  -- NULL placement is therefore equivalent to NULLS LAST for both directions,
  -- and allows one index to support forward and backward index-only scans.
  -- MATERIALIZED limits the narrow ID set before any full-row payload lookup.
  -- Count, page IDs and payload are read by one statement / MVCC snapshot;
  -- count remains available even when the requested page has no items.
  EXECUTE format($query$
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM public.auto_campaign_details AS d
      WHERE %1$s
      ORDER BY d.created_at %2$s, d.id %2$s
      LIMIT $6 OFFSET $7
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg((to_jsonb(detail) || jsonb_build_object('zalo_engagement', to_jsonb(engagement), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR (account.flatform_type='zalo' AND NOT COALESCE(account.is_zalo_show_web,false)
            AND detail.status='thành công' AND detail.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
            AND detail.data->'partialSend' IS NULL))) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_campaign_detail_zalo_engagement engagement ON engagement.campaign_detail_id=page.id
        LEFT JOIN public.auto_accounts account ON account.id=detail.account_id
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.auto_campaign_details AS d WHERE %1$s)
    )
  $query$, v_where, v_direction)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0);
  RETURN v_result;
END;
$function$
;
REVOKE SELECT ON public.auto_status FROM aka_agent_chat_api;
CREATE OR REPLACE TRIGGER trg_aka_agent_enqueue_campaign_detail_automations AFTER INSERT OR UPDATE OF status, action_code, is_delete ON public.auto_campaign_details FOR EACH ROW EXECUTE FUNCTION aka_agent_enqueue_campaign_detail_automations();
CREATE OR REPLACE TRIGGER trg_aka_agent_enqueue_group_only_automations AFTER INSERT OR UPDATE OF status, action_code, is_delete ON public.auto_campaign_details FOR EACH ROW EXECUTE FUNCTION aka_agent_enqueue_group_only_automations();
COMMIT;
