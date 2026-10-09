-- Captured live definitions: migrations/snapshots/action-status-compatibility-v367.
-- Build the committed-delivery partial index CONCURRENTLY before applying.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_enqueue_campaign_detail_automations()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_enqueue_campaign_detail_automations()')))<>'9858143987af45606d6da1ba5ea4dbb4' THEN RAISE EXCEPTION 'v367 function drift: aka_agent_enqueue_campaign_detail_automations()'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_enqueue_campaign_detail_automations()')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":true,"volatility":"v","settings":["search_path=pg_catalog, public"],"acl":"{postgres=X/postgres,service_role=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v367 attributes drift: aka_agent_enqueue_campaign_detail_automations()'; END IF;
IF to_regprocedure('public.aka_agent_enqueue_group_only_automations()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_enqueue_group_only_automations()')))<>'8e520c75e512e99aeba552e4792d873d' THEN RAISE EXCEPTION 'v367 function drift: aka_agent_enqueue_group_only_automations()'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_enqueue_group_only_automations()')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":true,"volatility":"v","settings":["search_path=pg_catalog, public"],"acl":"{postgres=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v367 attributes drift: aka_agent_enqueue_group_only_automations()'; END IF;
IF to_regprocedure('public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)')))<>'58d02e6696fa3f89cda13cea288df876' THEN RAISE EXCEPTION 'v367 function drift: aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":true,"volatility":"s","settings":["search_path=pg_catalog, public"],"acl":"{postgres=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v367 attributes drift: aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)'; END IF;
IF to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)')))<>'10faa8adcee8daef16c7a9b60aca5d97' THEN RAISE EXCEPTION 'v367 function drift: aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":true,"volatility":"s","settings":["search_path=pg_catalog, public","statement_timeout=60s"],"acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v367 attributes drift: aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)')))<>'593cdd93a81e86d37ce026465550d4f9' THEN RAISE EXCEPTION 'v367 function drift: aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":true,"volatility":"s","settings":["search_path=pg_catalog, public","statement_timeout=60s"],"acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v367 attributes drift: aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.auto_detail_committed_delivery_v367') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)='CREATE INDEX auto_detail_committed_delivery_v367 ON public.auto_campaign_details USING btree (account_id, action_code, created_at DESC, input_data_id) WHERE ((policy_snapshot ->> ''operationState''::text) = ''committed''::text)') THEN RAISE EXCEPTION 'v367 committed delivery index required'; END IF;
END $preflight$;
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
  v_observed_status text;
  v_old_observed_status text;
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
    AND NEW.sub_status_id IS NOT DISTINCT FROM OLD.sub_status_id
    AND NOT v_is_reconcile THEN
    RETURN NEW;
  END IF;

  -- Preserve old Email/SMS main-only conditions without changing saved rules
  -- or historical details. Explicit secondary filters keep their exact meaning.
  IF NEW.action_code IN ('email_send','sms_send') AND NEW.status_id IS NOT NULL AND NEW.sub_status_id IS NOT NULL THEN
    SELECT CASE WHEN NEW.status_id IS NOT NULL THEN CASE NEW.action_code
          WHEN 'email_send' THEN CASE s.code WHEN 'campaign_detail_viewed' THEN 'đã xem' WHEN 'campaign_detail_clicked' THEN 'đã click' END
          WHEN 'sms_send' THEN CASE s.code WHEN 'campaign_detail_sent' THEN 'đã gửi' WHEN 'campaign_detail_received' THEN 'đã nhận' WHEN 'campaign_detail_failed' THEN 'thất bại' END
        END END INTO v_observed_status
    FROM public.auto_status s WHERE s.id=NEW.sub_status_id AND s.component_type='campaign_detail';
  END IF;
  IF TG_OP='UPDATE' AND OLD.action_code IN ('email_send','sms_send') AND OLD.status_id IS NOT NULL AND OLD.sub_status_id IS NOT NULL THEN
    SELECT CASE WHEN OLD.status_id IS NOT NULL THEN CASE OLD.action_code
          WHEN 'email_send' THEN CASE s.code WHEN 'campaign_detail_viewed' THEN 'đã xem' WHEN 'campaign_detail_clicked' THEN 'đã click' END
          WHEN 'sms_send' THEN CASE s.code WHEN 'campaign_detail_sent' THEN 'đã gửi' WHEN 'campaign_detail_received' THEN 'đã nhận' WHEN 'campaign_detail_failed' THEN 'thất bại' END
        END END INTO v_old_observed_status
    FROM public.auto_status s WHERE s.id=OLD.sub_status_id AND s.component_type='campaign_detail';
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
      AND ((NEW.status_id IS NOT NULL AND status_catalog.id=NEW.status_id)
        OR (NEW.status_id IS NULL AND (status_catalog.status_value=NEW.status
          OR (status_catalog.status_value IS NULL AND lower(status_catalog.name)=lower(NEW.status)))))
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
        AND ((
          lower(trigger_status.status_value) = lower(NEW.status)
        AND (trigger_status.sub_status_ids IS NULL OR NEW.sub_status_id=ANY(trigger_status.sub_status_ids))
        -- A secondary observation only wakes rules whose full condition has
        -- just become true. Preserve the existing failed-enqueue reconciliation.
        AND (TG_OP<>'UPDATE' OR v_is_reconcile OR (
          trigger_status.sub_status_ids IS NULL AND (
            NEW.status IS DISTINCT FROM OLD.status OR NEW.action_code IS DISTINCT FROM OLD.action_code
            OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
          )
        ) OR (
          trigger_status.sub_status_ids IS NOT NULL AND NOT COALESCE(
            NOT COALESCE(OLD.is_delete,false)
            AND lower(trigger_status.status_value)=lower(OLD.status)
            AND (trigger_status.action_code IS NULL OR trigger_status.action_code IS NOT DISTINCT FROM OLD.action_code)
            AND OLD.sub_status_id=ANY(trigger_status.sub_status_ids),false
          )
        ))
        ) OR (
          trigger_status.sub_status_ids IS NULL
          AND v_observed_status IS NOT NULL
          AND lower(trigger_status.status_value)=v_observed_status
          AND (TG_OP<>'UPDATE' OR v_is_reconcile OR NOT COALESCE(
            NOT COALESCE(OLD.is_delete,false)
            AND (trigger_status.action_code IS NULL OR trigger_status.action_code IS NOT DISTINCT FROM OLD.action_code)
            AND (lower(trigger_status.status_value)=lower(OLD.status)
              OR lower(trigger_status.status_value)=v_old_observed_status),false))
        ))
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
  v_observed_status text;
  v_old_observed_status text;
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
    AND NEW.sub_status_id IS NOT DISTINCT FROM OLD.sub_status_id
    AND NOT v_is_reconcile
  THEN
    RETURN NEW;
  END IF;

  -- Preserve old Email/SMS main-only conditions without changing saved rules
  -- or historical details. Explicit secondary filters keep their exact meaning.
  IF NEW.action_code IN ('email_send','sms_send') AND NEW.status_id IS NOT NULL AND NEW.sub_status_id IS NOT NULL THEN
    SELECT CASE WHEN NEW.status_id IS NOT NULL THEN CASE NEW.action_code
          WHEN 'email_send' THEN CASE s.code WHEN 'campaign_detail_viewed' THEN 'đã xem' WHEN 'campaign_detail_clicked' THEN 'đã click' END
          WHEN 'sms_send' THEN CASE s.code WHEN 'campaign_detail_sent' THEN 'đã gửi' WHEN 'campaign_detail_received' THEN 'đã nhận' WHEN 'campaign_detail_failed' THEN 'thất bại' END
        END END INTO v_observed_status
    FROM public.auto_status s WHERE s.id=NEW.sub_status_id AND s.component_type='campaign_detail';
  END IF;
  IF TG_OP='UPDATE' AND OLD.action_code IN ('email_send','sms_send') AND OLD.status_id IS NOT NULL AND OLD.sub_status_id IS NOT NULL THEN
    SELECT CASE WHEN OLD.status_id IS NOT NULL THEN CASE OLD.action_code
          WHEN 'email_send' THEN CASE s.code WHEN 'campaign_detail_viewed' THEN 'đã xem' WHEN 'campaign_detail_clicked' THEN 'đã click' END
          WHEN 'sms_send' THEN CASE s.code WHEN 'campaign_detail_sent' THEN 'đã gửi' WHEN 'campaign_detail_received' THEN 'đã nhận' WHEN 'campaign_detail_failed' THEN 'thất bại' END
        END END INTO v_old_observed_status
    FROM public.auto_status s WHERE s.id=OLD.sub_status_id AND s.component_type='campaign_detail';
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
        AND ((
          lower(trigger_status.status_value) = lower(NEW.status)
        AND (trigger_status.sub_status_ids IS NULL OR NEW.sub_status_id=ANY(trigger_status.sub_status_ids))
        -- A secondary observation only wakes rules whose full condition has
        -- just become true. Preserve the existing failed-enqueue reconciliation.
        AND (TG_OP<>'UPDATE' OR v_is_reconcile OR (
          trigger_status.sub_status_ids IS NULL AND (
            NEW.status IS DISTINCT FROM OLD.status OR NEW.action_code IS DISTINCT FROM OLD.action_code
            OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
          )
        ) OR (
          trigger_status.sub_status_ids IS NOT NULL AND NOT COALESCE(
            NOT COALESCE(OLD.is_delete,false)
            AND lower(trigger_status.status_value)=lower(OLD.status)
            AND (trigger_status.action_code IS NULL OR trigger_status.action_code IS NOT DISTINCT FROM OLD.action_code)
            AND OLD.sub_status_id=ANY(trigger_status.sub_status_ids),false
          )
        ))
        ) OR (
          trigger_status.sub_status_ids IS NULL
          AND v_observed_status IS NOT NULL
          AND lower(trigger_status.status_value)=v_observed_status
          AND (TG_OP<>'UPDATE' OR v_is_reconcile OR NOT COALESCE(
            NOT COALESCE(OLD.is_delete,false)
            AND (trigger_status.action_code IS NULL OR trigger_status.action_code IS NOT DISTINCT FROM OLD.action_code)
            AND (lower(trigger_status.status_value)=lower(OLD.status)
              OR lower(trigger_status.status_value)=v_old_observed_status),false))
        ))
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

