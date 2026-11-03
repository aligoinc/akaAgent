-- Sau rollback: hàm về baseline (baseline-acl.sql đã kiểm md5), hàm mới/cột/khóa cấu hình đã gỡ.
DO $rollback$
BEGIN
  ASSERT to_regprocedure('public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)') IS NULL, 'status RPC dropped';
  ASSERT to_regprocedure('public.aka_agent_control_web_desktop_accounts_policy(bigint)') IS NULL, 'policy wrapper dropped';
  ASSERT to_regprocedure('private.aka_agent_web_desktop_accounts_policy(bigint)') IS NULL, 'policy helper dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auto_staff_device_presence'
    AND column_name IN ('runtime_state', 'runtime_state_at')), 'runtime columns dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM auto_system_settings WHERE key = 'web.desktop_accounts'), 'policy row removed';
  RAISE NOTICE 'v453 rollback assertions passed';
END
$rollback$;
