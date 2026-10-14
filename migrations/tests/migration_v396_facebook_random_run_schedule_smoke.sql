-- Isolated uncommitted fixtures only: no Facebook executor and no customer row changes.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
 sid bigint:=880039500000001; aid bigint:=880039500000002; cid bigint:=880039500000003;
 org bigint; r jsonb; planned jsonb; item record; expected int; cases int:=0;
BEGIN
 IF timezone('Asia/Ho_Chi_Minh',clock_timestamp())::time>=time '23:59' THEN
   RAISE EXCEPTION 'v395 smoke cannot run within daily cutoff';
 END IF;
 SELECT s.organization_id INTO org FROM public.org_staff s
 WHERE s.is_active AND s.organization_id IS NOT NULL AND public.aka_agent_staff_time_allowed(s.id)
 ORDER BY s.id LIMIT 1;
 IF org IS NULL THEN RAISE EXCEPTION 'v395 smoke requires an eligible organization'; END IF;
 INSERT INTO public.org_staff(id,organization_id,name,phone,username,password,is_active) OVERRIDING SYSTEM VALUE
 VALUES(sid,org,'__v395_rollback__','880039500000001','__v395_rollback__','__rollback_only__',true);
 INSERT INTO public.auto_accounts(id,name,flatform_type,status,login_status,is_active,staff_id,organization_id,is_delete,is_zalo_show_web,is_zalo_server) OVERRIDING SYSTEM VALUE
 VALUES(aid,'__v395_rollback__','facebook','chờ xử lý','đã đăng nhập',true,sid,org,false,false,false);
 INSERT INTO public.auto_campaigns(id,name,action_id,account_id,status,content,schedule,original_schedule,schedule_type,staff_id,organization_id,is_delete,data_target_source_mode)
 OVERRIDING SYSTEM VALUE VALUES(cid,'__v395_rollback__','facebook_group_post',aid,'chờ xử lý','',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute','weekly',sid,org,false,'direct');
 PERFORM set_config('request.jwt.claim.role','anon',true);
 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v395_rollback__','__rollback_only__',aid,'save',
   '{"config":{"version":1,"revision":0,"rules":[{"campaignActionId":"facebook_group_post","quantity":1,"unit":"data"}]}}');
 PERFORM public.aka_agent_facebook_random_run(sid,org,'__v395_rollback__','__rollback_only__',aid,'toggle','{"enabled":true,"revision":1}');
 EXECUTE 'RESET ROLE';
 FOR item IN SELECT * FROM (VALUES
   ('direct_expired','direct',-2,false,false,false,false,false,1),
   ('direct_no_end','direct',NULL::int,false,false,false,false,false,1),
   ('group_expired','data_group',-2,false,false,false,false,false,0),
   ('group_future','data_group',2,false,false,false,false,false,1),
   ('group_no_end','data_group',NULL::int,false,false,false,false,false,1),
   ('future_start','direct',-2,true,false,false,false,false,0),
   ('past_daily_stop','direct',-2,false,true,false,false,false,0),
   ('paused','direct',-2,false,false,true,false,false,0),
   ('deleted','direct',-2,false,false,false,true,false,0),
   ('wrong_action','direct',-2,false,false,false,false,true,0)
 ) AS q(name,source_mode,end_days,future_start,past_stop,paused,deleted,wrong_action,expected) LOOP
   UPDATE public.auto_campaigns SET data_target_source_mode=item.source_mode,
     schedule_end_date=CASE WHEN item.end_days IS NULL THEN NULL ELSE clock_timestamp()+make_interval(days=>item.end_days) END,
     schedule=clock_timestamp()+CASE WHEN item.future_start THEN interval '1 day' ELSE interval '-1 minute' END,
     daily_stop_time=CASE WHEN item.past_stop THEN time '00:00' ELSE NULL END,
     status=CASE WHEN item.paused THEN 'tạm dừng' ELSE 'chờ xử lý' END,is_delete=item.deleted,
     action_id=CASE WHEN item.wrong_action THEN 'facebook_timeline_post' ELSE 'facebook_group_post' END
   WHERE id=cid;
   EXECUTE 'SET LOCAL ROLE anon';
   r:=public.aka_agent_facebook_random_run(sid,org,'__v395_rollback__','__rollback_only__',aid,'plan',
     jsonb_build_object('revision',1,'choices',jsonb_build_array(jsonb_build_object('ruleIndex',0,'campaignId',cid))));
   IF jsonb_array_length(r->'turns')<>item.expected THEN
     RAISE EXCEPTION 'v395 %: expected % turns, got %',item.name,item.expected,r->'turns';
   END IF;
   IF item.expected=1 THEN
     planned:=r->'turns'->0;
     IF (planned->>'campaignId')::bigint<>cid OR planned->>'ruleIndex'<>'0' THEN RAISE EXCEPTION 'v395 plan scope/order'; END IF;
     -- End only this unstarted fixture turn so the next case is freshly planned.
     PERFORM public.aka_agent_facebook_random_run(sid,org,'__v395_rollback__','__rollback_only__',aid,'finish',
       jsonb_build_object('turnId',planned->>'id','reason','fixture only'));
   END IF;
   EXECUTE 'RESET ROLE';
   cases:=cases+1;
 END LOOP;
 IF cases<>10 THEN RAISE EXCEPTION 'v395 missing schedule cases'; END IF;
END $test$;
SELECT 'PASS v395: 10 planner cases with actual anon role; direct/group end date, start time, daily cutoff, status/delete/action guards' AS result;
ROLLBACK;
