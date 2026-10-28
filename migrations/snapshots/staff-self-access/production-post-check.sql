BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='8s';
CREATE TEMP TABLE _staff_privacy_functions ON COMMIT DROP AS
 SELECT p.oid::regprocedure::text AS signature,md5(pg_get_functiondef(p.oid)) AS checksum,pg_get_userbyid(proowner) AS owner,proacl::text AS acl,proconfig,prosecdef,provolatile
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f';
CREATE TEMP TABLE _staff_privacy_relations ON COMMIT DROP AS
 SELECT c.oid,n.nspname,c.relname,c.relacl::text AS acl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,pg_get_userbyid(c.relowner) AS owner,
 CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal');
CREATE TEMP TABLE _staff_privacy_users ON COMMIT DROP AS
 SELECT m.staff_id,m.auth_user_id,to_jsonb(v) AS profile,public.get_staff_zalo_runtime_mode(s.id) AS runtime_mode,public.get_staff_zalo_account_capabilities(s.id) AS capabilities
 FROM private.aka_agent_desktop_users m JOIN public.org_staff s ON s.id=m.staff_id JOIN public.aka_agent_staff_runtime_profile v ON v.id=s.id
 WHERE s.is_active AND s.deleted_at IS NULL AND public.aka_agent_staff_time_allowed(s.id)
 ORDER BY (s.is_admin_akabiz IS TRUE) DESC,s.id LIMIT 6;
CREATE TEMP TABLE _staff_privacy_expected ON COMMIT DROP AS SELECT count(*) AS staff_count FROM public.org_staff;

