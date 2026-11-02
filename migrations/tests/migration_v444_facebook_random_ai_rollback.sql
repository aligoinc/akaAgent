-- Guarded rollback only. Convert v2 settings explicitly and drain runtime first.
-- Does not delete day history or alter unrelated functions/ACLs. Never use for drift repair.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $rollback$ BEGIN
 IF to_regprocedure('aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'))) IS DISTINCT FROM '4f9873daff8efc4d85e36b9c683d1e6f' THEN RAISE EXCEPTION 'v444 target drift: aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'; END IF;
 IF to_regprocedure('private.facebook_random_ai_rules_valid(jsonb,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_ai_rules_valid(jsonb,jsonb)'))) IS DISTINCT FROM '795238d7689ad9efae3515cf156bdcb7' THEN RAISE EXCEPTION 'v444 target drift: private.facebook_random_ai_rules_valid(jsonb,jsonb)'; END IF;
 IF to_regprocedure('private.facebook_random_unit_started(bigint,bigint,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.facebook_random_unit_started(bigint,bigint,uuid)'))) IS DISTINCT FROM '4e2a6f8bd7ddddb0b60448b281c6f04f' THEN RAISE EXCEPTION 'v444 target drift: private.facebook_random_unit_started(bigint,bigint,uuid)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'::regprocedure AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=30s']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'v444 metadata drift: aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.facebook_random_ai_rules_valid(jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)='postgres' AND prosecdef=false AND provolatile='i' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}') THEN RAISE EXCEPTION 'v444 metadata drift: private.facebook_random_ai_rules_valid(jsonb,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.facebook_random_unit_started(bigint,bigint,uuid)'::regprocedure AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND provolatile='v' AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'v444 metadata drift: private.facebook_random_unit_started(bigint,bigint,uuid)'; END IF;
 IF (SELECT md5(jsonb_build_array(code,name,prompt_system,prompt_user,is_reasoning,is_system,is_active)::text) FROM public.ai_prompt WHERE code='app_facebook_random_run_plan') IS DISTINCT FROM 'ff0a7dfb09c2f0105784636d3189305f' THEN RAISE EXCEPTION 'v444 prompt drift'; END IF;
 IF (SELECT md5(jsonb_build_array(u.code,u.name,u.description,p.code,u.model_id,u.is_system,u.is_active,u.timeout_ms,u.response_parser,u.request_options)::text) FROM public.ai_using u JOIN public.ai_prompt p ON p.id=u.prompt_id WHERE u.code='app_facebook_random_run_plan') IS DISTINCT FROM 'ac40b53b45d4e423c293782187c701ce' THEN RAISE EXCEPTION 'v444 using drift'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_accounts WHERE facebook_random_run_config->>'version'='2') THEN RAISE EXCEPTION 'v444 rollback: v2 configurations still exist; explicitly convert manual drafts first'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_account_random_run_days d,jsonb_array_elements(d.state->'turns') t WHERE t->>'aiPlanId' IS NOT NULL AND t->>'status' IN ('planned','running')) THEN RAISE EXCEPTION 'v444 rollback: AI turns not drained'; END IF;
 IF EXISTS(SELECT 1 FROM public.ai_using u JOIN public.ai_prompt p ON p.id=u.prompt_id WHERE p.code='app_facebook_random_run_plan' AND u.code<>'app_facebook_random_run_plan') THEN RAISE EXCEPTION 'v444 rollback: AI prompt has other callers'; END IF;
END $rollback$;
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
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL); -- Bind Desktop token before privileged work.

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

CREATE OR REPLACE FUNCTION private.facebook_random_unit_started(p_campaign bigint, p_account bigint, p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(NULL, p_account, p_campaign); -- Bind Desktop token before privileged work.

 SELECT runtime_claim_token, runtime_unit_claimed_at, runtime_unit_vietnam_date INTO c
 FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.auto_account_random_run_days d SET state=jsonb_set(d.state,'{turns}',(
   SELECT jsonb_agg(CASE WHEN x->>'claimToken'=c.runtime_claim_token::text AND x->>'status'='running'
     THEN x||jsonb_build_object('unitToken',p_unit,'unitStartedAt',c.runtime_unit_claimed_at) ELSE x END ORDER BY n)
   FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY AS a(x,n))), updated_at=clock_timestamp()
 WHERE d.account_id=p_account AND d.run_date=c.runtime_unit_vietnam_date
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'claimToken'=c.runtime_claim_token::text AND x->>'status'='running');
END $function$;
DROP FUNCTION private.facebook_random_ai_rules_valid(jsonb,jsonb);
DELETE FROM public.ai_using WHERE code='app_facebook_random_run_plan';
DELETE FROM public.ai_prompt WHERE code='app_facebook_random_run_plan';
COMMIT;
