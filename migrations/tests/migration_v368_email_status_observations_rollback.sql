-- Restore only these three function bodies after drift checks. Keep all historical data and schema.
-- Source: migrations/snapshots/email-status-observations-v368.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_mark_email_click(text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_mark_email_click(text,text)')))<>'9f0ec78c3127d0f48605298b5ea2c3f0' THEN RAISE EXCEPTION 'v368 function drift: aka_agent_mark_email_click(text,text)'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_mark_email_click(text,text)')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":true,"volatility":"v","settings":["search_path=public"],"acl":"{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v368 attributes drift: aka_agent_mark_email_click(text,text)'; END IF;
IF to_regprocedure('public.aka_agent_mark_email_open(text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_mark_email_open(text,text)')))<>'e13f3b6c3de915b2713965b76dbd33a7' THEN RAISE EXCEPTION 'v368 function drift: aka_agent_mark_email_open(text,text)'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_mark_email_open(text,text)')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":true,"volatility":"v","settings":["search_path=public"],"acl":"{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v368 attributes drift: aka_agent_mark_email_open(text,text)'; END IF;
IF to_regprocedure('public.aka_agent_project_linked_email_status_v366()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_project_linked_email_status_v366()')))<>'6535346b9292f2c69031bb801f5a5f68' THEN RAISE EXCEPTION 'v368 function drift: aka_agent_project_linked_email_status_v366()'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_project_linked_email_status_v366()')) IS DISTINCT FROM $attrs${"owner":"postgres","security_definer":false,"volatility":"v","settings":["search_path=pg_catalog, public"],"acl":"{postgres=X/postgres}"}$attrs$::jsonb THEN RAISE EXCEPTION 'v368 attributes drift: aka_agent_project_linked_email_status_v366()'; END IF;
END $preflight$;
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
    -- Policy-managed results keep their original main result, log, quota and
    -- report group. A later real observation only changes the secondary ID.
    UPDATE public.auto_campaign_details d
    SET sub_status_id=s.id
    FROM public.auto_status s
    WHERE d.id=v_message.campaign_detail_id AND d.action_code='email_send'
      AND d.status_id IS NOT NULL AND d.report_group='success' AND NOT d.is_delete
      AND s.code='campaign_detail_clicked' AND s.component_type='campaign_detail'
      AND d.sub_status_id IS DISTINCT FROM s.id
      ;
    UPDATE public.auto_campaign_details
    SET status = 'đã click'
    WHERE id = v_message.campaign_detail_id
      AND action_code = 'email_send'
      AND status IN ('thành công', 'đã xem')
      AND status_id IS NULL
      AND is_delete = false;
  END IF;

  RETURN QUERY SELECT true, v_message.id, v_link.id, v_link.original_url, v_link.click_count;
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
    -- Policy-managed results keep their original main result, log, quota and
    -- report group. A later real observation only changes the secondary ID.
    UPDATE public.auto_campaign_details d
    SET sub_status_id=s.id
    FROM public.auto_status s
    WHERE d.id=v_message.campaign_detail_id AND d.action_code='email_send'
      AND d.status_id IS NOT NULL AND d.report_group='success' AND NOT d.is_delete
      AND s.code='campaign_detail_viewed' AND s.component_type='campaign_detail'
      AND d.sub_status_id IS DISTINCT FROM s.id
      AND NOT EXISTS (SELECT 1 FROM public.auto_status old WHERE old.id=d.sub_status_id AND old.code='campaign_detail_clicked');
    UPDATE public.auto_campaign_details
    SET status = 'đã xem'
    WHERE id = v_message.campaign_detail_id
      AND action_code = 'email_send'
      AND status = 'thành công'
      AND status_id IS NULL
      AND is_delete = false;
  END IF;

  RETURN QUERY SELECT true, v_message.id, v_message.campaign_detail_id, v_message.open_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_project_linked_email_status_v366()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Linking holds the tracking row lock. Callbacks take that same lock before
  -- touching the detail, so neither ordering can lose an early observation.
  IF NEW.is_delete OR NEW.campaign_detail_id IS NULL OR (NEW.open_count <= 0 AND NEW.click_count <= 0) THEN RETURN NEW; END IF;
  UPDATE public.auto_campaign_details d SET sub_status_id=s.id
  FROM public.auto_status s
  WHERE d.id=NEW.campaign_detail_id AND d.campaign_id=NEW.campaign_id
    AND d.account_id IS NOT DISTINCT FROM NEW.account_id
    AND d.input_data_id IS NOT DISTINCT FROM NEW.input_data_id
    AND d.action_code='email_send' AND d.status_id IS NOT NULL
    AND d.report_group='success' AND NOT d.is_delete
    AND s.code=CASE WHEN NEW.click_count>0 THEN 'campaign_detail_clicked' ELSE 'campaign_detail_viewed' END
    AND s.component_type='campaign_detail'
    AND d.sub_status_id IS DISTINCT FROM s.id
    AND (NEW.click_count>0 OR NOT EXISTS (
      SELECT 1 FROM public.auto_status prior WHERE prior.id=d.sub_status_id AND prior.code='campaign_detail_clicked'));
  RETURN NEW;
END
$function$
;
-- Signatures/ACL/schema unchanged. No additional schema-cache notification.
COMMIT;
