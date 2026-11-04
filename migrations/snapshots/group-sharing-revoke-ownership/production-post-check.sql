BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='0e17dec0570937cfea8a1ae035e2af4d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') AND md5(pg_get_functiondef(oid))='ca07284b7f0f0a3ab5a6ee7c8e745ab6' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','public.aka_agent_lock_campaign_input_serialization(bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') AND md5(pg_get_functiondef(oid))='f50796438b0e90ef184fa25cc4043e98' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_assert_request_ownership(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='31494192d0a18efeafa4fb0296008230' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.aka_agent_assert_request_ownership(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.aka_agent_staff_scope_for_request()'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='c47165554f49d3099d1f95e7d136eae5' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.can_read_data_group(bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='d173eaf22b0b6b6958a6f8f40cdaa82d' AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'sharing revoke target mismatch: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
END $guard$;
DO $behavior$
DECLARE u record; expected jsonb; actual jsonb; other_campaign bigint; denied boolean; users_checked integer:=0;
BEGIN
 IF has_function_privilege('anon','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'legacy sharing access reopened'; END IF;
 IF NOT has_function_privilege('aka_agent_desktop','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'required sharing access missing'; END IF;
 FOR u IN SELECT m.staff_id,m.auth_user_id,s.organization_id,s.username,s.password
 FROM private.aka_agent_desktop_users m JOIN public.org_staff s ON s.id=m.staff_id
 WHERE s.is_active AND s.deleted_at IS NULL AND public.aka_agent_staff_time_allowed(s.id)
 ORDER BY m.staff_id LIMIT 6 LOOP
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',COALESCE(NULLIF(s.name,''),'Nhân viên #'||s.id)) ORDER BY s.name,s.id),'[]'::jsonb) INTO expected FROM public.org_staff s WHERE s.organization_id=u.organization_id AND s.deleted_at IS NULL AND s.is_active AND s.id<>u.staff_id;
  SELECT id INTO other_campaign FROM public.auto_campaigns WHERE staff_id IS DISTINCT FROM u.staff_id ORDER BY id LIMIT 1;
  IF other_campaign IS NULL THEN RAISE EXCEPTION 'foreign campaign sample missing'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',u.auth_user_id)::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  IF private.aka_agent_staff_scope_for_request() IS DISTINCT FROM u.staff_id THEN RAISE EXCEPTION 'staff binding mismatch'; END IF;
  actual:=public.aka_agent_group_sharing(u.staff_id,u.organization_id,u.username,u.password,'staff','{}');
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'sharing directory changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=other_campaign) THEN RAISE EXCEPTION 'foreign campaign exposed'; END IF;
  denied:=false;
  BEGIN PERFORM public.aka_agent_lock_campaign_input_serialization(other_campaign);
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM='desktop_campaign_scope_denied' THEN denied:=true; ELSE RAISE; END IF; END;
  IF NOT denied THEN RAISE EXCEPTION 'cross-staff lock guard failed'; END IF;
  denied:=false;
  BEGIN PERFORM public.aka_agent_group_sharing(u.staff_id+10000000,u.organization_id,'invalid','invalid','save','{}');
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='group_sharing_access_denied' THEN denied:=true; ELSE RAISE; END IF; END;
  IF NOT denied THEN RAISE EXCEPTION 'foreign sharing identity accepted'; END IF;
  RESET ROLE;
  users_checked:=users_checked+1;
 END LOOP;
 IF users_checked=0 THEN RAISE EXCEPTION 'active mapped users required'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE aka_agent_desktop;
 denied:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(-1,-1,'invalid','invalid','save','{}');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='group_sharing_access_denied' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'missing claims accepted'; END IF;
 RESET ROLE;
 SET LOCAL ROLE anon;
 denied:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(-1,-1,'invalid','invalid','save','{}');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'anon sharing allowed'; END IF;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 IF private.aka_agent_staff_scope_for_request() IS NOT NULL THEN RAISE EXCEPTION 'backend scope changed'; END IF;
 RESET ROLE;
END $behavior$;
ROLLBACK; SELECT true AS production_postcheck_passed;
