BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF has_table_privilege('aka_agent_chat_api','public.auto_account_actions','SELECT') OR EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='auto_account_actions' AND grantee='aka_agent_chat_api') THEN RAISE EXCEPTION 'v364 prior column grants drift'; END IF;
 IF (SELECT relrowsecurity FROM pg_class WHERE oid='public.auto_account_actions'::regclass) THEN RAISE EXCEPTION 'v364 catalog security drift'; END IF;
END $$;
GRANT SELECT(code,is_active,is_delete) ON public.auto_account_actions TO aka_agent_chat_api;
COMMIT;
