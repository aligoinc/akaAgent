-- Gỡ V672 (Bot sự kiện). Xoá cả quy tắc, việc, danh sách loại trừ của bot; trả private.aka_agent_zalo_tag_sync_watched về thân V660.
-- Không đụng sổ tag, chiến dịch, Nhóm data. Một giao dịch; DDL nên chạy buổi tối.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';

DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-event-bot-maintenance') THEN
      PERFORM cron.unschedule('aka-agent-event-bot-maintenance');
    END IF;
  END IF;
END
$cron$;

DROP TRIGGER IF EXISTS trg_aka_agent_event_bot_tag_events ON public.auto_zalo_tag_member_events;
DROP TRIGGER IF EXISTS trg_aka_agent_event_bot_group_origin_insert ON public.auto_account_contact_group_member_origins;
DROP TRIGGER IF EXISTS trg_aka_agent_event_bot_group_origin_update ON public.auto_account_contact_group_member_origins;

-- Thân V660 nguyên văn (md5 prosrc d21d55c1ea0d6396c6d16e39ca70ff2e). Phải chạy trước khi xoá bảng của bot.
CREATE OR REPLACE FUNCTION private.aka_agent_zalo_tag_sync_watched(p_config jsonb, p_source text, p_staff_id bigint, p_account_ids bigint[])
RETURNS TABLE (account_id bigint, organization_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT DISTINCT a.id::bigint, a.organization_id::bigint
  FROM public.auto_zalo_tag_sync_campaigns sc
  JOIN public.auto_accounts a ON a.id = sc.account_id
  WHERE (p_account_ids IS NULL OR sc.account_id = ANY (p_account_ids))
    AND (p_staff_id IS NULL OR sc.staff_id = p_staff_id)
    AND a.staff_id = sc.staff_id AND a.organization_id = sc.organization_id
    AND lower(btrim(COALESCE(a.flatform_type, ''))) = 'zalo'
    AND COALESCE(a.is_zalo_show_web, false) = false
    AND COALESCE(a.is_delete, false) = false
    AND CASE WHEN p_source = 'desktop' THEN COALESCE(a.is_zalo_server, false) = false
             ELSE COALESCE(a.is_zalo_server, false) = true END
    AND private.aka_agent_zalo_tag_sync_org_covered(p_config, a.organization_id::bigint);
$function$;

DROP FUNCTION IF EXISTS private.aka_agent_event_bot_save(bigint, bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_tag_watched(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_close_pending(bigint, text, bigint[]);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_rule_normalize(jsonb, integer, bigint, bigint, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_get(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_owned_account(bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_exclusions_json(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_account_json(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_int(jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_error_message(text);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_fail(text, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_maintenance();
DROP FUNCTION IF EXISTS public.aka_agent_desktop_event_bot_report_v1(bigint, uuid, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_desktop_event_bot_claim_v1(text, bigint[], integer);
DROP FUNCTION IF EXISTS public.aka_agent_desktop_event_bot_birthdays_v1(bigint, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_desktop_event_bot_sync_v1();
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_desktop_staff();
DROP FUNCTION IF EXISTS public.aka_agent_event_bot_report_v1(text, bigint, uuid, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_event_bot_claim_v1(text, text, bigint[], integer);
DROP FUNCTION IF EXISTS public.aka_agent_event_bot_birthdays_v1(text, bigint, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_event_bot_sync_v1(text, bigint[]);
DROP FUNCTION IF EXISTS public.aka_agent_control_event_bot(bigint, bigint, text, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_report_core(text, bigint, bigint, uuid, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_claim_core(text, bigint, text, bigint[], integer);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_birthdays_core(text, bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_runner_account(text, bigint, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_sync_core(text, bigint, bigint[]);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_group_trigger();
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_tag_trigger();
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_create_ctx(bigint, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_gap_hit(bigint, text, text, integer);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_blank(text);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_tag_alive(bigint, text);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_excluded(bigint, bigint[], text, text);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_norm_phone(text);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_runs_on(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_runtime_on(jsonb, text);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_access(bigint, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_event_bot_config();

DROP TABLE IF EXISTS public.auto_event_bot_jobs, public.auto_event_bot_exclusions, public.auto_event_bot_rules, public.auto_event_bot_settings;
DELETE FROM public.auto_system_settings WHERE key = 'event_bot';

DO $postflight$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('private.aka_agent_zalo_tag_sync_watched(jsonb,text,bigint,bigint[])'))
     IS DISTINCT FROM 'd21d55c1ea0d6396c6d16e39ca70ff2e' THEN
    RAISE EXCEPTION 'rollback v672: aka_agent_zalo_tag_sync_watched not restored to V660 body';
  END IF;
END
$postflight$;

-- Quyền của hàm V660 (CREATE OR REPLACE giữ quyền cũ; chép lại cho chắc).
REVOKE ALL ON FUNCTION private.aka_agent_zalo_tag_sync_watched(jsonb, text, bigint, bigint[]) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
