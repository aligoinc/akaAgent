-- Execute after v292 (or append inside a rollback-only validation transaction).
BEGIN;
SELECT set_config('aka_agent.account_log_smoke_account', (
    SELECT id::text FROM public.auto_accounts ORDER BY id LIMIT 1
), true);

DO $$
DECLARE r text;
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='auto_account_logs') <> 10 THEN
        RAISE EXCEPTION 'Expected exactly 10 columns';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.auto_account_logs'::regclass AND contype IN ('f','c'))
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.auto_account_logs'::regclass AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'No business FK, status CHECK, or user trigger is allowed';
    END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated','aka_agent_chat_api'] LOOP
        IF has_table_privilege(r,'public.auto_account_logs','SELECT')
           OR has_table_privilege(r,'public.auto_account_logs','UPDATE')
           OR has_table_privilege(r,'public.auto_account_logs','DELETE') THEN
            RAISE EXCEPTION 'Unexpected read/mutation privilege for %', r;
        END IF;
        IF NOT has_column_privilege(r,'public.auto_account_logs','message','INSERT') THEN
            RAISE EXCEPTION 'Missing append privilege for %', r;
        END IF;
    END LOOP;
END $$;

SET LOCAL ROLE anon;
INSERT INTO public.auto_account_logs (account_id, login_status, account_status, source, event_type, message)
VALUES (current_setting('aka_agent.account_log_smoke_account')::bigint,
    'future login state', 'future account state', 'future runtime', 'future event', 'rollback smoke');
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM public.auto_account_logs;
        RAISE EXCEPTION 'Client unexpectedly read logs';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.auto_account_logs (account_id,source,event_type,message)
        VALUES (-1,'test','test','invalid account');
        RAISE EXCEPTION 'Invalid account accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
RESET ROLE;

-- Management API role cannot SET ROLE aka_agent_chat_api. Its column ACLs
-- are asserted above; backend insertion is covered by the isolated transport tests.
ROLLBACK;
