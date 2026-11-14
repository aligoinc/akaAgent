-- Sau rollback: 11 hàm về đúng baseline (md5 + ACL), 12 hàm mới và khoá cấu hình Email đã gỡ.
\ir baseline-check.sql
DO $rollback$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['private.aka_agent_web_email_campaigns_policy(bigint)',
    'public.aka_agent_control_web_email_campaigns_policy(bigint)',
    'private.aka_agent_control_assert_campaign_inputs(text,jsonb)',
    'private.aka_agent_control_resolve_secondary_account(bigint,bigint,text,text,bigint,jsonb)',
    'private.aka_agent_control_normalize_email_session(jsonb,text)',
    'private.aka_agent_control_email_account_view(public.auto_accounts)',
    'public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)',
    'public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)',
    'public.delete_control_email_account_atomic(bigint,bigint,bigint)',
    'public.aka_agent_control_email_account_session(bigint,bigint,bigint)',
    'public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)',
    'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])'] LOOP
    ASSERT to_regprocedure(f) IS NULL, 'not dropped: ' || f;
  END LOOP;
  ASSERT NOT EXISTS (SELECT 1 FROM auto_system_settings WHERE key = 'web.email_campaigns'), 'email policy row removed';
  ASSERT EXISTS (SELECT 1 FROM auto_system_settings WHERE key = 'web.facebook_campaigns'), 'facebook policy kept';
  ASSERT (SELECT value FROM auto_system_settings WHERE key = 'web.facebook_campaigns')
    = '{"enabled":true,"organizationIds":[1],"facebookOnlyLogin":false}', 'facebook policy value untouched';
END
$rollback$;
