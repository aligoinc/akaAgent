-- Read-only production assertions sau khi apply v461. Chạy trong BEGIN ... ROLLBACK.
-- Không trả dữ liệu khách; chỉ so phạm vi đọc cũ/mới trên vài nhân viên có tài khoản Desktop.
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE r record; legacy jsonb; desktop jsonb; n integer := 0;
BEGIN
  ASSERT md5(pg_get_functiondef('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)'::regprocedure))
    = '6b148777006903e4830925c55616820b', 'snapshot target';
  ASSERT md5(pg_get_functiondef('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'::regprocedure))
    = 'a2bc3f7cae264e647ac576c9895e840f', 'page target';
  ASSERT md5(pg_get_functiondef('public.aka_agent_authenticate_control_session(text)'::regprocedure))
    = 'de8f93ee545bca94a199b2dffb9fe324', 'session target';
  ASSERT md5(pg_get_functiondef('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)'::regprocedure))
    = '478aa4281c683686437f31947bb760b1', 'presence target';
  FOR r IN
    SELECT DISTINCT a.staff_id, a.organization_id FROM public.auto_accounts a
    WHERE a.is_delete = false AND a.flatform_type = 'zalo' AND a.is_zalo_server = false
    ORDER BY a.staff_id DESC LIMIT 5
  LOOP
    n := n + 1;
    legacy := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, ARRAY['zalo','sms']);
    desktop := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, ARRAY['zalo','sms','zalo_qr','zalo_web']);
    ASSERT legacy->'desktopPresence' = 'null'::jsonb, 'legacy has no presence';
    ASSERT jsonb_typeof(desktop->'desktopPresence') = 'object', 'desktop presence object';
    ASSERT jsonb_array_length(desktop->'items') >= jsonb_array_length(legacy->'items'), 'desktop scope is a superset';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(legacy->'items') x
      WHERE (x->'metadata'->>'is_zalo_server')::boolean IS FALSE AND x->'metadata'->>'flatform_type' = 'zalo'), 'legacy stays Server-only';
    legacy := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['zalo','sms']);
    desktop := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['zalo','sms','zalo_qr','zalo_web']);
    ASSERT (desktop->>'campaignTotal')::integer >= (legacy->>'campaignTotal')::integer, 'page superset';
  END LOOP;
  ASSERT n > 0, 'requires staff with desktop accounts';
  ASSERT public.aka_agent_control_web_desktop_accounts_policy(1) ? 'enabled', 'policy readable';
  ASSERT NOT has_function_privilege('anon', 'public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE');
  ASSERT has_function_privilege('aka_agent_desktop', 'public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)', 'EXECUTE');
  RAISE NOTICE 'v461 production smoke passed for % staff', n;
END
$smoke$;
