-- Restore V389 after V391 from freshly captured live definitions.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)'))) IS DISTINCT FROM 'c6c1947084ba01a0a8d3325651c79424' THEN RAISE EXCEPTION 'v392 source drift: public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_clear_campaign_runtime_claim_metadata()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_clear_campaign_runtime_claim_metadata()'))) IS DISTINCT FROM 'dacc6362ba94f2f62c9e4cb43f965510' THEN RAISE EXCEPTION 'v392 source drift: public.aka_agent_clear_campaign_runtime_claim_metadata()'; END IF;
IF to_regprocedure('public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'))) IS DISTINCT FROM 'a16c93a8853fcd34420b5e0f00478542' THEN RAISE EXCEPTION 'v392 source drift: public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'; END IF;
IF to_regprocedure('public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)'))) IS DISTINCT FROM '3bfcf3483700f6994858589334f2dc46' THEN RAISE EXCEPTION 'v392 source drift: public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)'))) IS DISTINCT FROM '5ebb1d085d5a70a1dde3ad85268349f4' THEN RAISE EXCEPTION 'v392 source drift: public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)'; END IF;
IF to_regprocedure('private.facebook_random_claim_allowed(bigint,bigint,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_claim_allowed(bigint,bigint,text)'))) IS DISTINCT FROM 'e204dc76d6ca7fe8806d135b53201902' THEN RAISE EXCEPTION 'v392 source drift: private.facebook_random_claim_allowed(bigint,bigint,text)'; END IF;
IF to_regprocedure('private.facebook_random_unit_gate(bigint,bigint,uuid,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_unit_gate(bigint,bigint,uuid,integer)'))) IS DISTINCT FROM '39c1403afa099c706b38f2850adf52ec' THEN RAISE EXCEPTION 'v392 source drift: private.facebook_random_unit_gate(bigint,bigint,uuid,integer)'; END IF;
IF to_regprocedure('private.facebook_random_unit_recover(bigint,bigint,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_unit_recover(bigint,bigint,uuid)'))) IS DISTINCT FROM 'a8f8ca1343cb7c6936b5e5e93d1f660d' THEN RAISE EXCEPTION 'v392 source drift: private.facebook_random_unit_recover(bigint,bigint,uuid)'; END IF;
IF to_regprocedure('private.facebook_random_unit_settled(bigint,bigint,uuid,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_unit_settled(bigint,bigint,uuid,boolean)'))) IS DISTINCT FROM '865b74966309d70fbb81f9e76dd491a0' THEN RAISE EXCEPTION 'v392 source drift: private.facebook_random_unit_settled(bigint,bigint,uuid,boolean)'; END IF;
IF to_regprocedure('private.facebook_random_unit_started(bigint,bigint,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_unit_started(bigint,bigint,uuid)'))) IS DISTINCT FROM '62ffac318d74ac671a5a1b9e51630c4a' THEN RAISE EXCEPTION 'v392 source drift: private.facebook_random_unit_started(bigint,bigint,uuid)'; END IF;
IF to_regprocedure('private.facebook_random_finalize_on_release()') IS NOT NULL THEN RAISE EXCEPTION 'v392 helper already exists: private.facebook_random_finalize_on_release()'; END IF;
IF to_regprocedure('private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)') IS NOT NULL THEN RAISE EXCEPTION 'v392 helper already exists: private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)'; END IF;
IF to_regprocedure('private.facebook_random_orphan_turns(bigint,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v392 helper already exists: private.facebook_random_orphan_turns(bigint,bigint)'; END IF;
IF to_regprocedure('private.facebook_random_pause_requested(bigint,bigint,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'v392 helper already exists: private.facebook_random_pause_requested(bigint,bigint,uuid)'; END IF;
IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_campaigns'::regclass AND tgname='facebook_random_finalize_on_release') THEN RAISE EXCEPTION 'v392 trigger already exists'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_accounts WHERE facebook_random_run_enabled) OR EXISTS(SELECT 1 FROM public.auto_account_random_run_days d,jsonb_array_elements(d.state->'turns') x WHERE x->>'status'='running') THEN RAISE EXCEPTION 'v392 requires random mode disabled and no running random turns'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION private.facebook_random_finalize_turn(p_campaign bigint, p_account bigint, p_claim uuid, p_unit uuid, p_recovered boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.auto_campaigns%ROWTYPE; d public.auto_account_random_run_days%ROWTYPE; turns jsonb; reason text;
 today date:=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
BEGIN
 SELECT * INTO c FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account;
 IF NOT FOUND OR (p_claim IS NULL AND p_unit IS NULL) THEN RETURN; END IF;
 IF NOT p_recovered AND (c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL) THEN RETURN; END IF;
 IF p_recovered AND ((c.runtime_unit_token IS NOT NULL AND c.runtime_unit_token IS DISTINCT FROM p_unit)
   OR (c.runtime_claim_token IS NOT NULL AND c.runtime_claim_token IS DISTINCT FROM p_claim)) THEN RETURN; END IF;
 reason:=CASE WHEN p_recovered THEN 'Lượt chạy đã gián đoạn; không tự phát lại thao tác chưa rõ kết quả'
   WHEN c.is_delete THEN 'Chiến dịch đã bị xóa'
   WHEN c.status='tạm dừng' THEN coalesce(nullif(c.note,''),'Chiến dịch đã tạm dừng')
   ELSE nullif(c.note,'') END;
 FOR d IN SELECT * FROM public.auto_account_random_run_days dd WHERE dd.account_id=p_account AND dd.staff_id=c.staff_id AND dd.status='open'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(dd.state->'turns') x WHERE x->>'status'='running' AND (x->>'campaignId')::bigint=p_campaign
     AND ((p_claim IS NOT NULL AND x->>'claimToken'=p_claim::text) OR (p_unit IS NOT NULL AND (x->>'unitToken'=p_unit::text OR x->>'lastUnitToken'=p_unit::text)))) FOR UPDATE LOOP
   SELECT jsonb_agg(CASE WHEN x->>'status'='running' AND (x->>'campaignId')::bigint=p_campaign
     AND ((p_claim IS NOT NULL AND x->>'claimToken'=p_claim::text) OR (p_unit IS NOT NULL AND (x->>'unitToken'=p_unit::text OR x->>'lastUnitToken'=p_unit::text)))
     THEN (x-'unitToken'-'unitStartedAt')||jsonb_build_object('status',CASE WHEN reason IS NOT NULL OR (x->>'processed')::int=0 THEN 'stopped' ELSE 'completed' END,
       'reason',coalesce(reason,CASE WHEN (x->>'processed')::int=0 THEN 'Đợt chưa thực hiện được đối tượng nào' END),'endedAt',clock_timestamp())
     WHEN x->>'status'='planned' AND d.run_date<today THEN x||jsonb_build_object('status','expired','reason','Hết ngày','endedAt',clock_timestamp())
     ELSE x END ORDER BY n) INTO turns FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY q(x,n);
   UPDATE public.auto_account_random_run_days SET state=jsonb_set(state,'{turns}',turns),updated_at=clock_timestamp(),
     status=CASE WHEN run_date<today AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(turns) x WHERE x->>'status'='running') THEN 'closed' ELSE status END WHERE id=d.id;
 END LOOP;
