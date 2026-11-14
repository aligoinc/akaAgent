-- Rollback of migration_campaign_result_actions.sql: drops the two read-only functions. No data to clean up.
-- WebApp keeps working: "Tất cả" still reads v2; the action filter and the merged view report "đang được cập nhật".
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb);
COMMIT;
