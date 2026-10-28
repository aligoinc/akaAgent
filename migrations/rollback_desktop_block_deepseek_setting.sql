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
