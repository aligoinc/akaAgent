BEGIN READ ONLY;

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

ROLLBACK;
SELECT jsonb_build_object('status','passed','business_writes',0,'secret_values_returned',false) AS evidence;