END $function$
;
REVOKE ALL ON FUNCTION private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean) TO anon,authenticated,service_role,aka_agent_chat_api;
CREATE OR REPLACE FUNCTION private.facebook_random_finalize_on_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 PERFORM private.facebook_random_finalize_turn(NEW.id,NEW.account_id,OLD.runtime_claim_token,OLD.runtime_unit_token);
 RETURN NEW;
END $function$
;
REVOKE ALL ON FUNCTION private.facebook_random_finalize_on_release() FROM PUBLIC;
CREATE OR REPLACE FUNCTION private.facebook_random_pause_requested(p_campaign bigint, p_account bigint, p_claim uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT EXISTS(
   SELECT 1 FROM public.auto_campaigns c JOIN public.auto_account_random_run_days d ON d.account_id=c.account_id AND d.staff_id=c.staff_id,
     jsonb_array_elements(d.state->'turns') x
   WHERE c.id=p_campaign AND c.account_id=p_account AND c.runtime_claim_token=p_claim AND c.note='Đang chờ tạm dừng'
     AND d.status='open' AND x->>'campaignId'=p_campaign::text AND x->>'claimToken'=p_claim::text AND x->>'status'='running'
 )
$function$
;
REVOKE ALL ON FUNCTION private.facebook_random_pause_requested(bigint,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.facebook_random_pause_requested(bigint,bigint,uuid) TO anon,authenticated,service_role,aka_agent_chat_api;
CREATE OR REPLACE FUNCTION private.facebook_random_orphan_turns(p_staff bigint, p_org bigint)
 RETURNS TABLE(id bigint, account_id bigint, claim text, unit text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT DISTINCT c.id,c.account_id,x->>'claimToken',x->>'lastUnitToken'
 FROM public.auto_account_random_run_days d CROSS JOIN LATERAL jsonb_array_elements(d.state->'turns') x
 JOIN public.auto_campaigns c ON c.id=(x->>'campaignId')::bigint AND c.account_id=d.account_id AND c.staff_id=d.staff_id
 JOIN public.auto_accounts a ON a.id=c.account_id AND a.staff_id=c.staff_id
 JOIN public.org_staff s ON s.id=c.staff_id AND s.organization_id=p_org
 WHERE d.staff_id=p_staff AND d.organization_id=p_org AND d.status='open' AND x->>'status'='running'
   AND a.flatform_type='facebook' AND (c.organization_id IS NULL OR c.organization_id=p_org) AND (a.organization_id IS NULL OR a.organization_id=p_org)
   AND c.runtime_claim_token IS NULL AND c.runtime_unit_token IS NULL AND c.status<>'đang chạy'
$function$
;
REVOKE ALL ON FUNCTION private.facebook_random_orphan_turns(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.facebook_random_orphan_turns(bigint,bigint) TO anon,authenticated,service_role,aka_agent_chat_api;

CREATE OR REPLACE FUNCTION public.aka_agent_cleanup_failed_campaign_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_runtime_unit_token uuid, p_unstarted_input_data_ids bigint[], p_note text, p_pause_unknown_outcome boolean, p_campaign_status text DEFAULT NULL::text, p_account_status text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint;
  v_optimistic_ids bigint[];
  v_ids bigint[];
  v_parent uuid;
  v_unit uuid;
  v_account_token uuid;
  v_target text;
  v_claim_date date;
  v_claim_at timestamptz;
  v_unit_date date;
  v_unit_at timestamptz;
  v_campaign_status text;
  v_account_status text;
  v_now timestamptz := clock_timestamp();
  v_unstarted bigint[] := COALESCE(p_unstarted_input_data_ids, ARRAY[]::bigint[]);
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop', 'server')
    OR p_runtime_claim_token IS NULL OR p_pause_unknown_outcome IS NULL
    OR cardinality(v_unstarted) > 50 OR array_position(v_unstarted, NULL) IS NOT NULL
    OR (p_campaign_status IS NOT NULL AND p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng'))
    OR (p_account_status IS NOT NULL AND p_account_status NOT IN ('chờ xử lý', 'tạm dừng'))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid failure cleanup payload';
  END IF;

  -- Like v2 settlement, cleanup survives entitlement/subtype changes, but
  -- requires the original opaque token and tenant scope under invoker RLS.
  SELECT staff.organization_id INTO v_org
  FROM public.org_staff staff WHERE staff.id = p_staff_id FOR SHARE OF staff;
  IF NOT FOUND OR v_org IS NULL THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
  SELECT c.runtime_unit_input_data_ids INTO v_optimistic_ids
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org);
  PERFORM d.id FROM public.auto_campaign_input_data d
  WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_optimistic_ids)
  ORDER BY d.id FOR UPDATE OF d;

  SELECT c.runtime_claim_token, c.runtime_claim_target, c.runtime_claim_vietnam_date, c.runtime_claimed_at,
    c.runtime_unit_token, c.runtime_unit_vietnam_date, c.runtime_unit_claimed_at, c.runtime_unit_input_data_ids,
    c.status, a.status, a.runtime_operation_claim_token
  INTO v_parent, v_target, v_claim_date, v_claim_at, v_unit, v_unit_date, v_unit_at, v_ids,
    v_campaign_status, v_account_status, v_account_token
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org)
  FOR UPDATE OF c, a;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'; RETURN;
  END IF;

  IF (v_parent IS NOT NULL AND v_parent <> p_runtime_claim_token)
    OR (v_account_token IS NOT NULL AND v_account_token <> p_runtime_claim_token)
    OR (v_unit IS NOT NULL AND v_unit IS DISTINCT FROM p_runtime_unit_token)
    OR (v_parent IS NOT NULL AND v_target IS DISTINCT FROM p_runtime_target)
  THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  IF v_ids IS DISTINCT FROM v_optimistic_ids
    OR (v_parent IS NOT NULL AND (v_claim_date IS NULL OR v_claim_at IS NULL))
    OR (v_parent IS NULL AND (v_target IS NOT NULL OR v_claim_date IS NOT NULL OR v_claim_at IS NOT NULL))
    OR (v_unit IS NOT NULL AND (v_unit_date IS NULL OR v_unit_at IS NULL OR v_ids IS NULL OR cardinality(v_ids) > 50))
    OR (v_unit IS NULL AND (v_unit_date IS NOT NULL OR v_unit_at IS NOT NULL OR v_ids IS NOT NULL))
    OR (v_campaign_status = 'đang chạy' AND v_parent IS DISTINCT FROM p_runtime_claim_token)
    OR (v_account_status = 'đang chạy' AND v_account_token IS DISTINCT FROM p_runtime_claim_token)
  THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;
  IF v_parent IS NULL AND v_unit IS NULL AND v_account_token IS NULL THEN
    -- A committed response can be lost. This branch performs no writes and
    -- cannot release a new owner, including a tokenless legacy running row.
    RETURN QUERY SELECT true, 'already_cleaned'; RETURN;
  END IF;
  IF v_unit IS NOT NULL AND NOT (v_unstarted <@ v_ids) THEN
    RETURN QUERY SELECT false, 'invalid_unstarted_ids'; RETURN;
  END IF;
  IF v_unit IS NULL AND cardinality(v_unstarted) > 0 THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;

  -- A durable pause hint arriving while budget cleanup waits must win too.
  IF coalesce(p_campaign_status,'chờ xử lý')='chờ xử lý' AND private.facebook_random_pause_requested(p_campaign_id,p_account_id,p_runtime_claim_token) THEN
    p_campaign_status:='tạm dừng';
    IF coalesce(p_note,'')='' THEN p_note:='Đang chờ tạm dừng'; END IF;
  END IF;
  IF v_unit IS NOT NULL THEN
    UPDATE public.auto_campaign_input_data d
    SET status = CASE WHEN d.id = ANY(v_unstarted) THEN 'chờ xử lý' ELSE 'hoàn thành' END,
      date_action = CASE WHEN d.id = ANY(v_unstarted) THEN NULL ELSE d.date_action END,
      note = CASE WHEN d.id = ANY(v_unstarted) THEN d.note
        ELSE left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000) || ' — Kết quả chưa xác nhận; không tự gửi lại.' END
    WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_ids)
      AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND NOT (d.id = ANY(v_unstarted))));
    -- An inner error/pause handler may have requeued a started input before its
    -- next write failed. Its still-owned lease proves it cannot be sent again.
    -- Already paused/completed inputs are deliberately untouched.
    PERFORM private.facebook_random_unit_settled(p_campaign_id,p_account_id,p_runtime_unit_token,p_pause_unknown_outcome);
    UPDATE public.auto_campaigns c
    SET runtime_unit_token = NULL, runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL, runtime_unit_input_data_ids = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_unit_token = p_runtime_unit_token;
  END IF;

  IF v_parent = p_runtime_claim_token THEN
    UPDATE public.auto_campaigns c
    SET status = CASE WHEN p_pause_unknown_outcome THEN 'tạm dừng' ELSE COALESCE(p_campaign_status, 'chờ xử lý') END,
      note = left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000)
        || CASE WHEN p_pause_unknown_outcome THEN ' — Chưa xác định phần đã thực hiện; tạm dừng để kiểm tra.' ELSE '' END,
      updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token AND c.status = 'đang chạy';
    -- The existing server pause trigger preserves the parent tuple on a status
    -- transition. Clear it separately, under the same row lock/transaction.
    UPDATE public.auto_campaigns c
    SET runtime_claim_token = NULL, runtime_claim_target = NULL,
      runtime_claim_vietnam_date = NULL, runtime_claimed_at = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token;
  END IF;
  IF v_account_token = p_runtime_claim_token THEN
    UPDATE public.auto_accounts a
    SET status = CASE WHEN a.status = 'đang chạy' THEN COALESCE(p_account_status, 'chờ xử lý') ELSE a.status END,
      runtime_operation_claim_token = NULL, updated_at = v_now
    WHERE a.id = p_account_id AND a.staff_id = p_staff_id
      AND a.runtime_operation_claim_token = p_runtime_claim_token;
  END IF;
  RETURN QUERY SELECT true, 'cleaned';
