BEGIN;
DO $$ BEGIN
 IF to_regprocedure('private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_campaigns'::regclass AND tgname='facebook_random_finalize_on_release')
 THEN RAISE EXCEPTION 'v391 lifecycle extension still present'; END IF;
END $$;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
 sid bigint:=880039100000001; aid bigint:=880039100000002; cid bigint:=880039100000003; iid bigint:=880039100000004;
 org bigint; cfg jsonb; r jsonb; t jsonb; result record; token uuid:=gen_random_uuid(); unit uuid:=gen_random_uuid(); day date:=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date;
BEGIN
 SELECT s.organization_id INTO org FROM public.org_staff s WHERE s.is_active AND s.organization_id IS NOT NULL AND public.aka_agent_staff_time_allowed(s.id) ORDER BY s.id LIMIT 1;
 IF org IS NULL THEN RAISE EXCEPTION 'v391 smoke requires an eligible organization'; END IF;
 INSERT INTO public.org_staff(id,organization_id,name,phone,username,password,is_active) OVERRIDING SYSTEM VALUE
 VALUES(sid,org,'__v391_rollback__','880039100000001','__v391_rollback__','__rollback_only__',true);
 INSERT INTO public.auto_accounts(id,name,flatform_type,status,login_status,is_active,staff_id,organization_id,is_delete,is_zalo_show_web,is_zalo_server) OVERRIDING SYSTEM VALUE
 VALUES(aid,'__v391_rollback__','facebook','chờ xử lý','đã đăng nhập',true,sid,org,false,false,false);
 INSERT INTO public.auto_campaigns(id,name,action_id,account_id,status,content,schedule,original_schedule,schedule_type,staff_id,organization_id,is_delete,data_target_source_mode)
 OVERRIDING SYSTEM VALUE VALUES(cid,'__v391_rollback__','facebook_group_post',aid,'chờ xử lý','',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute','daily',sid,org,false,'direct');
 INSERT INTO public.auto_campaign_input_data(id,campaign_id,name,uid,status,is_delete) OVERRIDING SYSTEM VALUE VALUES(iid,cid,'__v391_target__','fixture_not_a_real_target','chờ xử lý',false);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 EXECUTE 'SET LOCAL ROLE anon';
 cfg:='{"version":1,"revision":0,"rules":[{"campaignActionId":"facebook_group_post","quantity":1,"unit":"data"}]}'::jsonb;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'save',jsonb_build_object('config',cfg));
 IF r->'config'->>'revision'<>'1' THEN RAISE EXCEPTION 'v391 save revision'; END IF;
 BEGIN
   PERFORM public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'save',jsonb_build_object('config',cfg));
   RAISE EXCEPTION 'v391 CAS bypass';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'random_config_conflict' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.aka_agent_facebook_random_run(sid,org+10000000,'__v391_rollback__','__rollback_only__',aid,'get');
   RAISE EXCEPTION 'v391 tenant bypass';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.aka_agent_facebook_random_run(sid,org,NULL,NULL,aid,'get');
   RAISE EXCEPTION 'v391 missing auth bypass';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'toggle','{"enabled":true,"revision":1}');
 r:=public.aka_agent_desktop_account_snapshot(sid,org,'__v391_rollback__','__rollback_only__','{"facebookCore":true}');
 IF r->'states'->0->>'facebookRandomRunEnabled'<>'true' OR r->'states'->0->>'facebookRandomRunRevision'<>'1' THEN RAISE EXCEPTION 'v391 snapshot'; END IF;
 IF r::text LIKE '%"rules"%' THEN RAISE EXCEPTION 'v391 snapshot must not transfer rules'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'plan',jsonb_build_object('revision',1,'choices',jsonb_build_array(jsonb_build_object('ruleIndex',0,'campaignId',cid))));
 t:=r->'turns'->0;
 IF t IS NULL THEN RAISE EXCEPTION 'v391 plan missing (do not run within 23:59 cutoff)'; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_runtime_checked(cid,aid,sid,'desktop');
 IF result.reason<>'random_context_required' THEN RAISE EXCEPTION 'v391 old client bypass: %',result.reason; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'claim',jsonb_build_object('turnId',t->>'id','campaignId',cid,'claimToken',token));
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'v391 claim rejected: %',r->>'reason'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'claim',jsonb_build_object('turnId',t->>'id','campaignId',cid,'claimToken',token));
 IF r->>'reason'<>'already_claimed' THEN RAISE EXCEPTION 'v391 claim replay'; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_run_unit_v2(cid,aid,sid,'desktop',token,day,unit,ARRAY[iid]);
 IF NOT result.ok THEN RAISE EXCEPTION 'v391 unit rejected: %',result.reason; END IF;
 SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',gen_random_uuid(),false);
 IF result.ok THEN RAISE EXCEPTION 'v391 wrong token bypass'; END IF;
 UPDATE public.auto_campaign_input_data SET status='hoàn thành' WHERE id=iid;
 SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',unit,false);
 IF NOT result.ok THEN RAISE EXCEPTION 'v391 settle rejected: %',result.reason; END IF;
 SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',unit,false);
 IF NOT result.ok THEN RAISE EXCEPTION 'v391 settle replay rejected'; END IF;
 r:=public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'day',jsonb_build_object('date',day));
 IF r->'turns'->0->>'processed'<>'1' THEN RAISE EXCEPTION 'v391 progress duplicate'; END IF;
 IF r::text LIKE '%claimToken%' THEN RAISE EXCEPTION 'v391 token exposed to UI'; END IF;
 SELECT * INTO result FROM public.aka_agent_claim_campaign_run_unit_v2(cid,aid,sid,'desktop',token,day,gen_random_uuid(),ARRAY[]::bigint[]);
 -- An empty data unit is materialization and has no target budget, but cannot execute more objects.
 IF result.ok THEN
   SELECT * INTO result FROM public.aka_agent_settle_campaign_run_unit_v2(cid,aid,sid,'desktop',result.runtime_unit_token,false);
 END IF;
 UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=cid;
 UPDATE public.auto_accounts SET status='chờ xử lý',runtime_operation_claim_token=NULL WHERE id=aid;
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v391_rollback__','__rollback_only__',aid,'finish',jsonb_build_object('turnId',t->>'id','claimToken',token));
 BEGIN
   EXECUTE 'SELECT id FROM public.auto_account_random_run_days LIMIT 1';
   RAISE EXCEPTION 'v391 direct history read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
END $test$;
SELECT 'PASS v391 rollback: real anon role, auth/tenant/CAS, snapshot, old-client guard, claim replay, unit ownership, atomic progress and RLS' AS result;
ROLLBACK;
