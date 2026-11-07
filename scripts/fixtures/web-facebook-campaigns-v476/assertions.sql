-- Kiểm chứng V476 trên dữ liệu giả lập seed.sql. Chạy trong BEGIN ... ROLLBACK để chạy lại được.
BEGIN;
DO $test$
DECLARE
  v jsonb; ids bigint[]; r record; t text; n bigint; s uuid;
  fb text[] := ARRAY['facebook'];
  all_scopes text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook'];
  day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
  SET LOCAL ROLE service_role;
  -- A. Trang chiến dịch: token 'facebook' mở chiến dịch Facebook, nơi chạy luôn là Desktop.
  v := aka_agent_control_campaign_page(201, 20, fb);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3005,3006,3007,3008,3009,3010,3012,3013]::bigint[], 'facebook page ' || ids::text;
  ASSERT (v->>'campaignTotal')::integer = 8, 'facebook total';
  ASSERT (SELECT bool_and(x->>'platform' = 'facebook' AND NOT (x->>'isZaloServer')::boolean AND NOT (x->>'isZaloShowWeb')::boolean)
    FROM jsonb_array_elements(v->'items') x), 'facebook summary flags';
  ASSERT (SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) FROM jsonb_array_elements(v->'items') x
    WHERE (x->>'runtimeBusy')::boolean) = ARRAY[3006,3007]::bigint[], 'runtimeBusy from claim/unit lease';
  v := aka_agent_control_campaign_page(201, 20, all_scopes);
  ASSERT (v->>'campaignTotal')::integer = 12, 'zalo/sms + facebook total ' || (v->>'campaignTotal');
  v := aka_agent_control_campaign_page(201, 20, all_scopes, '{"runtimeTargets":["desktop"]}');
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3002,3003,3005,3006,3007,3008,3009,3010,3012,3013]::bigint[], 'desktop runtime includes facebook ' || ids::text;
  v := aka_agent_control_campaign_page(201, 20, all_scopes, '{"runtimeTargets":["web"]}');
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3001,3004]::bigint[], 'web runtime excludes facebook ' || ids::text;
  v := aka_agent_control_campaign_page(201, 20, all_scopes, '{"platforms":["facebook"],"statuses":["tạm dừng"]}');
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3007,3008,3009,3010]::bigint[], 'platform + status filter ' || ids::text;
  v := aka_agent_control_campaign_page(201, 20, all_scopes, '{}', p_selection => true);
  ASSERT jsonb_array_length(v->'items') = 12, 'selection includes facebook';
  v := aka_agent_control_campaign_page(201, 20, fb, '{}', 1, '[]', 3006);
  ASSERT v->'selected'->>'platform' = 'facebook' AND (v->'selected'->>'runtimeBusy')::boolean, 'selected facebook campaign';
  v := aka_agent_control_campaign_page(201, 20, ARRAY['zalo','sms','zalo_qr','zalo_web'], '{}', 1, '[]', 3006);
  ASSERT v->'selected' = 'null'::jsonb, 'facebook selected needs token';
  v := aka_agent_control_campaign_page(211, 21, fb);
  SELECT array_agg((x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3101]::bigint[], 'facebook-only org page';
  v := aka_agent_control_campaign_page(202, 20, fb);
  SELECT array_agg((x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3021]::bigint[], 'staff isolation';

  -- B. Snapshot tài khoản: tài khoản Facebook chưa xoá, trạng thái app Desktop, chiến dịch đang chạy.
  v := aka_agent_control_account_snapshot(201, 20, fb);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[2005,2006,2008,2009]::bigint[], 'facebook accounts ' || ids::text;
  ASSERT (v->'desktopPresence'->>'online')::boolean AND v->'desktopPresence'->>'appVersion' = '9.4.0', 'presence with facebook token';
  ASSERT (SELECT array_agg((x->>'id')::bigint) FROM jsonb_array_elements(v->'runningCampaigns') x) = ARRAY[3006]::bigint[], 'running facebook';
  SELECT x INTO v FROM jsonb_array_elements(v->'items') x WHERE (x->>'id')::bigint = 2006;
  ASSERT v->'metadata'->>'flatform_type' = 'facebook' AND v->'state'->>'login_status' = 'checkpoint'
    AND (v->'state'->>'has_zalo_session')::boolean IS FALSE, 'checkpoint account state';
  v := aka_agent_control_account_snapshot(201, 20, fb);
  ASSERT (SELECT x->'metadata'->'username' FROM jsonb_array_elements(v->'items') x WHERE (x->>'id')::bigint = 2005) = 'null'::jsonb,
    'facebook login name hidden';
  v := aka_agent_control_account_snapshot(201, 20, ARRAY['zalo','sms','zalo_qr','zalo_web']);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE x->'metadata'->>'flatform_type' = 'facebook'), 'no token no facebook';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'runningCampaigns') x WHERE (x->>'id')::bigint = 3006), 'no token no running fb';
  v := aka_agent_control_account_snapshot(201, 20, ARRAY['sms','facebook'], 'campaigns', ARRAY[2005,2004]::bigint[]);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'catalog') x;
  ASSERT ids = ARRAY[2004,2005,2006,2008,2009]::bigint[], 'campaign catalog ' || ids::text;
  ASSERT (SELECT bool_and(x->>'platform' = 'facebook' AND NOT (x->>'isZaloServer')::boolean AND NOT (x->>'isZaloShowWeb')::boolean)
    FROM jsonb_array_elements(v->'catalog') x WHERE (x->>'id')::bigint <> 2004), 'catalog facebook flags';
  ASSERT jsonb_typeof(v->'desktopPresence') = 'object', 'campaign view presence';
  v := aka_agent_control_account_snapshot(201, 20, ARRAY['sms'], 'campaigns', ARRAY[2005,2004]::bigint[]);
  ASSERT v->'desktopPresence' = 'null'::jsonb AND jsonb_array_length(v->'catalog') = 1, 'sms only unchanged';
  v := aka_agent_control_account_snapshot(201, 20, fb, 'details', ARRAY[2005]::bigint[]);
  ASSERT jsonb_array_length(v->'items') = 1 AND v->'items'->0->'state' ? 'zalo_session_last_error'
    AND v->'desktopPresence' = 'null'::jsonb, 'details view';
  v := aka_agent_control_account_snapshot(211, 21, fb);
  ASSERT jsonb_array_length(v->'items') = 1 AND v->'desktopPresence'->>'deviceLabel' = 'Mac - FB', 'facebook-only org snapshot';

  -- C. Tiến trình Desktop: dòng Facebook trả accountType 'facebook'.
  v := aka_agent_control_desktop_activity(201, 20, fb);
  ASSERT (SELECT array_agg((x->>'campaignId')::bigint ORDER BY (x->>'id')::bigint) FROM jsonb_array_elements(v->'items') x)
    = ARRAY[3005,3006]::bigint[], 'facebook activity ' || v::text;
  ASSERT (SELECT bool_and(x->>'accountType' = 'facebook' AND x->>'accountName' = 'FB chính') FROM jsonb_array_elements(v->'items') x), 'account type';
  v := aka_agent_control_desktop_activity(201, 20, all_scopes);
  ASSERT (SELECT string_agg(x->>'accountType', ',' ORDER BY (x->>'id')::bigint) FROM jsonb_array_elements(v->'items') x)
    = 'zalo_qr,zalo_browser,facebook,facebook', 'mixed activity ' || v::text;
  n := (v->>'cursor')::bigint;
  v := aka_agent_control_desktop_activity(201, 20, fb, n);
  ASSERT jsonb_array_length(v->'items') = 0 AND (v->>'cursor')::bigint = n, 'cursor excludes old rows';
  v := aka_agent_control_desktop_activity(202, 20, fb);
  ASSERT (SELECT array_agg((x->>'campaignId')::bigint) FROM jsonb_array_elements(v->'items') x) = ARRAY[3021]::bigint[], 'activity staff isolation';
  v := aka_agent_control_desktop_activity(201, 20, ARRAY['zalo','sms']);
  ASSERT jsonb_array_length(v->'items') = 0, 'legacy scope still empty';
  ASSERT aka_agent_control_campaign_logs(201, 20, 3005, fb, '{}'::jsonb) IS NOT NULL, 'history reader already accepts facebook';
  RESET ROLE;

  -- D. Dừng/tiếp tục chiến dịch Facebook: cùng luật Zalo Desktop.
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3005, 'tạm dừng');
  ASSERT r.ok AND r.reason = 'updated' AND NOT r.pause_pending AND r.campaign_status = 'tạm dừng', 'pause idle facebook';
  SELECT log INTO t FROM auto_campaign_logs WHERE campaign_id = 3005 ORDER BY id DESC LIMIT 1;
  ASSERT t ~ '^\d{2}:\d{2}:\d{2} \d{2}/\d{2}/\d{4} - FB chính - CD FB group - ⏸ Đã tạm dừng chiến dịch từ Web\.$', 'pause log: ' || t;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3005, 'tạm dừng');
  ASSERT r.ok AND r.reason = 'already_target', 'pause idempotent';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3005, 'chờ xử lý');
  ASSERT r.ok AND r.reason = 'updated' AND r.campaign_status = 'chờ xử lý', 'resume idle facebook';
  SELECT log INTO t FROM auto_campaign_logs WHERE campaign_id = 3005 ORDER BY id DESC LIMIT 1;
  ASSERT t LIKE '% - FB chính - CD FB group - ▶️ Đã tiếp tục chiến dịch từ Web. App Desktop sẽ chạy khi đến lịch.', 'resume log: ' || t;
  SELECT runtime_unit_token INTO s FROM auto_campaigns WHERE id = 3006;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3006, 'tạm dừng');
  ASSERT r.ok AND r.reason = 'updated' AND r.pause_pending, 'pause running facebook is boundary request';
  ASSERT (SELECT status = 'tạm dừng' AND runtime_claim_token IS NULL AND runtime_unit_token = s FROM auto_campaigns WHERE id = 3006),
    'claim cleared by trigger, unit lease untouched';
  ASSERT (SELECT log LIKE '%⏸ Đã yêu cầu tạm dừng từ Web. App Desktop sẽ dừng sau mục tiêu đang xử lý.'
    FROM auto_campaign_logs WHERE campaign_id = 3006 ORDER BY id DESC LIMIT 1), 'pending log';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3006, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'runtime_busy' AND r.pause_pending, 'resume waits for unit lease';
  UPDATE auto_campaigns SET runtime_unit_token = NULL WHERE id = 3006;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3006, 'chờ xử lý');
  ASSERT r.ok AND r.campaign_status = 'chờ xử lý', 'resume after lease released';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3007, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'runtime_busy', 'paused with orphan unit lease';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3009, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'account_deleted', 'deleted facebook account';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3010, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'account_inactive', 'inactive facebook account';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3013, 'tạm dừng');
  ASSERT NOT r.ok AND r.reason = 'invalid_transition', 'completed campaign';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3011, 'tạm dừng');
  ASSERT NOT r.ok AND r.reason = 'not_found', 'deleted campaign';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3021, 'tạm dừng');
  ASSERT NOT r.ok AND r.reason = 'not_found', 'other staff campaign';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(201, 20, 3012, 'tạm dừng');
  ASSERT r.ok AND r.reason = 'updated', 'facebook routed regardless of zalo flags';

  -- E. Xoá chiến dịch Facebook: chặn khi app còn giữ lượt (claim/unit lease) hoặc đang chạy.
  UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 3006;
  v := delete_control_campaign_atomic(201, 20, 3006);
  ASSERT v->>'reason' = 'campaign_running', 'running facebook not deleted';
  v := delete_control_campaign_atomic(201, 20, 3007);
  ASSERT v->>'reason' = 'campaign_running', 'unit lease blocks delete';
  UPDATE auto_campaigns SET runtime_claim_token = gen_random_uuid() WHERE id = 3008;
  v := delete_control_campaign_atomic(201, 20, 3008);
  ASSERT v->>'reason' = 'campaign_running', 'claim blocks delete';
  v := delete_control_campaign_atomic(201, 20, 3005);
  ASSERT (v->>'deleted')::boolean AND (SELECT is_delete FROM auto_campaigns WHERE id = 3005), 'idle facebook deleted';
  v := delete_control_campaign_atomic(201, 20, 3021);
  ASSERT v->>'reason' = 'not_found', 'other staff not deleted';
  v := delete_control_campaign_atomic(201, 20, 3011);
  ASSERT v->>'reason' = 'not_found', 'already deleted';

  -- F. Đường ghi khác vẫn từ chối Facebook (không mở trong V476).
  v := update_control_campaign_input_statuses_atomic(201, 20, 3012, ARRAY[30051]::bigint[], 'chờ xử lý', NULL);
  ASSERT v->>'reason' = 'invalid_owner' AND NOT (v->>'updated')::boolean, 'input status still blocked ' || v::text;
  v := update_control_campaign_atomic(201, 20, 3010, (SELECT updated_at FROM auto_campaigns WHERE id = 3010), '{"name":"x"}');
  ASSERT v->>'reason' = 'not_found', 'update still blocked ' || v::text;
  v := add_control_campaign_input_rows(201, 20, 3010, 'ap-fb', 0, '[{"uid":"https://www.facebook.com/groups/1"}]', now(), 'tạm dừng');
  ASSERT v->>'reason' = 'not_found', 'append still blocked ' || v::text;
  BEGIN
    PERFORM create_control_campaign_v2(201, 20, 'k-fb', '{"accountId":2005,"actionId":"facebook_group_post","name":"x"}', '[]', 'tạm dừng');
    RAISE EXCEPTION 'facebook create accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS t = MESSAGE_TEXT;
    ASSERT t = 'control_account_not_found', 'create still blocked: ' || t;
  END;

  -- G. Xác thực phiên: quyền Facebook theo gói 3/10 còn hạn theo ngày Việt Nam; chính sách mặc định tắt.
  v := aka_agent_authenticate_control_session('h-201-web');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'facebook')::boolean, 'facebook capability ' || v::text;
  ASSERT v->'web_facebook_campaigns' = '{"enabled":false,"facebookOnlyLogin":false}'::jsonb, 'default policy off';
  ASSERT v ? 'web_desktop_accounts' AND v ? 'zalo_package' AND v ? 'sms_package', 'existing keys kept';
  v := aka_agent_authenticate_control_session('h-211-web');
  ASSERT v->>'status' = 'capability_unavailable'
    AND (SELECT revoked_at IS NOT NULL FROM auto_control_sessions WHERE token_hash = 'h-211-web'), 'facebook-only blocked by default';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[21],"facebookOnlyLogin":true}' WHERE key = 'web.facebook_campaigns';
  v := aka_agent_authenticate_control_session('h-211-pwa');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'facebook')::boolean
    AND NOT (v->'capabilities'->>'zalo_server')::boolean AND NOT (v->'capabilities'->>'sms')::boolean
    AND NOT (v->'capabilities'->>'zalo_qr')::boolean, 'facebook-only pwa allowed ' || v::text;
  ASSERT v->'web_facebook_campaigns' = '{"enabled":true,"facebookOnlyLogin":true}'::jsonb, 'policy in payload';
  v := aka_agent_authenticate_control_session('h-211-native');
  ASSERT v->>'status' = 'authenticated', 'native included from the start';
  v := aka_agent_authenticate_control_session('h-211-other');
  ASSERT v->>'status' = 'capability_unavailable', 'other client types stay blocked';
  v := aka_agent_authenticate_control_session('h-201-web');
  ASSERT v->'web_facebook_campaigns' = '{"enabled":false,"facebookOnlyLogin":false}'::jsonb, 'allowlist excludes org 20';
  v := aka_agent_authenticate_control_session('h-231-web');
  ASSERT v->>'status' = 'capability_unavailable', 'fanpage org outside allowlist';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"facebookOnlyLogin":true}' WHERE key = 'web.facebook_campaigns';
  INSERT INTO auto_control_sessions(id, staff_id, organization_id, token_hash, client_type, expires_at) VALUES
    (gen_random_uuid(), 231, 23, 'h-231-web-2', 'web', now() + interval '1 day'),
    (gen_random_uuid(), 251, 25, 'h-251-web-2', 'web', now() + interval '1 day'),
    (gen_random_uuid(), 251, 25, 'h-251-web-3', 'web', now() + interval '1 day'),
    (gen_random_uuid(), 211, 21, 'h-211-web-2', 'web', now() + interval '1 day'),
    (gen_random_uuid(), 211, 21, 'h-211-web-3', 'web', now() + interval '1 day');
  v := aka_agent_authenticate_control_session('h-231-web-2');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'facebook')::boolean, 'fanpage valid until end of VN day ' || v::text;
  v := aka_agent_authenticate_control_session('h-221-web');
  ASSERT v->>'status' = 'capability_unavailable', 'expired yesterday';
  v := aka_agent_authenticate_control_session('h-241-web');
  ASSERT v->>'status' = 'capability_unavailable', 'deleted product';
  -- Ranh giới ngày Việt Nam trên tổ chức vẫn đăng nhập được nhờ gói khác.
  UPDATE org_organization_product SET expiration_date = day_start - interval '1 second' WHERE id = 2003;
  v := aka_agent_authenticate_control_session('h-201-native');
  ASSERT v->>'status' = 'authenticated' AND NOT (v->'capabilities'->>'facebook')::boolean, 'expired before VN day start';
  UPDATE org_organization_product SET expiration_date = day_start WHERE id = 2003;
  v := aka_agent_authenticate_control_session('h-201-native');
  ASSERT (v->'capabilities'->>'facebook')::boolean, 'valid at VN day start';
  -- Tổ chức Zalo Desktop + Facebook: mở bởi một trong hai chính sách.
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"desktopOnlyLogin":false}' WHERE key = 'web.desktop_accounts';
  v := aka_agent_authenticate_control_session('h-251-web-2');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'zalo_qr')::boolean, 'desktop off, facebook on';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"facebookOnlyLogin":false}' WHERE key = 'web.facebook_campaigns';
  v := aka_agent_authenticate_control_session('h-251-web-3');
  ASSERT v->>'status' = 'capability_unavailable', 'both login gates off';
  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"facebookOnlyLogin":true}' WHERE key = 'web.facebook_campaigns';
  v := aka_agent_authenticate_control_session('h-211-web-2');
  ASSERT v->>'status' = 'capability_unavailable', 'facebookOnlyLogin needs enabled';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[21],"facebookOnlyLogin":true}', is_active = false
  WHERE key = 'web.facebook_campaigns';
  v := aka_agent_authenticate_control_session('h-211-web-3');
  ASSERT v->>'status' = 'capability_unavailable', 'inactive setting closed';

  -- H. Chính sách lỗi luôn đóng.
  UPDATE auto_system_settings SET is_active = true, value = '{"enabled":true,"organizationIds":null,"facebookOnlyLogin":false}'
  WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(21) = '{"enabled":true,"facebookOnlyLogin":false}'::jsonb, 'all orgs';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(0) = '{"enabled":false,"facebookOnlyLogin":false}'::jsonb, 'invalid org';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(NULL) = '{"enabled":false,"facebookOnlyLogin":false}'::jsonb, 'null org';
  FOR t IN SELECT unnest(ARRAY['{bad json', '{"enabled":"yes"}', '[]', 'null', '{"enabled":true,"organizationIds":"21"}',
    '{"enabled":true,"organizationIds":{"21":true}}', '{"enabled":true,"organizationIds":["21"]}']) LOOP
    UPDATE auto_system_settings SET value = t WHERE key = 'web.facebook_campaigns';
    ASSERT aka_agent_control_web_facebook_campaigns_policy(21) = '{"enabled":false,"facebookOnlyLogin":false}'::jsonb, 'closed for ' || t;
  END LOOP;
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[21],"facebookOnlyLogin":"yes"}' WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(21) = '{"enabled":true,"facebookOnlyLogin":false}'::jsonb, 'non boolean login flag';
  UPDATE auto_system_settings SET is_secret = true WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(21)->>'enabled' = 'false', 'secret row ignored';
  DELETE FROM auto_system_settings WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(21)->>'enabled' = 'false', 'missing row closed';
  v := aka_agent_authenticate_control_session('h-201-native');
  ASSERT v->>'status' = 'authenticated' AND v->'web_facebook_campaigns' = '{"enabled":false,"facebookOnlyLogin":false}'::jsonb,
    'auth survives missing policy';

  -- I. Quyền hàm mới.
  ASSERT NOT has_function_privilege('anon', 'aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('aka_agent_desktop', 'aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('aka_agent_chat_api', 'aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'aka_agent_control_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'private.aka_agent_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'private.aka_agent_web_facebook_campaigns_policy(bigint)', 'EXECUTE');
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_web_facebook_campaigns_policy(bigint)'::regprocedure)
    = '{postgres=X/postgres}', 'private helper owner only';
  RAISE NOTICE 'v476 assertions passed';
END
$test$;
ROLLBACK;
