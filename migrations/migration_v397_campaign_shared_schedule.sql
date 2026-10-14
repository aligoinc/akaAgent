-- V397: shared dispatch schedule policy; RPC signatures, legacy behavior and ownership are unchanged.
-- Built only from the captured live definitions in snapshots/campaign-shared-schedule-v397.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF to_regprocedure('public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)'))) IS DISTINCT FROM '015ca302742b88e140913a978c0156b5' THEN RAISE EXCEPTION 'v397 source drift: public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)'; END IF;
 IF to_regprocedure('public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'))) IS DISTINCT FROM 'ece8bf67bdf300722e17b7d1cf6b99f4' THEN RAISE EXCEPTION 'v397 source drift: public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'; END IF;
 IF to_regprocedure('private.campaign_dispatch_schedule_allowed(timestamp with time zone,text,timestamp with time zone,time without time zone,timestamp with time zone,boolean)') IS NOT NULL THEN RAISE EXCEPTION 'v397 helper already exists'; END IF;
END $preflight$;

CREATE FUNCTION private.campaign_dispatch_schedule_allowed(
  p_schedule timestamptz,
  p_source_mode text,
  p_schedule_end_date timestamptz,
  p_daily_stop_time time,
  p_now timestamptz,
  p_legacy_cutoff boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path TO pg_catalog
AS $function$
  SELECT p_schedule IS NOT NULL AND p_schedule <= p_now
    AND (p_source_mode IS DISTINCT FROM 'data_group'
      OR p_schedule_end_date IS NULL OR p_schedule_end_date > p_now)
    AND CASE WHEN p_legacy_cutoff THEN
      -- Preserve the checked/legacy RPC's strict cutoff and nullable stop time.
      -- The v2 wrapper still enforces its inclusive 23:59/day boundary itself.
      p_daily_stop_time IS NULL OR timezone('Asia/Ho_Chi_Minh', p_now)::time <= p_daily_stop_time
    ELSE
      timezone('Asia/Ho_Chi_Minh', p_now)::time < least(coalesce(p_daily_stop_time, time '23:59'), time '23:59')
    END
$function$;
REVOKE ALL ON FUNCTION private.campaign_dispatch_schedule_allowed(timestamptz,text,timestamptz,time,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.campaign_dispatch_schedule_allowed(timestamptz,text,timestamptz,time,timestamptz,boolean) TO anon,authenticated,service_role,aka_agent_chat_api;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_runtime_checked(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_zalo boolean;
  v_is_web boolean;
  v_is_server boolean;
  v_zalo_web_max integer;
  v_facebook_max integer;
  v_max integer;
  v_running bigint;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id, staff.max_running_zalo_web_accounts, staff.max_running_facebook_accounts
  INTO v_organization_id, v_zalo_web_max, v_facebook_max
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Serialize only admission, never the duration of a campaign. Staff SHARE
  -- above also fences settings SAVE's staff UPDATE lock. Keep this before
  -- campaign/account row locks and after the existing entitlement barrier.
  IF v_runtime_target = 'desktop' AND (v_zalo_web_max IS NOT NULL OR v_facebook_max IS NOT NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || p_staff_id::text, 0));
  END IF;

  -- Server hard-end cleanup must start before the ordinary campaign/account
  -- claim locks. Candidate discovery uses only caller-readable campaign and
  -- account rows; the SECURITY DEFINER wrapper authoritatively revalidates the
  -- RPC-only Data Group source after joining the common input-first barrier.
  IF v_runtime_target = 'server'
    AND COALESCE(v_capabilities.qr_enabled, false)
    AND COALESCE(v_capabilities.server_enabled, false)
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = campaign.staff_id
      WHERE campaign.id = p_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.account_id = p_account_id
        AND campaign.organization_id = v_organization_id
        AND campaign.data_target_source_mode = 'data_group'
        AND campaign.action_id IN (
          'zalo_message_phone',
          'zalo_join_group_link',
          'zalo_message_friend',
          'zalo_message_group_member',
          'zalo_message_remarketing_customer',
          'zalo_message_group',
          'zalo_add_group_member'
        )
        AND campaign.schedule_end_date IS NOT NULL
        AND campaign.schedule_end_date <= now()
        AND (
          account.organization_id IS NULL
          OR account.organization_id = v_organization_id
        )
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
    )
  THEN
    BEGIN
      PERFORM public.aka_agent_finalize_zalo_server_data_group_campaign(
        p_staff_id,
        v_organization_id,
        v_capabilities.capability_revision,
        p_campaign_id,
        'Chiến dịch đã hết hạn'
      );
    EXCEPTION
      -- The source, campaign or account subtype can change after optimistic
      -- candidate discovery. Those expected races are a rejected
      -- claim, not a scheduler error; the authoritative sweep handles any
      -- remaining hard-end cleanup on its next pass.
      WHEN raise_exception THEN
        IF SQLERRM NOT IN (
          'data_group_server_campaign_not_found',
          'data_group_server_runtime_not_owner'
        ) THEN
          RAISE;
        END IF;
    END;
    RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN;
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  -- V387: old/ordinary clients cannot claim a random account. The wrapper's
  -- transaction-local turn ID must name the first pending turn of this day.
  IF v_account.flatform_type='facebook' AND v_account.facebook_random_run_enabled THEN
    IF NOT private.facebook_random_claim_allowed(p_campaign_id,p_account_id,current_setting('aka.facebook_random_turn',true)) THEN RETURN QUERY SELECT false,'random_context_required'::text; RETURN; END IF;
  ELSIF nullif(current_setting('aka.facebook_random_turn',true),'') IS NOT NULL THEN
    RETURN QUERY SELECT false,'random_mode_changed'::text; RETURN;
  END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;
  ELSIF v_is_zalo AND (
    v_is_server
    OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
    OR (NOT v_is_web AND NOT v_is_server
      AND NOT COALESCE(v_capabilities.qr_enabled, false))
  ) THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  IF NOT private.campaign_dispatch_schedule_allowed(
    v_campaign.schedule, v_campaign.data_target_source_mode,
    v_campaign.schedule_end_date, v_campaign.daily_stop_time, now(), true
  ) THEN
    -- Shared with random planning; retain the legacy cutoff contract and locks.
    -- The tenant sweep, not this eligibility check, finalizes hard-ended sources.
    RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN;
  END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready'
    OR (
      v_campaign.data_target_source_mode = 'data_group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý'
          AND (input_data.schedule IS NULL OR input_data.schedule <= now())
      )
    )
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  v_max := CASE
    WHEN lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'facebook' THEN v_facebook_max
    WHEN v_is_zalo AND v_is_web AND NOT v_is_server THEN v_zalo_web_max
    ELSE NULL END;
  IF v_runtime_target = 'desktop' AND v_max IS NOT NULL THEN
    -- Status is enough for legacy clients; immutable claim/unit metadata also
    -- keeps a paused or draining run counted until its existing cleanup wins.
    -- Never filter live ownership by login/active/deleted flags. Account-only
    -- operations (login, scans) do not create a campaign and consume no slot.
    SELECT count(DISTINCT campaign.account_id) INTO v_running
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      AND account.staff_id = campaign.staff_id
    WHERE campaign.staff_id = p_staff_id
      AND account.id <> p_account_id
      AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
      AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
      AND (campaign.status = 'đang chạy' OR campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)
      AND CASE WHEN v_is_zalo THEN
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND account.is_zalo_show_web = true AND account.is_zalo_server = false
        ELSE lower(btrim(COALESCE(account.flatform_type, ''))) = 'facebook' END;
    IF v_running >= v_max THEN
      RETURN QUERY SELECT false, 'concurrency_limit_reached'::text; RETURN;
    END IF;
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN QUERY SELECT true, 'claimed'::text; RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_facebook_random_run(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_account_id bigint, p_operation text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE a public.auto_accounts%ROWTYPE; d public.auto_account_random_run_days%ROWTYPE;
 cfg jsonb; rev integer; rule jsonb; choice jsonb; turns jsonb; t jsonb; result jsonb; c record;
 day date:=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
 idx integer; round_no integer; row_no integer; total integer; page integer; claim uuid; turn_id uuid;
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_operation NOT IN ('get','save','toggle','dates','day','plan','claim','finish','progress') THEN RAISE EXCEPTION 'random_invalid_operation'; END IF;
 SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='facebook' AND NOT is_delete;
 IF NOT FOUND THEN RAISE EXCEPTION 'random_account_not_found'; END IF;
 -- Runtime claim must acquire staff/admission/campaign/account locks through v2 first.
 IF p_operation='claim' THEN
   claim:=(p_input->>'claimToken')::uuid;turn_id:=(p_input->>'turnId')::uuid;
   PERFORM set_config('aka.facebook_random_turn',turn_id::text,true);
   SELECT to_jsonb(r) INTO result FROM public.aka_agent_claim_campaign_runtime_v2((p_input->>'campaignId')::bigint,p_account_id,p_staff_id,'desktop',claim) r;
   PERFORM set_config('aka.facebook_random_turn','',true);
   IF (result->>'ok')::boolean THEN
     -- Existing exact-token retry is retained even after stop or midnight.
     SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND run_date=(result->>'runtime_claim_vietnam_date')::date FOR UPDATE;
     SELECT x INTO t FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'id'=turn_id::text AND (x->>'campaignId')::bigint=(p_input->>'campaignId')::bigint;
     IF t IS NULL OR (t->>'status'<>'planned' AND NOT(t->>'status'='running' AND t->>'claimToken'=claim::text)) THEN RAISE EXCEPTION 'random_turn_claim_mismatch'; END IF;
     UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,ARRAY['turns',((t->>'order')::int-1)::text],
       t||jsonb_build_object('status','running','claimToken',claim,'startedAt',coalesce(t->'startedAt',result->'runtime_claimed_at'))),updated_at=clock_timestamp() WHERE id=d.id;
   END IF;
   RETURN result;
 END IF;
 IF p_operation IN ('save','toggle','plan','finish') THEN
   PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE;
   SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND NOT is_delete FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'random_account_not_found'; END IF;
 END IF;
 cfg:=a.facebook_random_run_config; rev:=coalesce((cfg->>'revision')::int,0);
 IF p_operation='save' THEN
   cfg:=p_input->'config';
   IF (cfg->>'revision')::int IS DISTINCT FROM rev THEN RAISE EXCEPTION 'random_config_conflict'; END IF;
   IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR cfg->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(cfg->'rules') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'random_invalid_config'; END IF;
   IF jsonb_array_length(cfg->'rules') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'random_invalid_rules'; END IF;
   FOR rule IN SELECT x FROM jsonb_array_elements(cfg->'rules') x LOOP
     IF jsonb_typeof(rule) IS DISTINCT FROM 'object' OR jsonb_typeof(rule->'quantity') IS DISTINCT FROM 'number'
       OR coalesce(rule->>'quantity','') !~ '^[1-9][0-9]*$' OR (rule->>'quantity')::numeric>2147483647
       OR rule->>'unit' IS DISTINCT FROM (CASE rule->>'campaignActionId' WHEN 'facebook_timeline_post' THEN 'run' WHEN 'facebook_newsfeed_interaction' THEN 'minute' ELSE 'data' END)
       OR (rule->>'campaignActionId'='facebook_timeline_post' AND rule->>'quantity'<>'1')
       OR NOT EXISTS(SELECT 1 FROM public.auto_campaign_actions ca WHERE ca.id=rule->>'campaignActionId' AND ca.flatform_type='facebook' AND ca.is_active AND NOT ca.is_delete)
     THEN RAISE EXCEPTION 'random_invalid_rule'; END IF;
   END LOOP;
   cfg:=jsonb_build_object('version',1,'revision',rev+1,'rules',cfg->'rules');
   UPDATE public.auto_accounts SET facebook_random_run_config=cfg,updated_at=clock_timestamp() WHERE id=p_account_id;
 ELSIF p_operation='toggle' THEN
   IF (p_input->>'revision')::int IS DISTINCT FROM rev THEN RAISE EXCEPTION 'random_config_conflict'; END IF;
   IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'random_invalid_enabled'; END IF;
   IF (p_input->>'enabled')::boolean AND cfg IS NULL THEN RAISE EXCEPTION 'random_rules_required'; END IF;
   a.facebook_random_run_enabled:=(p_input->>'enabled')::boolean;
   UPDATE public.auto_accounts SET facebook_random_run_enabled=a.facebook_random_run_enabled,updated_at=clock_timestamp() WHERE id=p_account_id;
   IF NOT a.facebook_random_run_enabled THEN
     UPDATE public.auto_account_random_run_days dd SET state=jsonb_set(state,'{turns}',(
       SELECT jsonb_agg(CASE WHEN x->>'status'='planned' THEN x||jsonb_build_object('status','skipped','reason','Đã dừng chạy ngẫu nhiên','endedAt',clock_timestamp()) ELSE x END ORDER BY n)
       FROM jsonb_array_elements(dd.state->'turns') WITH ORDINALITY q(x,n))),updated_at=clock_timestamp()
     WHERE dd.account_id=p_account_id AND dd.status='open';
   END IF;
 END IF;
 IF p_operation IN ('get','save','toggle') THEN RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg); END IF;
 IF p_operation='dates' THEN
   RETURN coalesce((SELECT jsonb_agg(run_date ORDER BY run_date DESC) FROM (SELECT run_date FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND (p_input->>'before' IS NULL OR run_date<(p_input->>'before')::date) ORDER BY run_date DESC LIMIT 100) q),'[]');
 END IF;
 IF p_operation='day' THEN
   day:=(p_input->>'date')::date;page:=greatest(1,least(1000000,coalesce((p_input->>'page')::int,1)));
   SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND run_date=day;
   SELECT count(*)::int INTO total FROM jsonb_array_elements(coalesce(d.state->'turns','[]')) x WHERE p_input->>'campaignId' IS NULL OR x->>'campaignId'=p_input->>'campaignId';
   SELECT coalesce(jsonb_agg(x ORDER BY n),'[]') INTO turns FROM (
     SELECT (x-'claimToken'-'unitToken'-'lastUnitToken')||CASE WHEN x->>'status'='running' AND x->>'unit'='minute' AND x->>'unitStartedAt' IS NOT NULL
       THEN jsonb_build_object('elapsedSeconds',least((x->>'quantity')::bigint*60,greatest(0,floor(extract(epoch FROM clock_timestamp()-(x->>'unitStartedAt')::timestamptz))))) ELSE '{}'::jsonb END x,n
     FROM jsonb_array_elements(coalesce(d.state->'turns','[]')) WITH ORDINALITY q(x,n)
     WHERE p_input->>'campaignId' IS NULL OR x->>'campaignId'=p_input->>'campaignId' ORDER BY n LIMIT 100 OFFSET (page-1)*100) q;
   RETURN jsonb_build_object('accountId',p_account_id,'date',day,'status',coalesce(d.status,'open'),'turns',turns,'total',total,'page',page);
 END IF;
 IF p_operation='progress' THEN
   SELECT x INTO t FROM public.auto_account_random_run_days dd, jsonb_array_elements(dd.state->'turns') x
   WHERE dd.account_id=p_account_id AND dd.status='open' AND x->>'claimToken'=p_input->>'claimToken' AND x->>'id'=p_input->>'turnId';
   IF t IS NULL THEN
     SELECT x INTO t FROM public.auto_account_random_run_days dd,jsonb_array_elements(dd.state->'turns') x
     WHERE dd.account_id=p_account_id AND dd.status='closed' AND x->>'claimToken'=p_input->>'claimToken' AND x->>'id'=p_input->>'turnId';
   END IF;
   IF t IS NULL THEN RAISE EXCEPTION 'random_turn_not_found'; END IF;
   RETURN t;
 END IF;
 IF p_operation='finish' THEN
   SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND status='open'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'turns') x WHERE x->>'id'=p_input->>'turnId') FOR UPDATE;
   IF NOT FOUND THEN
     SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND status='closed'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'turns') x WHERE x->>'id'=p_input->>'turnId') FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'random_turn_not_found'; END IF;
   END IF;
   SELECT x INTO t FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'id'=p_input->>'turnId';
   IF t->>'status' NOT IN ('planned','running') THEN RETURN t; END IF;
   IF t->>'claimToken' IS DISTINCT FROM p_input->>'claimToken' THEN RAISE EXCEPTION 'random_turn_not_owner'; END IF;
   IF EXISTS(SELECT 1 FROM public.auto_campaigns cc WHERE cc.account_id=p_account_id AND (cc.runtime_unit_token IS NOT NULL OR cc.runtime_claim_token IS NOT NULL OR cc.status='đang chạy')) THEN RAISE EXCEPTION 'random_runtime_still_owned'; END IF;
   t:=t||jsonb_build_object('status',CASE WHEN t->>'status'='planned' THEN 'skipped' WHEN p_input->>'reason' IS NOT NULL THEN 'stopped' ELSE 'completed' END,'reason',p_input->>'reason','endedAt',clock_timestamp());
   UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,ARRAY['turns',((t->>'order')::int-1)::text],t),updated_at=clock_timestamp() WHERE id=d.id;
   IF d.run_date<day THEN
     UPDATE public.auto_account_random_run_days dd SET status='closed',state=jsonb_set(state,'{turns}',(
       SELECT jsonb_agg(CASE WHEN x->>'status'='planned' THEN x||jsonb_build_object('status','expired','reason','Hết ngày','endedAt',clock_timestamp()) ELSE x END ORDER BY n)
       FROM jsonb_array_elements(dd.state->'turns') WITH ORDINALITY q(x,n))) WHERE dd.id=d.id;
   END IF;
   RETURN t;
 END IF;
 -- Plan/recovery does not clear runtime ownership; wait until existing recovery/drain has done so.
 IF EXISTS(SELECT 1 FROM public.auto_campaigns cc WHERE cc.account_id=p_account_id AND (cc.runtime_unit_token IS NOT NULL OR cc.runtime_claim_token IS NOT NULL OR cc.status='đang chạy')) THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns','[]'::jsonb);
 END IF;
 FOR d IN SELECT * FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND status='open' ORDER BY run_date FOR UPDATE LOOP
   SELECT coalesce(jsonb_agg(CASE WHEN x->>'status'='planned' AND (d.run_date<day OR (x->>'revision')::int<>rev OR NOT a.facebook_random_run_enabled) THEN x||jsonb_build_object('status',CASE WHEN d.run_date<day THEN 'expired' ELSE 'skipped' END,'reason',CASE WHEN d.run_date<day THEN 'Hết ngày' WHEN NOT a.facebook_random_run_enabled THEN 'Đã dừng chạy ngẫu nhiên' ELSE 'Cấu hình đã thay đổi' END,'endedAt',clock_timestamp()) ELSE x END ORDER BY n),'[]') INTO turns
   FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY q(x,n);
   UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,'{turns}',turns),status=CASE WHEN d.run_date<day AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(turns) x WHERE x->>'status'='running') THEN 'closed' ELSE 'open' END,updated_at=clock_timestamp() WHERE id=d.id;
 END LOOP;
 SELECT * INTO d FROM public.auto_account_random_run_days WHERE account_id=p_account_id AND run_date=day;
 SELECT coalesce(jsonb_agg(x ORDER BY n),'[]') INTO turns FROM jsonb_array_elements(coalesce(d.state->'turns','[]')) WITH ORDINALITY q(x,n) WHERE x->>'status'='planned';
 IF EXISTS(SELECT 1 FROM public.auto_account_random_run_days dd,jsonb_array_elements(dd.state->'turns') x WHERE dd.account_id=p_account_id AND dd.status='open' AND x->>'status'='running') THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns','[]'::jsonb);
 END IF;
 IF jsonb_array_length(turns)>0 OR NOT a.facebook_random_run_enabled OR cfg IS NULL OR (p_input->>'revision')::int IS DISTINCT FROM rev THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns',turns);
 END IF;
 IF a.status<>'chờ xử lý' OR NOT a.is_active OR a.login_status<>'đã đăng nhập' OR timezone('Asia/Ho_Chi_Minh',clock_timestamp())::time>=time '23:59' THEN
   RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns','[]'::jsonb);
 END IF;
 turns:='[]';round_no:=coalesce((d.state->>'round')::int,0)+1;row_no:=jsonb_array_length(coalesce(d.state->'turns','[]'));
 IF jsonb_typeof(p_input->'choices') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'choices')>100 THEN RAISE EXCEPTION 'random_invalid_choices'; END IF;
 -- Server orders and validates every selected campaign against the saved rule snapshot.
 FOR choice IN SELECT x FROM jsonb_array_elements(p_input->'choices') x ORDER BY (x->>'ruleIndex')::int LOOP
   idx:=(choice->>'ruleIndex')::int;rule:=cfg->'rules'->idx;
   IF idx<0 OR rule IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(turns) x WHERE (x->>'ruleIndex')::int=idx) THEN RAISE EXCEPTION 'random_invalid_choice'; END IF;
   SELECT cc.* INTO c FROM public.auto_campaigns cc WHERE cc.id=(choice->>'campaignId')::bigint AND cc.account_id=p_account_id AND cc.staff_id=p_staff_id AND cc.organization_id=p_organization_id
     AND cc.action_id=rule->>'campaignActionId' AND NOT cc.is_delete AND cc.status='chờ xử lý'
     AND coalesce(cc.provisioning_state,'ready')='ready'
     AND private.campaign_dispatch_schedule_allowed(
       cc.schedule,cc.data_target_source_mode,cc.schedule_end_date,cc.daily_stop_time,clock_timestamp(),false);
   IF FOUND THEN
     row_no:=row_no+1;
     turns:=turns||jsonb_build_array(rule||jsonb_build_object('id',gen_random_uuid(),'order',row_no,'round',round_no,'ruleIndex',idx,'revision',rev,'campaignId',c.id,'campaignName',c.name,'processed',0,'elapsedSeconds',0,'status','planned'));
   END IF;
 END LOOP;
 IF jsonb_array_length(turns)>0 THEN
   INSERT INTO public.auto_account_random_run_days(account_id,staff_id,organization_id,run_date,state)
   VALUES(p_account_id,p_staff_id,p_organization_id,day,jsonb_build_object('round',round_no,'turns',turns,'configs',jsonb_build_object(rev::text,cfg)))
   ON CONFLICT(account_id,run_date) DO UPDATE SET state=jsonb_build_object('round',round_no,'turns',auto_account_random_run_days.state->'turns'||turns,'configs',coalesce(auto_account_random_run_days.state->'configs','{}')||jsonb_build_object(rev::text,cfg)),updated_at=clock_timestamp();
 END IF;
 RETURN jsonb_build_object('enabled',a.facebook_random_run_enabled,'config',cfg,'date',day,'turns',turns);
END $function$;

COMMIT;
