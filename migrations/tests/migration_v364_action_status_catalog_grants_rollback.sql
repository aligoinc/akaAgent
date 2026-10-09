BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='auto_account_actions' AND grantee='aka_agent_chat_api' AND privilege_type='SELECT') IS DISTINCT FROM ARRAY['code','is_active','is_delete'] THEN RAISE EXCEPTION 'v364 grants changed'; END IF;
END $$;
REVOKE SELECT(code,is_active,is_delete) ON public.auto_account_actions FROM aka_agent_chat_api;
-- Restore only after the new Chat writer is stopped/reverted; retain history.
COMMIT;
