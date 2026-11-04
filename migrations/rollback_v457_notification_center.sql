-- Manual rollback for V457; never run automatically or as part of deployment.
-- Trước tiên thử công tắc khẩn: UPDATE auto_system_settings SET value = 'false' WHERE key = 'notifications.enabled'
-- (dừng tạo/gửi ngay, giữ dữ liệu). Chỉ chạy file này khi có chỉ thị rollback rõ ràng.
-- Khôi phục hàm tick về định nghĩa trước V457 (873b2939cc09a51e0e9d71f685dfd0e0), gỡ trigger/hàm/bảng
-- mới, xóa khóa notifications.* và các cột quản trị đã thêm vào auto_email_notification_settings.
-- XÓA dữ liệu thông báo, lượt gửi, thiết bị và nhật ký nhóm. Hệ thống email cũ không bị đụng tới.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $v457_rollback_preflight$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_background_tick()'))) IS DISTINCT FROM '10a2465bf8273b269ed5123344cff4db' THEN
    RAISE EXCEPTION 'rollback v457: tick is not the V457 target definition';
  END IF;
  IF to_regclass('public.auto_notifications') IS NULL THEN RAISE EXCEPTION 'rollback v457: V457 not applied'; END IF;
END
$v457_rollback_preflight$;

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
END;
$function$;

DROP TRIGGER trg_aka_agent_notify_campaign_status ON public.auto_campaigns;
DROP TRIGGER trg_aka_agent_notify_account_status ON public.auto_accounts;
DROP TRIGGER trg_aka_agent_notify_session_revoked ON public.auto_control_sessions;
DROP TRIGGER trg_aka_agent_notification_settings_before ON public.auto_email_notification_settings;
DROP TRIGGER trg_aka_agent_notification_settings_after ON public.auto_email_notification_settings;

DO $v457_rollback_functions$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'aka_agent_notification%')
               OR (n.nspname = 'public' AND p.proname IN ('aka_agent_notification_dispatch', 'aka_agent_notification_worker',
                     'aka_agent_notification_snapshot', 'aka_agent_control_notification_center', 'aka_agent_notification_center'))
  LOOP
    EXECUTE format('DROP FUNCTION %s', f);
  END LOOP;
END
$v457_rollback_functions$;

DROP TABLE public.auto_notification_deliveries;
DROP TABLE public.auto_notification_devices;
DROP TABLE public.auto_notifications;
DROP TABLE public.auto_notification_subscriptions;
DROP TABLE public.auto_data_group_member_events;
DROP TABLE private.aka_agent_notification_dispatch_state;
DELETE FROM public.auto_system_settings WHERE key LIKE 'notifications.%';
ALTER TABLE public.auto_email_notification_settings
  DROP COLUMN push_enabled, DROP COLUMN revision, DROP COLUMN settings_version, DROP COLUMN timezone,
  DROP COLUMN verified_emails, DROP COLUMN hourly_push_cap, DROP COLUMN quiet_hours, DROP COLUMN updated_by_client;

DO $v457_rollback_postcheck$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_data_group_background_tick()'::regprocedure)) IS DISTINCT FROM '873b2939cc09a51e0e9d71f685dfd0e0' THEN
    RAISE EXCEPTION 'rollback v457: tick not restored';
  END IF;
END
$v457_rollback_postcheck$;

COMMIT;
