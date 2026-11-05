-- Rollback V462: drops only the two functions added by V462. No data is touched.
-- Deploy a WebApp API without /reports/effectiveness/* (or accept its 503 fallback) first.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_read_campaign_effectiveness(bigint,bigint,jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_effectiveness_scope(bigint,bigint,bigint[],text[],bigint[],timestamptz,timestamptz,text[],text[],text[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
