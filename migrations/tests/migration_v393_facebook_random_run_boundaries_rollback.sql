BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
 sid bigint:=880039300000001; aid bigint:=880039300000002; cid bigint:=880039300000003; iid bigint:=880039300000004;
 reset_name text; org bigint; cfg jsonb; r jsonb; t jsonb; result record; token uuid:=gen_random_uuid(); unit uuid:=gen_random_uuid(); day date:=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
BEGIN
 SELECT s.organization_id INTO org FROM public.org_staff s WHERE s.is_active AND s.organization_id IS NOT NULL AND public.aka_agent_staff_time_allowed(s.id) ORDER BY s.id LIMIT 1;
 IF org IS NULL THEN RAISE EXCEPTION 'v393 smoke requires an eligible organization'; END IF;
 INSERT INTO public.org_staff(id,organization_id,name,phone,username,password,is_active) OVERRIDING SYSTEM VALUE
 VALUES(sid,org,'__v393_rollback__','880039300000001','__v393_rollback__','__rollback_only__',true);
 INSERT INTO public.auto_accounts(id,name,flatform_type,status,login_status,is_active,staff_id,organization_id,is_delete,is_zalo_show_web,is_zalo_server) OVERRIDING SYSTEM VALUE
 VALUES(aid,'__v393_rollback__','facebook','chờ xử lý','đã đăng nhập',true,sid,org,false,false,false);
 INSERT INTO public.auto_campaigns(id,name,action_id,account_id,status,content,schedule,original_schedule,schedule_type,staff_id,organization_id,is_delete,data_target_source_mode)
 OVERRIDING SYSTEM VALUE VALUES(cid,'__v393_rollback__','facebook_group_post',aid,'chờ xử lý','',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute','daily',sid,org,false,'direct');
 INSERT INTO public.auto_campaign_input_data(id,campaign_id,name,uid,status,is_delete) OVERRIDING SYSTEM VALUE VALUES(iid,cid,'__v393_target__','fixture_not_a_real_target','chờ xử lý',false);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 EXECUTE 'SET LOCAL ROLE anon';
 cfg:='{"version":1,"revision":0,"rules":[{"campaignActionId":"facebook_group_post","quantity":1,"unit":"data"}]}'::jsonb;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'save',jsonb_build_object('config',cfg));
 IF r->'config'->>'revision'<>'1' THEN RAISE EXCEPTION 'v393 save revision'; END IF;
 BEGIN
   PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'save',jsonb_build_object('config',cfg));
   RAISE EXCEPTION 'v393 CAS bypass';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'random_config_conflict' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.aka_agent_facebook_random_run(sid,org+10000000,'__v393_rollback__','__rollback_only__',aid,'get');
   RAISE EXCEPTION 'v393 tenant bypass';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.aka_agent_facebook_random_run(sid,org,NULL,NULL,aid,'get');
   RAISE EXCEPTION 'v393 missing auth bypass';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'toggle','{"enabled":true,"revision":1}');
 r:=public.aka_agent_desktop_account_snapshot(sid,org,'__v393_rollback__','__rollback_only__','{"facebookCore":true}');
 IF r->'states'->0->>'facebookRandomRunEnabled'<>'true' OR r->'states'->0->>'facebookRandomRunRevision'<>'1' THEN RAISE EXCEPTION 'v393 snapshot'; END IF;
 IF r::text LIKE '%"rules"%' THEN RAISE EXCEPTION 'v393 snapshot must not transfer rules'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'plan',jsonb_build_object('revision',1,'choices',jsonb_build_array(jsonb_build_object('ruleIndex',0,'campaignId',cid))));
 t:=r->'turns'->0;
 IF t IS NULL THEN RAISE EXCEPTION 'v393 plan missing (do not run within 23:59 cutoff)'; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_runtime_checked(cid,aid,sid,'desktop');
 IF result.reason<>'random_context_required' THEN RAISE EXCEPTION 'v393 old client bypass: %',result.reason; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'claim',jsonb_build_object('turnId',t->>'id','campaignId',cid,'claimToken',token));
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'v393 claim rejected: %',r->>'reason'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'claim',jsonb_build_object('turnId',t->>'id','campaignId',cid,'claimToken',token));
 IF r->>'reason'<>'already_claimed' THEN RAISE EXCEPTION 'v393 claim replay'; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_run_unit_v2(cid,aid,sid,'desktop',token,day,unit,ARRAY[iid]);
 IF NOT result.ok THEN RAISE EXCEPTION 'v393 unit rejected: %',result.reason; END IF;
 SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',gen_random_uuid(),false);
 IF result.ok THEN RAISE EXCEPTION 'v393 wrong token bypass'; END IF;
 UPDATE public.auto_campaign_input_data SET status='hoàn thành' WHERE id=iid;
 SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',unit,false);
 IF NOT result.ok THEN RAISE EXCEPTION 'v393 settle rejected: %',result.reason; END IF;
 SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',unit,false);
 IF NOT result.ok THEN RAISE EXCEPTION 'v393 settle replay rejected'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'day',jsonb_build_object('date',day));
 IF r->'turns'->0->>'processed'<>'1' THEN RAISE EXCEPTION 'v393 progress duplicate'; END IF;
 IF r::text LIKE '%claimToken%' THEN RAISE EXCEPTION 'v393 token exposed to UI'; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_run_unit_v2(cid,aid,sid,'desktop',token,day,gen_random_uuid(),ARRAY[]::bigint[]);
 -- An empty data unit is materialization and has no target budget, but cannot execute more objects.
 IF result.ok THEN
   SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',result.runtime_unit_token,false);
 END IF;
 UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=cid;
 UPDATE public.auto_accounts SET status='chờ xử lý',runtime_operation_claim_token=NULL WHERE id=aid;
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'finish',jsonb_build_object('turnId',t->>'id','claimToken',token));

 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'progress',jsonb_build_object('turnId',t->>'id','claimToken',token));
 IF r->>'status'<>'completed' THEN RAISE EXCEPTION 'v393 atomic finish failed: %',r; END IF;
 -- Another machine plans before the first executor receives finish: no false interruption.
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'plan','{"revision":1,"choices":[]}');
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'finish',jsonb_build_object('turnId',t->>'id','claimToken',token));
 IF r->>'status'<>'completed' THEN RAISE EXCEPTION 'v393 competing plan corrupted completion'; END IF;
 -- Pause after the final unit: budget cleanup must preserve the winning status.
 UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=iid;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'plan',jsonb_build_object('revision',1,'choices',jsonb_build_array(jsonb_build_object('ruleIndex',0,'campaignId',cid)))); t:=r->'turns'->0;
 token:=gen_random_uuid();unit:=gen_random_uuid();
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'claim',jsonb_build_object('turnId',t->>'id','campaignId',cid,'claimToken',token));
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'v393 claim 2: %',r; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_run_unit_v2(cid,aid,sid,'desktop',token,day,unit,ARRAY[iid]);
 IF NOT result.ok THEN RAISE EXCEPTION 'v393 unit 2'; END IF;
 UPDATE public.auto_campaign_input_data SET status='hoàn thành' WHERE id=iid;
 SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',unit,false);
 IF NOT result.ok THEN RAISE EXCEPTION 'v393 settle 2'; END IF;
 UPDATE public.auto_campaigns SET status='tạm dừng',note='User pause' WHERE id=cid;
 SELECT * INTO result FROM public.aka_agent_cleanup_failed_campaign_runtime(cid,aid,sid,'desktop',token,NULL,ARRAY[]::bigint[],'',false,'chờ xử lý','chờ xử lý');
 IF NOT result.ok OR (SELECT status FROM public.auto_campaigns WHERE id=cid)<>'tạm dừng' THEN RAISE EXCEPTION 'v393 pause overwritten'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'progress',jsonb_build_object('turnId',t->>'id','claimToken',token));
 IF r->>'status'<>'stopped' OR r->>'reason'<>'User pause' THEN RAISE EXCEPTION 'v393 pause history'; END IF;
 -- Stop then crash: startup recovery must close history without another plan call.
 UPDATE public.auto_campaigns SET status='chờ xử lý',note=NULL WHERE id=cid;
 UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=iid;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'plan',jsonb_build_object('revision',1,'choices',jsonb_build_array(jsonb_build_object('ruleIndex',0,'campaignId',cid)))); t:=r->'turns'->0;
 token:=gen_random_uuid();unit:=gen_random_uuid();
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'claim',jsonb_build_object('turnId',t->>'id','campaignId',cid,'claimToken',token));
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'v393 claim 3: %',r; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_run_unit_v2(cid,aid,sid,'desktop',token,day,unit,ARRAY[iid]);
 IF NOT result.ok THEN RAISE EXCEPTION 'v393 unit 3'; END IF;
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'toggle','{"enabled":false,"revision":1}');
 SELECT * INTO result FROM public.aka_agent_recover_campaign_runtime_unit_leases(sid,'desktop','all');
 IF NOT result.ok THEN RAISE EXCEPTION 'v393 recovery'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'progress',jsonb_build_object('turnId',t->>'id','claimToken',token));
 IF r->>'status'<>'stopped' OR r->>'endedAt' IS NULL OR (SELECT runtime_unit_token FROM public.auto_campaigns WHERE id=cid) IS NOT NULL THEN RAISE EXCEPTION 'v393 disabled history stranded'; END IF;
 BEGIN
   EXECUTE 'SELECT id FROM public.auto_account_random_run_days LIMIT 1';
   RAISE EXCEPTION 'v393 direct history read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- Reset must not classify a settled 1/3 turn as successful before recovery.
 cfg:='{"version":1,"revision":1,"rules":[{"campaignActionId":"facebook_group_post","quantity":3,"unit":"data"}]}'::jsonb;
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'save',jsonb_build_object('config',cfg));
 FOREACH reset_name IN ARRAY ARRAY['reset_desktop_running_statuses_no_retry','reset_desktop_running_statuses']
 LOOP
   UPDATE public.auto_campaigns SET status='chờ xử lý',note=NULL,runtime_claim_token=NULL,runtime_unit_token=NULL WHERE id=cid;
   UPDATE public.auto_accounts SET status='chờ xử lý',runtime_operation_claim_token=NULL WHERE id=aid;
   UPDATE public.auto_campaign_input_data SET status='chờ xử lý',note=NULL WHERE id=iid;
   PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'toggle','{"enabled":true,"revision":2}');
   r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'plan',jsonb_build_object('revision',2,'choices',jsonb_build_array(jsonb_build_object('ruleIndex',0,'campaignId',cid)))); t:=r->'turns'->0;
   token:=gen_random_uuid();unit:=gen_random_uuid();
   r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'claim',jsonb_build_object('turnId',t->>'id','campaignId',cid,'claimToken',token));
   IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'v393 partial claim: %',r; END IF;
   SELECT * INTO result FROM public.aka_agent_claim_campaign_run_unit_v2(cid,aid,sid,'desktop',token,day,unit,ARRAY[iid]);
   IF NOT result.ok THEN RAISE EXCEPTION 'v393 partial unit'; END IF;
   UPDATE public.auto_campaign_input_data SET status='hoàn thành' WHERE id=iid;
   SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',unit,false);
   IF NOT result.ok THEN RAISE EXCEPTION 'v393 partial settle'; END IF;
   PERFORM public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'toggle','{"enabled":false,"revision":2}');
   PERFORM set_config('aka_agent.facebook_random_reset_staff','different-staff-context',true);
   EXECUTE format('SELECT public.%I($1,false,true)',reset_name) INTO r USING sid;
   IF current_setting('aka_agent.facebook_random_reset_staff',true)<>'different-staff-context' THEN RAISE EXCEPTION 'v393 leaked reset context'; END IF;
   PERFORM set_config('aka_agent.facebook_random_reset_staff','',true);
   r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'progress',jsonb_build_object('turnId',t->>'id','claimToken',token));
   IF r->>'status'<>'running' THEN RAISE EXCEPTION 'v393 reset finalized turn early: %',r; END IF;
   SELECT * INTO result FROM public.aka_agent_recover_campaign_runtime_unit_leases(sid,'desktop','all');
   IF NOT result.ok THEN RAISE EXCEPTION 'v393 partial recovery'; END IF;
   r:=public.aka_agent_facebook_random_run(sid,org,'__v393_rollback__','__rollback_only__',aid,'progress',jsonb_build_object('turnId',t->>'id','claimToken',token));
   IF r->>'status'<>'stopped' OR r->>'processed'<>'1' OR r->>'quantity'<>'3' OR r->>'reason' IS NULL OR r->>'endedAt' IS NULL THEN RAISE EXCEPTION 'v393 partial output: %',r; END IF;
   -- Guarded late pause works after release and refuses a newer active owner.
   SELECT * INTO result FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'tạm dừng');
   IF NOT result.ok THEN RAISE EXCEPTION 'v393 late pause failed: %',result.reason; END IF;
   SELECT * INTO result FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'chờ xử lý');
   IF NOT result.ok THEN RAISE EXCEPTION 'v393 resume failed'; END IF;
   UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=iid;
   SELECT * INTO result FROM public.aka_agent_claim_campaign_runtime_checked(cid,aid,sid,'desktop');
   IF NOT result.ok THEN RAISE EXCEPTION 'v393 newer owner claim: %',result.reason; END IF;
   SELECT * INTO result FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'tạm dừng');
   IF result.ok OR result.reason<>'runtime_busy' THEN RAISE EXCEPTION 'v393 newer owner overwritten'; END IF;
 END LOOP;

 EXECUTE 'RESET ROLE';
END $test$;
SELECT 'PASS v393 rollback: partial restart both reset RPCs/mode off/context restore/late pause/new owner, real anon auth/RLS, atomic finish, competing plan, pause winner, disabled recovery, token replay and ownership' AS result;
ROLLBACK;
