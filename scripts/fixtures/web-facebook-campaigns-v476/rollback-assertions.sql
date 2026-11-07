-- Sau rollback: 6 hàm về đúng baseline (md5 + ACL), hàm chính sách mới và khoá cấu hình đã gỡ.
\ir baseline-check.sql
DO $rollback$
BEGIN
  ASSERT to_regprocedure('public.aka_agent_control_web_facebook_campaigns_policy(bigint)') IS NULL, 'policy wrapper dropped';
  ASSERT to_regprocedure('private.aka_agent_web_facebook_campaigns_policy(bigint)') IS NULL, 'policy helper dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM auto_system_settings WHERE key = 'web.facebook_campaigns'), 'policy row removed';
  ASSERT EXISTS (SELECT 1 FROM auto_system_settings WHERE key = 'web.desktop_accounts'), 'V461 policy kept';
END
$rollback$;