CREATE OR REPLACE FUNCTION public.aka_agent_internal_send_delivery_history(p_account_id bigint, p_action_codes text[], p_since timestamp with time zone, p_now timestamp with time zone)
 RETURNS TABLE(detail_id bigint, created_at timestamp with time zone, campaign_id bigint, campaign_name text, target_keys text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT
      d.id AS detail_id,
      d.created_at,
      d.campaign_id,
      c.name AS campaign_name,
      public.aka_agent_internal_delivery_cooldown_target_keys(
        CASE d.action_code
          WHEN 'fb_post_group' THEN 'facebook_group'
          WHEN 'fb_post_page' THEN 'facebook_page'
          WHEN 'fb_message_friend' THEN 'facebook_person'
          WHEN 'fb_message_stranger' THEN 'facebook_person'
          WHEN 'fb_message_page_inbox_customer' THEN 'facebook_page_inbox'
          WHEN 'zalo_message_friend' THEN 'zalo_person'
          WHEN 'zalo_message_stranger' THEN 'zalo_person'
          WHEN 'zalo_message_group' THEN 'zalo_group'
          WHEN 'sms_send' THEN 'phone'
          WHEN 'email_send' THEN 'email'
          ELSE ''
        END,
        source_input.uid,
        source_input.phone,
        source_input.email
      ) AS target_keys
    FROM (
      -- Disjoint branches retain the existing legacy partial-index path.
      -- Evidence wins over names/report groups, including partial deliveries.
      SELECT id,created_at,campaign_id,input_data_id,action_code
      FROM public.auto_campaign_details
      WHERE account_id=p_account_id AND action_code=ANY(p_action_codes)
        AND created_at>=p_since AND created_at<=p_now
        AND policy_snapshot->>'operationState'='committed'
      UNION ALL
      SELECT id,created_at,campaign_id,input_data_id,action_code
      FROM public.auto_campaign_details
      WHERE account_id=p_account_id AND action_code=ANY(p_action_codes)
        AND created_at>=p_since AND created_at<=p_now
        AND policy_snapshot->>'operationState' IS NULL
        AND status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
    ) AS d
    JOIN public.auto_campaign_input_data AS source_input ON source_input.id = d.input_data_id
    LEFT JOIN public.auto_campaigns AS c ON c.id = d.campaign_id

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
  IF v_status IS NOT NULL THEN
    v_where := v_where || ' AND (d.status = $2 OR EXISTS (
      SELECT 1 FROM public.auto_status filter_status
      WHERE filter_status.id IN (d.status_id,d.sub_status_id)
        AND (filter_status.status_value=$2 OR lower(filter_status.name)=lower($2))))';
  END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5
      OR EXISTS (SELECT 1 FROM public.auto_status search_status
        WHERE search_status.id IN (d.status_id,d.sub_status_id)
          AND (search_status.name ILIKE $5 OR search_status.status_value ILIKE $5)))';
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
        SELECT jsonb_agg(((to_jsonb(detail) || jsonb_build_object(
          'status_presentation', CASE WHEN main_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',main_status.code,'name',main_status.name,'color',main_status.color,'statusValue',main_status.status_value) END,
          'sub_status_presentation', CASE WHEN sub_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',sub_status.code,'name',sub_status.name,'color',sub_status.color,'statusValue',sub_status.status_value) END)) || jsonb_build_object('zalo_engagement', to_jsonb(engagement), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR (account.flatform_type='zalo' AND NOT COALESCE(account.is_zalo_show_web,false)
            AND detail.status='thành công' AND detail.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
            AND detail.data->'partialSend' IS NULL))) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_status main_status ON main_status.id=detail.status_id
        LEFT JOIN public.auto_status sub_status ON sub_status.id=detail.sub_status_id
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
  IF v_status IS NOT NULL THEN
    v_where := v_where || ' AND (d.status = $2 OR EXISTS (
      SELECT 1 FROM public.auto_status filter_status
      WHERE filter_status.id IN (d.status_id,d.sub_status_id)
        AND (filter_status.status_value=$2 OR lower(filter_status.name)=lower($2))))';
  END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5
      OR EXISTS (SELECT 1 FROM public.auto_status search_status
        WHERE search_status.id IN (d.status_id,d.sub_status_id)
          AND (search_status.name ILIKE $5 OR search_status.status_value ILIKE $5)))';
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
        SELECT jsonb_agg((to_jsonb(detail) || jsonb_build_object(
          'status_presentation', CASE WHEN main_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',main_status.code,'name',main_status.name,'color',main_status.color,'statusValue',main_status.status_value) END,
          'sub_status_presentation', CASE WHEN sub_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',sub_status.code,'name',sub_status.name,'color',sub_status.color,'statusValue',sub_status.status_value) END)) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_status main_status ON main_status.id=detail.status_id
        LEFT JOIN public.auto_status sub_status ON sub_status.id=detail.sub_status_id
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
-- No explicit reload: the existing DDL event trigger may notify PostgREST.
COMMIT;
