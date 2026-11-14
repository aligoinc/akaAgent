-- Rollback V540: Desktop no longer executes the two V539 readers; service_role (WebApp API) keeps them.
-- Only the grants are revoked (no reload of the PostgREST schema cache). Desktop then keeps only "Tất cả" in the
-- "Hành động" filter of the "Kết quả chạy" tab (permission denied is mapped to "đang được cập nhật"); the results list
-- itself still reads v2 and every other tab keeps working.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb) FROM aka_agent_desktop;
DO $postflight$
BEGIN
  IF has_function_privilege('aka_agent_desktop',
      'public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop',
      'public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'v540_rollback_desktop_still_executes';
  END IF;
END
$postflight$;
COMMIT;
