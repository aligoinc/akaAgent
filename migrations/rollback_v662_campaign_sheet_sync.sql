-- Gỡ V662. Xoá nguồn đồng bộ và log; data đã thêm vào chiến dịch giữ nguyên. Hàm tick về đúng thân production đọc 26/11/2026.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.aka_agent_data_group_background_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  BEGIN PERFORM public.aka_agent_run_data_group_dynamic_filter_worker(5,100);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group dynamic filter worker failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_sheet_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group Sheet dispatch failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_notification_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Notification dispatch failed (%)',SQLSTATE; END;
END;
$function$;

DROP FUNCTION IF EXISTS public.aka_agent_campaign_sheet_sync(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_control_campaign_sheet_sync(bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_campaign_sheet_dispatch();
DROP FUNCTION IF EXISTS public.aka_agent_campaign_sheet_claim();
DROP FUNCTION IF EXISTS public.aka_agent_campaign_sheet_finish(uuid, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_sync_core(bigint, bigint, boolean, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_unmatched_keys(text, text, jsonb, bigint[], text[]);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_validate_config(jsonb, text);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_log(public.auto_campaign_sheet_syncs, text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_view(public.auto_campaign_sheet_syncs);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_campaign_issue(bigint, bigint, bigint, text);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_key(text, text, text, text, text);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_action_allowed(text);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_today();
DROP FUNCTION IF EXISTS private.aka_agent_campaign_sheet_setting();
DROP TABLE IF EXISTS public.auto_campaign_sheet_sync_logs;
DROP TABLE IF EXISTS public.auto_campaign_sheet_syncs;
DELETE FROM public.auto_system_settings WHERE key = 'campaign.sheet_sync';

COMMIT;
