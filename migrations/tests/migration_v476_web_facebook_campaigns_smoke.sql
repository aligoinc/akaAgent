-- Kiểm chỉ đọc trên production sau khi apply v476. Chạy trong BEGIN ... ROLLBACK.
-- Không gọi hàm có ghi (xác thực, dừng/tiếp tục, xoá); không trả dữ liệu khách, chỉ so phạm vi đọc cũ/mới
-- trên vài nhân viên có tài khoản Facebook.
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE r record; legacy jsonb; mixed jsonb; fb jsonb; n integer := 0;
BEGIN
  ASSERT md5(pg_get_functiondef('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'::regprocedure))
    = '367cf7ba9d72aff72c4907586cf1c3ba', 'page target';
  ASSERT md5(pg_get_functiondef('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)'::regprocedure))
    = 'db8942b09904e535987b94745b159ca3', 'snapshot target';
  ASSERT md5(pg_get_functiondef('public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)'::regprocedure))
    = '6030f0d9c8429e36955a405920f751f9', 'activity target';
  ASSERT md5(pg_get_functiondef('public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)'::regprocedure))
    = '87f7002ac924f647896a7635663562b5', 'status target';
  ASSERT md5(pg_get_functiondef('public.delete_control_campaign_atomic(bigint,bigint,bigint)'::regprocedure))
    = '2af929cc5e02683e5e9dc16a48cc9bac', 'delete target';
  ASSERT md5(pg_get_functiondef('public.aka_agent_authenticate_control_session(text)'::regprocedure))
    = '692e2a068ce51377f6bd71fec20a8b0c', 'session target';
  FOR r IN
    SELECT a.staff_id, a.organization_id FROM public.auto_accounts a
    WHERE a.is_delete = false AND a.flatform_type = 'facebook'
    GROUP BY 1, 2 ORDER BY max(a.id) DESC LIMIT 5
  LOOP
    n := n + 1;
    legacy := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['zalo','sms','zalo_qr','zalo_web']);
    mixed := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['zalo','sms','zalo_qr','zalo_web','facebook']);
    fb := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['facebook']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(legacy->'items') x WHERE x->>'platform' = 'facebook'), 'legacy page has no facebook';
    ASSERT (mixed->>'campaignTotal')::integer = (legacy->>'campaignTotal')::integer + (fb->>'campaignTotal')::integer, 'page union';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(fb->'items') x WHERE x->>'platform' <> 'facebook'), 'facebook page only facebook';
    legacy := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, ARRAY['zalo','sms']);
    fb := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, ARRAY['facebook']);
    ASSERT legacy->'desktopPresence' = 'null'::jsonb, 'legacy snapshot has no presence';
    ASSERT jsonb_typeof(fb->'desktopPresence') = 'object', 'facebook snapshot has presence';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(legacy->'items') x WHERE x->'metadata'->>'flatform_type' = 'facebook'), 'legacy has no fb';
    ASSERT jsonb_array_length(fb->'items') > 0, 'facebook accounts listed';
    fb := public.aka_agent_control_desktop_activity(r.staff_id, r.organization_id, ARRAY['facebook']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(fb->'items') x WHERE x->>'accountType' <> 'facebook'), 'facebook activity only';
  END LOOP;
  ASSERT n > 0, 'requires staff with facebook accounts';
  ASSERT public.aka_agent_control_web_facebook_campaigns_policy(1) ? 'facebookOnlyLogin', 'policy readable';
  ASSERT NOT has_function_privilege('anon', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'private.aka_agent_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  RAISE NOTICE 'v476 production smoke passed for % staff', n;
END
$smoke$;
