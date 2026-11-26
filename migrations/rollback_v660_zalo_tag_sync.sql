-- Gỡ V660 (sổ tag Zalo). Xoá cả sổ tag và dấu "đã thêm"; data đã thêm vào chiến dịch giữ nguyên.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-zalo-tag-sync-retention') THEN
      PERFORM cron.unschedule('aka-agent-zalo-tag-sync-retention');
    END IF;
  END IF;
END
$cron$;
DROP TRIGGER IF EXISTS trg_aka_agent_zalo_tag_sync_campaign ON public.auto_campaigns;
DROP FUNCTION IF EXISTS public.aka_agent_control_set_campaign_zalo_tag_auto_add(bigint, bigint, bigint, boolean);
DROP FUNCTION IF EXISTS public.aka_agent_desktop_set_campaign_zalo_tag_auto_add(bigint, boolean);
DROP FUNCTION IF EXISTS public.aka_agent_desktop_sync_zalo_tags(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_sync_zalo_tags(text, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_desktop_zalo_tag_sync_accounts();
DROP FUNCTION IF EXISTS public.aka_agent_zalo_tag_sync_accounts(text, bigint[]);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_sync_retention();
DROP FUNCTION IF EXISTS private.aka_agent_set_campaign_zalo_tag_auto_add_core(bigint, bigint, bigint, boolean);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_sync_core(text, bigint, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_auto_add(bigint, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_sync_watched(jsonb, text, bigint, bigint[]);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_sync_campaign_trigger();
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_sync_campaign_tags(text, boolean, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_sync_org_covered(jsonb, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_tag_sync_config();
DROP TABLE IF EXISTS public.auto_zalo_tag_sync_resets, public.auto_campaign_zalo_tag_adds, public.auto_zalo_tag_sync_campaigns,
  public.auto_zalo_tag_member_events, public.auto_zalo_tag_members, public.auto_zalo_tag_sync_accounts;
DELETE FROM public.auto_system_settings WHERE key LIKE 'zalo.tag_sync.%';
COMMIT;
