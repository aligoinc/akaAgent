-- Rollback V519: drop the read-only data group member lookup. No data is touched.
-- After this the WebApp API answers 503 data_group_matches_not_ready and the import window falls back to the
-- behaviour before V519 (no "Trong nhóm này" / "Với nhóm khách hàng khác" rows).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb);
NOTIFY pgrst, 'reload schema';
COMMIT;
