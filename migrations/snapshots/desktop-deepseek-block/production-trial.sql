BEGIN;
-- Hide the single DeepSeek setting from Desktop without changing any setting values.
-- ALL also prevents renaming the hidden row to bypass the read restriction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE current_policies jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.auto_system_settings'::regclass
   AND relrowsecurity AND NOT relforcerowsecurity AND pg_get_userbyid(relowner)='postgres') THEN
   RAISE EXCEPTION 'deepseek settings relation drift';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aka_agent_desktop' AND NOT rolbypassrls AND NOT rolsuper) THEN
   RAISE EXCEPTION 'deepseek desktop role drift';
 END IF;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) INTO current_policies
 FROM pg_policies p WHERE schemaname='public' AND tablename='auto_system_settings';
 IF current_policies IS DISTINCT FROM '[{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_system_settings","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"SELECT","qual":"((key = ''desktop.updates.startup_prompt_max_version''::text) AND is_active AND (NOT is_secret))","roles":["anon"],"tablename":"auto_system_settings","permissive":"PERMISSIVE","policyname":"v435_legacy_update_prompt","schemaname":"public","with_check":null}]'::jsonb THEN
   RAISE EXCEPTION 'deepseek settings policy drift';
 END IF;
END;
$guard$;

CREATE POLICY desktop_block_deepseek_setting
 ON public.auto_system_settings
 AS RESTRICTIVE FOR ALL TO aka_agent_desktop
 USING (key IS DISTINCT FROM 'ai.deepseek.api_key')
 WITH CHECK (key IS DISTINCT FROM 'ai.deepseek.api_key');

DO $check$
BEGIN
 IF (SELECT to_jsonb(p) FROM pg_policies p WHERE schemaname='public'
   AND tablename='auto_system_settings' AND policyname='desktop_block_deepseek_setting')
   IS DISTINCT FROM '{"schemaname":"public","tablename":"auto_system_settings","policyname":"desktop_block_deepseek_setting","permissive":"RESTRICTIVE","roles":["aka_agent_desktop"],"cmd":"ALL","qual":"(key IS DISTINCT FROM ''ai.deepseek.api_key''::text)","with_check":"(key IS DISTINCT FROM ''ai.deepseek.api_key''::text)"}'::jsonb THEN
   RAISE EXCEPTION 'deepseek policy postcondition failed';
 END IF;
END;
$check$;
NOTIFY pgrst, 'reload schema';

DO $baseline$
BEGIN
 PERFORM set_config('aka_agent.deepseek_other_digest',
   (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb)::text)
    FROM public.auto_system_settings s WHERE key IS DISTINCT FROM 'ai.deepseek.api_key'),true);
 IF (SELECT count(value) FROM public.auto_system_settings WHERE key='ai.deepseek.api_key')<>1 THEN
   RAISE EXCEPTION 'expected one preserved DeepSeek value'; END IF;
END;
$baseline$;
SET LOCAL ROLE aka_agent_desktop;
DO $desktop$
BEGIN
 IF EXISTS (SELECT value FROM public.auto_system_settings WHERE key='ai.deepseek.api_key') THEN
   RAISE EXCEPTION 'Desktop can still see DeepSeek'; END IF;
 IF (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb)::text)
     FROM public.auto_system_settings s WHERE key IS DISTINCT FROM 'ai.deepseek.api_key')
     IS DISTINCT FROM current_setting('aka_agent.deepseek_other_digest') THEN
   RAISE EXCEPTION 'other settings changed for Desktop'; END IF;
 IF has_function_privilege(current_user,'public.aka_agent_admin_settings(bigint,text,text,text,jsonb)','EXECUTE')
   OR has_function_privilege(current_user,'public.get_unified_web_deepseek_key()','EXECUTE')
   OR has_column_privilege(current_user,'public.ai_model','api_key','SELECT') THEN
   RAISE EXCEPTION 'unexpected alternate key-read privilege'; END IF;
END;
$desktop$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $backend$
BEGIN
 IF (SELECT count(value) FROM public.auto_system_settings WHERE key='ai.deepseek.api_key')<>1 THEN
   RAISE EXCEPTION 'backend key access changed'; END IF;
END;
$backend$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $anon$
BEGIN
 IF (SELECT count(*) FROM public.auto_system_settings WHERE key='desktop.updates.startup_prompt_max_version'
   AND is_active AND NOT is_secret)<>1 THEN RAISE EXCEPTION 'legacy update setting missing'; END IF;
 IF EXISTS(SELECT value FROM public.auto_system_settings WHERE key='ai.deepseek.api_key') THEN
   RAISE EXCEPTION 'anon DeepSeek leak'; END IF;
 PERFORM public.aka_agent_desktop_startup_policy();
 PERFORM public.aka_agent_desktop_login_content();
END;
$anon$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $authenticated$
BEGIN
 BEGIN
  PERFORM value FROM public.auto_system_settings LIMIT 0;
  RAISE EXCEPTION 'authenticated settings unexpectedly accessible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END;
$authenticated$;
RESET ROLE;
-- Manual rollback only: this reopens Desktop access to the DeepSeek setting.
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF (SELECT to_jsonb(p) FROM pg_policies p WHERE schemaname='public'
   AND tablename='auto_system_settings' AND policyname='desktop_block_deepseek_setting')
   IS DISTINCT FROM '{"schemaname":"public","tablename":"auto_system_settings","policyname":"desktop_block_deepseek_setting","permissive":"RESTRICTIVE","roles":["aka_agent_desktop"],"cmd":"ALL","qual":"(key IS DISTINCT FROM ''ai.deepseek.api_key''::text)","with_check":"(key IS DISTINCT FROM ''ai.deepseek.api_key''::text)"}'::jsonb THEN
   RAISE EXCEPTION 'deepseek rollback policy drift';
 END IF;
END;
$guard$;
DROP POLICY desktop_block_deepseek_setting ON public.auto_system_settings;
NOTIFY pgrst, 'reload schema';

DO $restored$ BEGIN IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_system_settings')
 IS DISTINCT FROM '[{"cmd":"ALL","qual":"true","roles":["aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin"],"tablename":"auto_system_settings","permissive":"PERMISSIVE","policyname":"v435_existing_role_access","schemaname":"public","with_check":"true"},{"cmd":"SELECT","qual":"((key = ''desktop.updates.startup_prompt_max_version''::text) AND is_active AND (NOT is_secret))","roles":["anon"],"tablename":"auto_system_settings","permissive":"PERMISSIVE","policyname":"v435_legacy_update_prompt","schemaname":"public","with_check":null}]'::jsonb THEN RAISE EXCEPTION 'rollback did not restore source policies'; END IF; END $restored$;
ROLLBACK;
SELECT jsonb_build_object('status','passed','scope','rollback-only production trial','business_writes',0,'checked_roles',jsonb_build_array('aka_agent_desktop','service_role','anon','authenticated'),'secret_values_returned',false) AS evidence;
