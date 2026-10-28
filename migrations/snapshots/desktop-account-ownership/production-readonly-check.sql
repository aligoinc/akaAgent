BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE ownership_original_metadata AS SELECT md5(jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl::text,p.proowner) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','aka_agent_desktop_internal') AND p.prokind='f'),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN('public','private','aka_agent_desktop_internal')),'triggers',(SELECT jsonb_agg(jsonb_build_array(tgrelid,tgname,pg_get_triggerdef(oid),tgenabled) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal))::text);
CREATE FUNCTION pg_temp.ownership_fingerprint(p_staff bigint) RETURNS jsonb LANGUAGE sql AS $fn$
 SELECT jsonb_build_object('accounts',(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'')) FROM public.auto_accounts a WHERE staff_id=p_staff),
 'campaigns',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY id)::text,'')) FROM public.auto_campaigns c WHERE staff_id=p_staff),
 'input_sample',(SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'')) FROM (SELECT * FROM public.auto_campaign_input_data WHERE campaign_id IN(SELECT id FROM public.auto_campaigns WHERE staff_id=p_staff ORDER BY id LIMIT 3) ORDER BY id LIMIT 50) d));
$fn$;
CREATE TEMP TABLE ownership_canary AS SELECT u.staff_id,u.auth_user_id,pg_temp.ownership_fingerprint(u.staff_id) AS fingerprint FROM private.aka_agent_desktop_users u
 WHERE EXISTS(SELECT 1 FROM public.auto_accounts a WHERE a.staff_id=u.staff_id) ORDER BY u.staff_id LIMIT 3;
DO $check$ BEGIN IF (SELECT count(*) FROM ownership_canary)<2 THEN RAISE EXCEPTION 'not enough mapped production samples'; END IF; END $check$;
DO $check$
DECLARE s record; original_role text:=current_user; actual jsonb; visible_foreign bigint; rejected boolean;
BEGIN
 FOR s IN SELECT * FROM ownership_canary LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',s.auth_user_id)::text,true);
  EXECUTE 'SET LOCAL ROLE aka_agent_desktop';
  actual:=pg_temp.ownership_fingerprint(s.staff_id);
  IF actual IS DISTINCT FROM s.fingerprint THEN RAISE EXCEPTION 'own production rows changed'; END IF;
  SELECT count(*) INTO visible_foreign FROM public.auto_accounts WHERE staff_id<>s.staff_id;
  IF visible_foreign<>0 THEN RAISE EXCEPTION 'foreign account visible'; END IF;
  SELECT count(*) INTO visible_foreign FROM public.auto_campaigns WHERE staff_id<>s.staff_id;
  IF visible_foreign<>0 THEN RAISE EXCEPTION 'foreign campaign visible'; END IF;
  rejected:=false;
  BEGIN PERFORM private.aka_agent_assert_request_ownership(s.staff_id+10000000,NULL,NULL);
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'foreign staff guard failed'; END IF;
  EXECUTE format('SET LOCAL ROLE %I',original_role);
 END LOOP;
 EXECUTE 'SET LOCAL ROLE service_role';
 IF private.aka_agent_staff_scope_for_request() IS NOT NULL THEN RAISE EXCEPTION 'trusted backend affected'; END IF;
 EXECUTE format('SET LOCAL ROLE %I',original_role);
END $check$;

ROLLBACK; SELECT true AS production_readonly_check_passed;
