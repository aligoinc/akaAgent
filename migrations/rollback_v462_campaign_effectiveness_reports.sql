-- Rollback V462: drops only the two functions added by V462. No data is touched.
-- WebApp API and Desktop treat a missing function as "đang được cập nhật" and hide the new reports.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_read_campaign_effectiveness(bigint,bigint,text,text,jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_effectiveness_scope(bigint,bigint,bigint[],text[],bigint[],timestamptz,timestamptz,text[],text[],text[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