DO $post$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.aka_agent_staff_scope_for_request()') AND md5(pg_get_functiondef(oid))='d417807fa9dc08cfecbd6cd0aab7df3e' AND proacl::text='{postgres=X/postgres,aka_agent_desktop=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','private.aka_agent_staff_scope_for_request()'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.group_access(text,bigint,bigint,bigint)') AND md5(pg_get_functiondef(oid))='d173eaf22b0b6b6958a6f8f40cdaa82d' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','private.group_access(text,bigint,bigint,bigint)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_cron(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='56a86a47ffa20258ea837b2a1289609c' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_cron(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_docs(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='1a760b48ffee2a75ae29f85c02ce5cb8' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_docs(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_notifications(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='ec4117c4cc813bf8fe926c21e7da3c8d' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_notifications(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_settings(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='6bdb2aebad3cd7a8b83ccfdba3e103c9' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_settings(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_admin_triggers(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='9f2b68cdb38f9e3209d32e1420af4b01' AND proacl::text='{postgres=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_admin_triggers(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='5bb87b66104f2dad716797e28cd6cccc' AND proacl::text='{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_management(bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='689c389e3380c75497c720e7e6c5dafb' AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_staff_management(bigint,text,text,text,jsonb)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)') AND md5(pg_get_functiondef(oid))='b24e654e7f7d3e840db80611affdaa43' AND proacl::text='{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_staff_runtime_scope(bigint,text)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') AND md5(pg_get_functiondef(oid))='7569f2b3816985cac48c114c891b5672' AND proacl::text='{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}' AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %','public.aka_agent_staff_time_allowed(bigint)'; END IF;
 IF pg_get_viewdef('public.aka_agent_staff_runtime_profile'::regclass,true) IS DISTINCT FROM ' SELECT id,
    organization_id,
    name,
    phone,
    username,
    is_active,
    is_admin,
    is_admin_akabiz,
    use_test_workflow,
    deleted_at,
    expiration_date,
    max_running_zalo_web_accounts,
    max_running_facebook_accounts
   FROM org_staff
  WHERE (( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request)) IS NULL OR id = (( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request));' THEN RAISE EXCEPTION 'staff self-access target view mismatch'; END IF;
END $post$;

DO $behavior$
DECLARE u record; v_count bigint; v_data jsonb; v_other bigint; v_name text; v_password text; v_org bigint; f record; v_denied boolean; total bigint;
BEGIN
 SELECT staff_count INTO total FROM _staff_privacy_expected;
 IF (SELECT count(*) FROM _staff_privacy_users)<2 THEN RAISE EXCEPTION 'need at least two mapped active users'; END IF;
 FOR u IN SELECT * FROM _staff_privacy_users LOOP
  SELECT id INTO v_other FROM public.org_staff WHERE id<>u.staff_id ORDER BY id LIMIT 1;
  SELECT username,password,organization_id INTO v_name,v_password,v_org FROM public.org_staff WHERE id=u.staff_id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',u.auth_user_id)::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  SELECT count(*) INTO v_count FROM public.aka_agent_staff_runtime_profile;
  IF v_count<>1 THEN RAISE EXCEPTION 'Desktop profile scope count mismatch'; END IF;
  SELECT to_jsonb(s) INTO v_data FROM public.aka_agent_staff_runtime_profile s WHERE id=u.staff_id;
  IF v_data IS DISTINCT FROM u.profile THEN RAISE EXCEPTION 'own profile mismatch'; END IF;
  SELECT to_jsonb(s) INTO v_data FROM public.aka_agent_staff_runtime_scope(u.staff_id,'share') s;
  IF v_data IS DISTINCT FROM u.profile THEN RAISE EXCEPTION 'own locked runtime mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_scope(v_other,'share')) OR EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_scope(v_other,'update')) OR public.aka_agent_staff_time_allowed(v_other) THEN RAISE EXCEPTION 'other staff runtime exposed'; END IF;
  IF NOT public.aka_agent_staff_time_allowed(u.staff_id) THEN RAISE EXCEPTION 'own time access blocked'; END IF;
  IF public.get_staff_zalo_runtime_mode(u.staff_id) IS DISTINCT FROM u.runtime_mode OR public.get_staff_zalo_account_capabilities(u.staff_id) IS DISTINCT FROM u.capabilities THEN RAISE EXCEPTION 'own capability mismatch'; END IF;
  IF public.aka_agent_group_sharing(u.staff_id,v_org,v_name,v_password,'staff','{}') IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'recipient list exposed'; END IF;
  v_denied:=false;
  BEGIN PERFORM public.aka_agent_staff_management(u.staff_id,v_name,v_password,'list','{}'); EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'admin RPC was not blocked'; END IF;
  RESET ROLE;
 END LOOP;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE aka_agent_desktop;
 IF EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_profile) THEN RAISE EXCEPTION 'missing claims leaked profile'; END IF;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 SELECT count(*) INTO v_count FROM public.aka_agent_staff_runtime_profile;
 IF v_count<>total THEN RAISE EXCEPTION 'backend scope changed'; END IF;
 RESET ROLE;
 FOR f IN SELECT * FROM _staff_privacy_functions LOOP
  IF f.signature = ANY(ARRAY['private.group_access(text,bigint,bigint,bigint)','aka_agent_admin_cron(bigint,text,text,text,jsonb)','aka_agent_admin_docs(bigint,text,text,text,jsonb)','aka_agent_admin_notifications(bigint,text,text,text,jsonb)','aka_agent_admin_settings(bigint,text,text,text,jsonb)','aka_agent_admin_triggers(bigint,text,text,text,jsonb)','aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)','aka_agent_staff_management(bigint,text,text,text,jsonb)','aka_agent_staff_runtime_scope(bigint,text)','aka_agent_staff_time_allowed(bigint)']) THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND md5(pg_get_functiondef(oid))=f.checksum AND pg_get_userbyid(proowner)=f.owner AND proacl::text IS NOT DISTINCT FROM f.acl AND proconfig IS NOT DISTINCT FROM f.proconfig AND prosecdef=f.prosecdef AND provolatile=f.provolatile) THEN RAISE EXCEPTION 'unrelated function changed: %',f.signature; END IF;
 END LOOP;
 FOR f IN SELECT * FROM _staff_privacy_relations LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=f.oid AND c.relacl::text IS NOT DISTINCT FROM f.acl AND c.relrowsecurity=f.relrowsecurity AND c.relforcerowsecurity=f.relforcerowsecurity AND c.reloptions IS NOT DISTINCT FROM f.reloptions AND pg_get_userbyid(c.relowner)=f.owner AND (f.relname='aka_agent_staff_runtime_profile' OR f.definition IS NULL OR pg_get_viewdef(c.oid,true)=f.definition)) THEN RAISE EXCEPTION 'unrelated relation changed: %',f.relname; END IF;
 END LOOP;
END $behavior$;

ROLLBACK;
SELECT jsonb_build_object('status','passed','kind','production post-apply checks','at',clock_timestamp(),'business_rows_written',0) AS evidence;