END;
$function$
;
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
     AND cc.action_id=rule->>'campaignActionId' AND NOT cc.is_delete AND cc.status='chờ xử lý' AND cc.schedule<=clock_timestamp()
     AND coalesce(cc.provisioning_state,'ready')='ready'
     AND timezone('Asia/Ho_Chi_Minh',clock_timestamp())::time<least(coalesce(cc.daily_stop_time,time '23:59'),time '23:59')
     AND (cc.schedule_end_date IS NULL OR cc.schedule_end_date>clock_timestamp());
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
END $function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_recover_campaign_runtime_unit_leases(p_staff_id bigint, p_runtime_target text, p_platform_scope text DEFAULT 'all'::text)
 RETURNS TABLE(ok boolean, reason text, recovered_lease_count bigint, requeued_input_count bigint, db_now timestamp with time zone, vietnam_date_key date)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_random record;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_platform_scope text := lower(btrim(COALESCE(p_platform_scope, '')));
  v_organization_id bigint;
  v_candidate record;
  v_locked_token uuid;
  v_locked_input_data_ids bigint[];
  v_recovered_lease_count bigint := 0;
  v_requeued_input_count bigint := 0;
  v_row_count bigint := 0;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF v_platform_scope NOT IN ('all', 'zalo') THEN
    RAISE EXCEPTION 'platform scope must be all or zalo';
  END IF;

  -- Startup recovery is cleanup and therefore remains available for an
  -- inactive staff row. The caller must invoke it only after its existing
  -- runtime-specific recovery has proved the scheduler process idle.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', 0::bigint, 0::bigint,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  FOR v_candidate IN
    SELECT campaign.id AS campaign_id,
      campaign.account_id,
      campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(
      v_candidate.campaign_id
    );

    IF cardinality(COALESCE(
      v_candidate.runtime_unit_input_data_ids,
      ARRAY[]::bigint[]
    )) > 0 THEN
      PERFORM input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_candidate.runtime_unit_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
      ORDER BY input_data.id
      FOR UPDATE OF input_data;
    END IF;

    SELECT campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    INTO v_locked_token, v_locked_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.account_id = v_candidate.account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_candidate.runtime_unit_token
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    FOR UPDATE OF campaign, account;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    PERFORM private.facebook_random_unit_recover(v_candidate.campaign_id,v_candidate.account_id,v_locked_token);

    IF cardinality(COALESCE(v_locked_input_data_ids, ARRAY[]::bigint[])) > 0 THEN
      UPDATE public.auto_campaign_input_data AS input_data
      SET status = 'chờ xử lý', date_action = NULL
      WHERE input_data.id = ANY(v_locked_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
        AND input_data.status = 'đang chạy';
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_requeued_input_count := v_requeued_input_count + v_row_count;
    END IF;

    v_now := clock_timestamp();
    UPDATE public.auto_campaigns AS campaign
    SET runtime_unit_token = NULL,
      runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL,
      runtime_unit_input_data_ids = NULL,
      updated_at = v_now
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_locked_token;

    IF FOUND THEN
      v_recovered_lease_count := v_recovered_lease_count + 1;
    END IF;
  END LOOP;

  -- Same startup recovery proof/locks; includes orphan turns when mode is off.
  IF v_runtime_target='desktop' AND v_platform_scope='all' THEN
    FOR v_random IN SELECT * FROM private.facebook_random_orphan_turns(p_staff_id,v_organization_id) ORDER BY id
    LOOP
      PERFORM public.aka_agent_lock_campaign_input_serialization(v_random.id);
      PERFORM 1 FROM public.auto_campaigns cc JOIN public.auto_accounts aa ON aa.id=cc.account_id AND aa.staff_id=cc.staff_id
        WHERE cc.id=v_random.id AND cc.account_id=v_random.account_id AND cc.staff_id=p_staff_id AND aa.flatform_type='facebook'
          AND (cc.organization_id IS NULL OR cc.organization_id=v_organization_id)
          AND (aa.organization_id IS NULL OR aa.organization_id=v_organization_id)
          AND cc.runtime_claim_token IS NULL AND cc.runtime_unit_token IS NULL AND cc.status<>'đang chạy'
        FOR UPDATE OF cc,aa;
      IF FOUND THEN PERFORM private.facebook_random_finalize_turn(v_random.id,v_random.account_id,v_random.claim::uuid,v_random.unit::uuid,true); END IF;
    END LOOP;
  END IF;
  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  RETURN QUERY SELECT
    true, 'recovered', v_recovered_lease_count, v_requeued_input_count,
    v_now, v_vietnam_date;
END;
$function$
;
CREATE OR REPLACE FUNCTION private.facebook_random_unit_recover(p_campaign bigint, p_account bigint, p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record;t jsonb;
BEGIN
 SELECT runtime_unit_input_data_ids ids,runtime_claim_token claim INTO c FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT x INTO t FROM public.auto_account_random_run_days d,jsonb_array_elements(d.state->'turns') x
 WHERE d.account_id=p_account AND d.status='open' AND x->>'unitToken'=p_unit::text AND x->>'status'='running';
 IF t IS NULL THEN RETURN; END IF;
 PERFORM private.facebook_random_unit_settled(p_campaign,p_account,p_unit,true);
 UPDATE public.auto_campaign_input_data SET status='hoàn thành',note='Lượt ngẫu nhiên bị gián đoạn; kết quả chưa rõ, không tự thực hiện lại'
 WHERE campaign_id=p_campaign AND id=ANY(c.ids) AND status IN ('đang chạy','chờ xử lý');
 IF t->>'unit'<>'data' THEN
   UPDATE public.auto_campaigns SET status='tạm dừng',note='Lượt ngẫu nhiên bị gián đoạn; kiểm tra kết quả trước khi chạy lại' WHERE id=p_campaign;
 END IF;
 PERFORM private.facebook_random_finalize_turn(p_campaign,p_account,c.claim,p_unit,true);
END $function$
;
CREATE TRIGGER facebook_random_finalize_on_release AFTER UPDATE OF status,runtime_claim_token,runtime_unit_token ON public.auto_campaigns FOR EACH ROW WHEN (NEW.runtime_claim_token IS NULL AND NEW.runtime_unit_token IS NULL AND (OLD.runtime_claim_token IS NOT NULL OR OLD.runtime_unit_token IS NOT NULL)) EXECUTE FUNCTION private.facebook_random_finalize_on_release();

-- Public API signatures/attributes unchanged; no explicit schema reload.
COMMIT;
