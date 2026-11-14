-- Kiểm chứng v530 trên dữ liệu giả lập seed.sql. Chạy trong BEGIN ... ROLLBACK để chạy lại được.
BEGIN;
CREATE OR REPLACE FUNCTION v530_test.expect_error(p_sql text, p_message text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_message text; v_detail text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_message IS DISTINCT FROM p_message OR (p_detail IS NOT NULL AND v_detail IS DISTINCT FROM p_detail) THEN
      RAISE EXCEPTION 'expected % (%), got % (%) for %', p_message, p_detail, v_message, v_detail, p_sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected % but call succeeded: %', p_message, p_sql;
END
$$;

DO $test$
DECLARE
  v jsonb; ids bigint[]; r record; t text; n bigint; ts timestamptz; acc jsonb;
  em text[] := ARRAY['email'];
  all_scopes text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook','email'];
  legacy_fb text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook'];
  closed_email constant jsonb := '{"enabled":false,"emailOnlyLogin":false,"authoring":{"enabled":false}}';
  closed_fb constant jsonb := '{"enabled":false,"facebookOnlyLogin":false,"authoring":{"enabled":false,"actionIds":[]}}';
  session_ok constant jsonb := '{"host":"smtp.gmail.com","port":587,"secure":false,"user":"u@example.test","pass":"pw-1","fromEmail":"u@example.test"}';
BEGIN
  -- A. Chính sách. Email mặc định tắt; JSON hỏng/sai kiểu/không active/secret/thiếu dòng đều đóng.
  ASSERT aka_agent_control_web_email_campaigns_policy(31) = closed_email, 'email policy default';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[31,30],"emailOnlyLogin":true,"authoring":{"enabled":true,"organizationIds":[31]}}'
  WHERE key = 'web.email_campaigns';
  ASSERT aka_agent_control_web_email_campaigns_policy(31) = '{"enabled":true,"emailOnlyLogin":true,"authoring":{"enabled":true}}'::jsonb, 'email 31';
  ASSERT aka_agent_control_web_email_campaigns_policy(30) = '{"enabled":true,"emailOnlyLogin":true,"authoring":{"enabled":false}}'::jsonb, 'email authoring org filter';
  ASSERT aka_agent_control_web_email_campaigns_policy(33) = closed_email, 'email org filter';
  ASSERT aka_agent_control_web_email_campaigns_policy(0) = closed_email AND aka_agent_control_web_email_campaigns_policy(NULL) = closed_email, 'email invalid org';
  FOR t IN SELECT unnest(ARRAY['{bad json', '{"enabled":"yes"}', '[]', 'null', '{"enabled":true,"organizationIds":"31"}',
    '{"enabled":true,"organizationIds":{"31":true}}', '{"enabled":true,"organizationIds":["31"]}']) LOOP
    UPDATE auto_system_settings SET value = t WHERE key = 'web.email_campaigns';
    ASSERT aka_agent_control_web_email_campaigns_policy(31) = closed_email, 'email closed for ' || t;
  END LOOP;
  FOR t IN SELECT unnest(ARRAY['{"enabled":true,"organizationIds":null,"emailOnlyLogin":"yes","authoring":{"enabled":"yes"}}',
    '{"enabled":true,"organizationIds":null,"authoring":[]}', '{"enabled":true,"organizationIds":null,"authoring":{"enabled":true,"organizationIds":"31"}}',
    '{"enabled":true,"organizationIds":null,"authoring":{"enabled":true,"organizationIds":["31"]}}', '{"enabled":true}']) LOOP
    UPDATE auto_system_settings SET value = t WHERE key = 'web.email_campaigns';
    ASSERT aka_agent_control_web_email_campaigns_policy(31) = '{"enabled":true,"emailOnlyLogin":false,"authoring":{"enabled":false}}'::jsonb,
      'email authoring closed for ' || t;
  END LOOP;
  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"emailOnlyLogin":true,"authoring":{"enabled":true}}' WHERE key = 'web.email_campaigns';
  ASSERT aka_agent_control_web_email_campaigns_policy(31) = closed_email, 'outer disabled closes all';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"emailOnlyLogin":false,"authoring":{"enabled":true,"organizationIds":null}}', is_secret = true
  WHERE key = 'web.email_campaigns';
  ASSERT aka_agent_control_web_email_campaigns_policy(31) = closed_email, 'secret row ignored';
  UPDATE auto_system_settings SET is_secret = false, is_active = false WHERE key = 'web.email_campaigns';
  ASSERT aka_agent_control_web_email_campaigns_policy(31) = closed_email, 'inactive row ignored';
  UPDATE auto_system_settings SET is_active = true WHERE key = 'web.email_campaigns';
  ASSERT aka_agent_control_web_email_campaigns_policy(31) = '{"enabled":true,"emailOnlyLogin":false,"authoring":{"enabled":true}}'::jsonb, 'all orgs';

  -- Facebook: nhánh authoring mới; phần cũ (enabled, facebookOnlyLogin) không đổi.
  ASSERT aka_agent_control_web_facebook_campaigns_policy(1) = '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":false,"actionIds":[]}}'::jsonb, 'fb production value';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(30) = closed_fb, 'fb org filter';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[30,34],"facebookOnlyLogin":true,"authoring":{"enabled":true,"organizationIds":null,"actionIds":null}}'
  WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(30) = '{"enabled":true,"facebookOnlyLogin":true,"authoring":{"enabled":true,"actionIds":null}}'::jsonb, 'fb authoring all types';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"facebookOnlyLogin":false,"authoring":{"enabled":true,"organizationIds":[34],"actionIds":["facebook_group_post","facebook_timeline_post"]}}'
  WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(34) = '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":true,"actionIds":["facebook_group_post","facebook_timeline_post"]}}'::jsonb,
    'fb authoring action list';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(30) = '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":false,"actionIds":[]}}'::jsonb, 'fb authoring org filter';
  FOR t IN SELECT unnest(ARRAY['{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":true,"actionIds":[]}}',
    '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":true,"actionIds":["facebook_group_post",1]}}',
    '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":true,"actionIds":[" "]}}',
    '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":true,"actionIds":"facebook_group_post"}}',
    '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":true,"organizationIds":"34"}}',
    '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":"true"}}', '{"enabled":true,"facebookOnlyLogin":false,"authoring":true}', '{"enabled":true,"facebookOnlyLogin":false}']) LOOP
    UPDATE auto_system_settings SET value = t WHERE key = 'web.facebook_campaigns';
    ASSERT aka_agent_control_web_facebook_campaigns_policy(34) = '{"enabled":true,"facebookOnlyLogin":false,"authoring":{"enabled":false,"actionIds":[]}}'::jsonb,
      'fb authoring closed for ' || t;
  END LOOP;
  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"facebookOnlyLogin":true,"authoring":{"enabled":true}}' WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(34) = closed_fb, 'fb outer disabled';
  UPDATE auto_system_settings SET value = '{bad' WHERE key = 'web.facebook_campaigns';
  ASSERT aka_agent_control_web_facebook_campaigns_policy(34) = closed_fb AND aka_agent_control_web_facebook_campaigns_policy(NULL) = closed_fb, 'fb garbled';
  DELETE FROM auto_system_settings WHERE key = 'web.email_campaigns';
  ASSERT aka_agent_control_web_email_campaigns_policy(31) = closed_email, 'missing row closed';
  INSERT INTO auto_system_settings(key, value) VALUES ('web.email_campaigns', '{"enabled":false,"organizationIds":null,"emailOnlyLogin":false,"authoring":{"enabled":false,"organizationIds":null}}');
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[1],"facebookOnlyLogin":false}' WHERE key = 'web.facebook_campaigns';

  -- B. Xác thực phiên: capabilities.email theo gói 13 còn hạn theo ngày Việt Nam; cổng emailOnlyLogin; cả bản chat_v2.
  v := aka_agent_authenticate_control_session('h-301-web');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'email')::boolean AND (v->'capabilities'->>'facebook')::boolean, 'email capability ' || v::text;
  ASSERT v->'web_email_campaigns' = closed_email AND v->'web_facebook_campaigns' = closed_fb, 'policies in payload ' || v::text;
  v := aka_agent_authenticate_control_session_chat_v2('h-301-native');
  ASSERT v->>'status' = 'authenticated' AND v->>'app_scope' = 'full' AND (v->'capabilities'->>'email')::boolean
    AND v->'web_email_campaigns' = closed_email, 'chat_v2 email capability ' || v::text;
  v := aka_agent_authenticate_control_session('h-341-web');
  ASSERT v->>'status' = 'capability_unavailable', 'facebook-only org still gated';
  v := aka_agent_authenticate_control_session('h-311-web');
  ASSERT v->>'status' = 'capability_unavailable'
    AND (SELECT revoked_at IS NOT NULL FROM auto_control_sessions WHERE token_hash = 'h-311-web'), 'email-only blocked by default';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[31,32,33],"emailOnlyLogin":true,"authoring":{"enabled":false}}' WHERE key = 'web.email_campaigns';
  v := aka_agent_authenticate_control_session('h-311-pwa');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'email')::boolean
    AND NOT (v->'capabilities'->>'zalo_server')::boolean AND NOT (v->'capabilities'->>'sms')::boolean
    AND NOT (v->'capabilities'->>'facebook')::boolean AND NOT (v->'capabilities'->>'zalo_qr')::boolean, 'email-only pwa ' || v::text;
  ASSERT v->'web_email_campaigns' = '{"enabled":true,"emailOnlyLogin":true,"authoring":{"enabled":false}}'::jsonb, 'email policy in payload';
  v := aka_agent_authenticate_control_session_chat_v2('h-311-native');
  ASSERT v->>'status' = 'authenticated' AND v->>'app_scope' = 'full', 'email-only native via chat_v2 ' || v::text;
  v := aka_agent_authenticate_control_session('h-311-other');
  ASSERT v->>'status' = 'capability_unavailable', 'other client types stay blocked';
  v := aka_agent_authenticate_control_session('h-321-web');
  ASSERT v->>'status' = 'capability_unavailable', 'email expired yesterday';
  v := aka_agent_authenticate_control_session('h-331-web');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'email')::boolean, 'email valid until VN day start ' || v::text;
  v := aka_agent_authenticate_control_session('h-351-web');
  ASSERT v->>'status' = 'capability_unavailable', 'allowlist excludes org 35';
  v := aka_agent_authenticate_control_session('h-304-web');
  ASSERT v->>'status' = 'invalid_staff', 'inactive staff';
  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"emailOnlyLogin":true}' WHERE key = 'web.email_campaigns';
  INSERT INTO auto_control_sessions(id, staff_id, organization_id, token_hash, client_type, expires_at) VALUES
    (gen_random_uuid(), 331, 33, 'h-331-web-2', 'web', now() + interval '1 day');
  v := aka_agent_authenticate_control_session('h-331-web-2');
  ASSERT v->>'status' = 'capability_unavailable', 'emailOnlyLogin needs enabled';
  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"emailOnlyLogin":false,"authoring":{"enabled":false,"organizationIds":null}}' WHERE key = 'web.email_campaigns';

  -- C. Đọc với token 'email': nơi chạy Desktop, tiến trình accountType 'email', presence.
  SET LOCAL ROLE service_role;
  v := aka_agent_control_campaign_page(301, 30, em);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[30008,30009,30018]::bigint[], 'email page ' || ids::text;
  ASSERT (SELECT bool_and(x->>'platform' = 'email' AND NOT (x->>'isZaloServer')::boolean AND NOT (x->>'isZaloShowWeb')::boolean)
    FROM jsonb_array_elements(v->'items') x), 'email summary flags';
  ASSERT (SELECT array_agg((x->>'id')::bigint) FROM jsonb_array_elements(v->'items') x WHERE (x->>'runtimeBusy')::boolean)
    = ARRAY[30009]::bigint[], 'email runtimeBusy';
  v := aka_agent_control_campaign_page(301, 30, all_scopes, '{"runtimeTargets":["desktop"],"platforms":["email"]}');
  ASSERT (v->>'campaignTotal')::integer = 3, 'email is desktop runtime';
  v := aka_agent_control_campaign_page(301, 30, all_scopes, '{"runtimeTargets":["web"]}');
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE x->>'platform' = 'email'), 'email not web runtime';
  v := aka_agent_control_campaign_page(301, 30, all_scopes);
  ASSERT (v->>'campaignTotal')::integer = (aka_agent_control_campaign_page(301, 30, legacy_fb)->>'campaignTotal')::integer + 3, 'union with legacy';
  v := aka_agent_control_campaign_page(301, 30, em, '{}', 1, '[]', 30008);
  ASSERT v->'selected'->>'platform' = 'email', 'selected email';
  v := aka_agent_control_campaign_page(301, 30, legacy_fb, '{}', 1, '[]', 30008);
  ASSERT v->'selected' = 'null'::jsonb, 'email selected needs token';
  v := aka_agent_control_campaign_page(311, 31, em);
  ASSERT (SELECT array_agg((x->>'id')::bigint) FROM jsonb_array_elements(v->'items') x) = ARRAY[31101]::bigint[], 'email-only org page';
  v := aka_agent_control_account_snapshot(301, 30, em);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3009,3010]::bigint[], 'email accounts ' || ids::text;
  ASSERT (v->'desktopPresence'->>'online')::boolean AND v->'desktopPresence'->>'appVersion' = '9.7.0', 'presence with email token';
  ASSERT (SELECT bool_and(x->'metadata'->'username' = 'null'::jsonb AND x->'metadata'->>'flatform_type' = 'email'
    AND (x->'state'->>'has_zalo_session')::boolean IS FALSE) FROM jsonb_array_elements(v->'items') x), 'email metadata has no login name';
  ASSERT NOT (v::text LIKE '%secret-old%'), 'snapshot never returns smtp password';
  v := aka_agent_control_account_snapshot(301, 30, ARRAY['sms','email'], 'campaigns', ARRAY[3009,3004]::bigint[]);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'catalog') x;
  ASSERT ids = ARRAY[3004,3009,3010]::bigint[] AND jsonb_typeof(v->'desktopPresence') = 'object', 'email catalog ' || ids::text;
  v := aka_agent_control_account_snapshot(301, 30, legacy_fb);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE x->'metadata'->>'flatform_type' = 'email'), 'no token no email';
  v := aka_agent_control_desktop_activity(301, 30, em);
  ASSERT (SELECT array_agg((x->>'campaignId')::bigint) FROM jsonb_array_elements(v->'items') x) = ARRAY[30008]::bigint[]
    AND (SELECT bool_and(x->>'accountType' = 'email') FROM jsonb_array_elements(v->'items') x), 'email activity ' || v::text;
  v := aka_agent_control_desktop_activity(301, 30, all_scopes);
  ASSERT (SELECT string_agg(x->>'accountType', ',' ORDER BY (x->>'id')::bigint) FROM jsonb_array_elements(v->'items') x)
    = 'zalo_qr,facebook,email', 'mixed activity ' || v::text;
  v := aka_agent_control_desktop_activity(301, 30, legacy_fb);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE x->>'accountType' = 'email'), 'legacy activity without email';
  v := aka_agent_control_campaign_logs(301, 30, 30008, em, '{}'::jsonb);
  ASSERT v IS NOT NULL AND v::text LIKE '%Đã gửi email%', 'history reader accepts email token';
  RESET ROLE;

  -- D. Dừng/tiếp tục, xoá chiến dịch Email: cùng luật Desktop.
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(301, 30, 30008, 'chờ xử lý');
  ASSERT r.ok AND r.reason = 'updated' AND r.campaign_status = 'chờ xử lý', 'resume email';
  SELECT log INTO t FROM auto_campaign_logs WHERE campaign_id = 30008 ORDER BY id DESC LIMIT 1;
  ASSERT t LIKE '% - Email chính - CD Email - ▶️ Đã tiếp tục chiến dịch từ Web. App Desktop sẽ chạy khi đến lịch.', 'resume log ' || t;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(301, 30, 30008, 'tạm dừng');
  ASSERT r.ok AND r.reason = 'updated' AND NOT r.pause_pending, 'pause email';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(301, 30, 30009, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'runtime_busy' AND r.pause_pending, 'email resume waits for lease';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(302, 30, 30008, 'tạm dừng');
  ASSERT NOT r.ok AND r.reason = 'not_found', 'email other staff';
  v := delete_control_campaign_atomic(301, 30, 30009);
  ASSERT v->>'reason' = 'campaign_running', 'email lease blocks delete';
  v := delete_control_campaign_atomic(302, 30, 30008);
  ASSERT v->>'reason' = 'not_found', 'email delete other staff';

  -- E. Tạo chiến dịch Facebook/Email (create_control_campaign_v2 → create_control_campaign).
  v := create_control_campaign_v2(301, 30, 'k-fb-1', '{"accountId":3005,"actionId":"facebook_group_post","name":" CD FB Web ","secondaryAccountId":3006,
    "schedule":"2026-11-20T02:00:00Z","content":"Bài","extraSettings":{"imageOption":"all","commentImages":[]},"images":[],"webCampaignForm":"form_1"}',
    '[{"uid":"https://www.facebook.com/groups/1","name":"Group 1"},{"uid":"123456","name":"Group 2"}]', 'tạm dừng');
  ASSERT (v->>'created')::boolean AND (v->>'input_count')::integer = 2, 'facebook created ' || v::text;
  n := (v->>'campaign_id')::bigint;
  ASSERT (SELECT c.secondary_account_id = 3006 AND c.status = 'tạm dừng' AND c.web_campaign_form = 'form_1' AND c.name = 'CD FB Web'
    AND c.action_id = 'facebook_group_post' AND c.extra_settings = '{"imageOption":"all","commentImages":[]}'::jsonb
    FROM auto_campaigns c WHERE c.id = n), 'facebook row';
  ASSERT (SELECT array_agg(i.uid ORDER BY i.id) FROM auto_campaign_input_data i WHERE i.campaign_id = n)
    = ARRAY['https://www.facebook.com/groups/1','123456'], 'facebook inputs';
  v := create_control_campaign_v2(301, 30, 'k-fb-1', '{"accountId":3005,"actionId":"facebook_group_post","name":"x"}', '[]', 'tạm dừng');
  ASSERT NOT (v->>'created')::boolean AND (v->>'campaign_id')::bigint = n AND (v->>'input_count')::integer = 2, 'facebook replay';
  v := create_control_campaign_v2(301, 30, 'k-fb-2', '{"accountId":3005,"actionId":"facebook_timeline_post","name":"Trang cá nhân","secondaryAccountId":null}', '[]', 'chờ xử lý');
  ASSERT (v->>'created')::boolean AND (SELECT secondary_account_id IS NULL AND status = 'chờ xử lý' FROM auto_campaigns WHERE id = (v->>'campaign_id')::bigint),
    'timeline without data';
  v := create_control_campaign_v2(341, 34, 'k-fb-34', '{"accountId":3411,"actionId":"facebook_group_post","name":"FB-only"}', '[{"uid":"g"}]', 'tạm dừng');
  ASSERT (v->>'created')::boolean, 'facebook-only org create';
  v := create_control_campaign_v2(301, 30, 'k-em-1', '{"accountId":3009,"actionId":"email_send","name":"CD Email Web","content":"<p>x</p>",
    "extraSettings":{"emailSubject":"Chào"},"webCampaignForm":"form_1"}', '[{"email":"a@example.test","name":"A","info1":"x"},{"email":"b.c+tag@sub.example.vn"}]', 'tạm dừng');
  ASSERT (v->>'created')::boolean AND (v->>'input_count')::integer = 2, 'email created ' || v::text;
  ASSERT (SELECT array_agg(i.email ORDER BY i.id) FROM auto_campaign_input_data i WHERE i.campaign_id = (v->>'campaign_id')::bigint)
    = ARRAY['a@example.test','b.c+tag@sub.example.vn'], 'email inputs';
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e1', '{"accountId":3005,"actionId":"facebook_group_post","name":"x"}',
    '[{"uid":"a"},{"name":"thiếu uid"}]', 'tạm dừng')$$, 'control_input_uid_required', 'row=1');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e2', '{"accountId":3005,"actionId":"facebook_group_post","name":"x"}',
    '[{"uid":"   "}]', 'tạm dừng')$$, 'control_input_uid_required', 'row=0');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e3', '{"accountId":3005,"actionId":"facebook_group_post","name":"x"}',
    '["https://www.facebook.com/groups/1"]', 'tạm dừng')$$, 'control_input_uid_required', 'row=0');
  FOR t IN SELECT unnest(ARRAY['abc', 'a@b', ' a@example.test', 'a@ex ample.test', '', repeat('a', 250) || '@example.test']) LOOP
    PERFORM v530_test.expect_error(format($$SELECT create_control_campaign_v2(301, 30, 'k-e4', '{"accountId":3009,"actionId":"email_send","name":"x"}',
      %L, 'tạm dừng')$$, jsonb_build_array(jsonb_build_object('email', t))), 'control_input_email_invalid', 'row=0');
  END LOOP;
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e5', '{"accountId":3009,"actionId":"email_send","name":"x"}',
    '[{"email":"a@example.test"},{"phone":"0901"}]', 'tạm dừng')$$, 'control_input_email_invalid', 'row=1');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e6', '{"accountId":3005,"actionId":"facebook_timeline_post","name":"x","secondaryAccountId":3006}',
    '[]', 'tạm dừng')$$, 'control_secondary_account_not_allowed');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e7', '{"accountId":3005,"actionId":"facebook_group_post","name":"x","secondaryAccountId":3005}',
    '[]', 'tạm dừng')$$, 'control_secondary_account_same_as_primary');
  FOR n IN SELECT unnest(ARRAY[3021, 3007, 3009, 3002, 999999]::bigint[]) LOOP
    PERFORM v530_test.expect_error(format($$SELECT create_control_campaign_v2(301, 30, 'k-e8', '{"accountId":3005,"actionId":"facebook_message_uid","name":"x","secondaryAccountId":%s}',
      '[]', 'tạm dừng')$$, n), 'control_secondary_account_not_found');
  END LOOP;
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e9', '{"accountId":3002,"actionId":"zalo_message_phone","name":"x","secondaryAccountId":3003}',
    '[]', 'tạm dừng')$$, 'control_secondary_account_not_allowed');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e10', '{"accountId":3009,"actionId":"email_send","name":"x","secondaryAccountId":3010}',
    '[]', 'tạm dừng')$$, 'control_secondary_account_not_allowed');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e11', '{"accountId":3005,"actionId":"zalo_message_phone","name":"x"}', '[]', 'tạm dừng')$$,
    'control_action_not_allowed');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e12', '{"accountId":3009,"actionId":"facebook_group_post","name":"x"}', '[]', 'tạm dừng')$$,
    'control_action_not_allowed');
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e13', '{"accountId":3005,"actionId":"email_send","name":"x"}', '[]', 'tạm dừng')$$,
    'control_action_not_allowed');
  FOR n IN SELECT unnest(ARRAY[3008, 3007, 3021, 3011]::bigint[]) LOOP
    PERFORM v530_test.expect_error(format($$SELECT create_control_campaign_v2(301, 30, 'k-e14-%s', '{"accountId":%s,"actionId":"facebook_group_post","name":"x"}',
      '[]', 'tạm dừng')$$, n, n), 'control_account_not_found');
  END LOOP;

  -- F. Sửa: khoá do bộ chạy sở hữu, tài khoản phụ, trạng thái, chặn khi app Desktop còn giữ lượt.
  SELECT updated_at INTO ts FROM auto_campaigns WHERE id = 30005;
  v := update_control_campaign_atomic(301, 30, 30005, ts, '{"name":"CD FB group sửa","status":"hoàn thành","extra_settings":{"contentRotationIndex":0,
    "postBumpCreatedCampaignIdsByAccount":{},"sourceLinkIndex":5,"enablePostBump":false,"newKey":"x"}}');
  ASSERT (v->>'updated')::boolean, 'facebook update ' || v::text;
  ASSERT (SELECT extra_settings FROM auto_campaigns WHERE id = 30005)
    = '{"contentRotationIndex":3,"postBumpCreatedCampaignIdsByAccount":{"3005":30015},"enablePostBump":false,"newKey":"x"}'::jsonb,
    'runtime-owned keys kept, absent runtime key dropped: ' || (SELECT extra_settings::text FROM auto_campaigns WHERE id = 30005);
  ASSERT (SELECT status = 'tạm dừng' AND name = 'CD FB group sửa' AND secondary_account_id = 3006 FROM auto_campaigns WHERE id = 30005),
    'status ignored, secondary kept';
  SELECT updated_at INTO ts FROM auto_campaigns WHERE id = 30005;
  v := update_control_campaign_atomic(301, 30, 30005, ts, '{"secondary_account_id":null}');
  ASSERT (v->>'updated')::boolean AND (SELECT secondary_account_id IS NULL FROM auto_campaigns WHERE id = 30005), 'secondary cleared';
  SELECT updated_at INTO ts FROM auto_campaigns WHERE id = 30005;
  v := update_control_campaign_atomic(301, 30, 30005, ts, '{"secondary_account_id":3006}');
  ASSERT (v->>'updated')::boolean AND (SELECT secondary_account_id = 3006 FROM auto_campaigns WHERE id = 30005), 'secondary set';
  SELECT updated_at INTO ts FROM auto_campaigns WHERE id = 30005;
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30005, %L, '{"secondary_account_id":3005}')$$, ts),
    'control_secondary_account_same_as_primary');
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30005, %L, '{"account_id":3006}')$$, ts),
    'control_secondary_account_same_as_primary');
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30005, %L, '{"secondaryAccountId":3006}')$$, ts),
    'invalid_control_campaign_update_payload');
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30005, %L, '{"action_id":"facebook_timeline_post"}')$$, ts),
    'control_secondary_account_not_allowed');
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30005, %L, '{"account_id":3021}')$$, ts),
    'control_account_not_found');
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30005, %L, '{"account_id":3009}')$$, ts),
    'control_account_not_found');
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30008, %L, '{"secondary_account_id":3010}')$$,
    (SELECT updated_at FROM auto_campaigns WHERE id = 30008)), 'control_secondary_account_not_allowed');
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30002, %L, '{"secondary_account_id":3003}')$$,
    (SELECT updated_at FROM auto_campaigns WHERE id = 30002)), 'control_secondary_account_not_allowed');
  v := update_control_campaign_atomic(301, 30, 30002, (SELECT updated_at FROM auto_campaigns WHERE id = 30002), '{"secondary_account_id":null}');
  ASSERT (v->>'updated')::boolean, 'zalo may clear secondary';
  v := update_control_campaign_atomic(301, 30, 30005, ts, '{"extra_settings":null}');
  ASSERT (v->>'updated')::boolean AND (SELECT jsonb_typeof(extra_settings) = 'null' FROM auto_campaigns WHERE id = 30005), 'non-object patch kept as before';
  -- Zalo cũng giữ khoá do bộ chạy sở hữu (Server không bị chặn khi còn lease).
  v := update_control_campaign_atomic(301, 30, 30001, (SELECT updated_at FROM auto_campaigns WHERE id = 30001),
    '{"extra_settings":{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0,"enableMessage":false}}');
  ASSERT (v->>'updated')::boolean AND (SELECT extra_settings FROM auto_campaigns WHERE id = 30001)
    = '{"zaloFriendDataMaterializedAt":"2026-11-01T00:00:00Z","enableMessage":false}'::jsonb, 'zalo runtime keys ' || v::text;
  -- App Desktop còn giữ lượt và còn hoạt động: chặn (Facebook, Email, Zalo QR/trình duyệt), cả qua bản config_version.
  FOR n IN SELECT unnest(ARRAY[30006, 30009, 30003]::bigint[]) LOOP
    v := update_control_campaign_atomic(301, 30, n, (SELECT updated_at FROM auto_campaigns WHERE id = n), '{"name":"x"}');
    ASSERT v = '{"updated":false,"reason":"campaign_running","desktop_runtime_busy":true}'::jsonb, 'busy ' || n || ' ' || v::text;
  END LOOP;
  v := update_control_campaign_by_config_version_atomic(301, 30, 30006, now() - interval '1 year',
    jsonb_build_object('name', 'x', '_expected_config_version', (SELECT aka_agent_campaign_config_version(c) FROM auto_campaigns c WHERE c.id = 30006)));
  ASSERT v = '{"updated":false,"reason":"campaign_running","desktop_runtime_busy":true}'::jsonb, 'busy through config-version wrapper ' || v::text;
  v := update_control_campaign_atomic(301, 30, 30009, (SELECT updated_at FROM auto_campaigns WHERE id = 30009), '{"name":"x"}', NULL, false,
    'busy-append', 0, '[{"email":"z@example.test"}]');
  ASSERT v->>'reason' = 'campaign_running' AND (v->>'desktop_runtime_busy')::boolean, 'busy blocks append';
  v := update_control_campaign_atomic(301, 30, 30007, (SELECT updated_at FROM auto_campaigns WHERE id = 30007), '{"name":"x"}');
  ASSERT v = '{"updated":false,"reason":"campaign_running"}'::jsonb, 'running campaign unchanged reason ' || v::text;
  -- App tắt (phiên đã kết thúc hoặc quá 2 phút) hoặc chưa từng mở: lease mồ côi, cho sửa.
  v := update_control_campaign_atomic(302, 30, 30021, (SELECT updated_at FROM auto_campaigns WHERE id = 30021),
    '{"name":"CD 302 sửa","extra_settings":{"contentRotationIndex":9}}');
  ASSERT (v->>'updated')::boolean AND (SELECT extra_settings = '{"contentRotationIndex":1}'::jsonb FROM auto_campaigns WHERE id = 30021), 'app off allows edit';
  v := update_control_campaign_atomic(303, 30, 30031, (SELECT updated_at FROM auto_campaigns WHERE id = 30031), '{"name":"CD 303 sửa"}');
  ASSERT (v->>'updated')::boolean, 'no presence allows edit';
  UPDATE auto_staff_device_presence SET last_seen_at = now() - interval '119 seconds' WHERE instance_id = '00000000-0000-0000-0000-000000000303';
  v := update_control_campaign_atomic(302, 30, 30021, (SELECT updated_at FROM auto_campaigns WHERE id = 30021), '{"name":"x"}');
  ASSERT v->>'reason' = 'campaign_running' AND (v->>'desktop_runtime_busy')::boolean, 'presence 119s is alive';
  v := update_control_campaign_atomic(302, 30, 30023, (SELECT updated_at FROM auto_campaigns WHERE id = 30023), '{"name":"x"}');
  ASSERT (v->>'desktop_runtime_busy')::boolean, 'zalo qr claim busy while alive';
  UPDATE auto_staff_device_presence SET last_seen_at = now() - interval '121 seconds' WHERE instance_id = '00000000-0000-0000-0000-000000000303';
  v := update_control_campaign_atomic(302, 30, 30021, (SELECT updated_at FROM auto_campaigns WHERE id = 30021), '{"name":"y"}');
  ASSERT (v->>'updated')::boolean, 'presence 121s is gone';
  UPDATE auto_staff_device_presence SET last_seen_at = now(), ended_at = now() WHERE instance_id = '00000000-0000-0000-0000-000000000303';
  v := update_control_campaign_atomic(302, 30, 30021, (SELECT updated_at FROM auto_campaigns WHERE id = 30021), '{"name":"z"}');
  ASSERT (v->>'updated')::boolean, 'ended session is gone';
  -- Tài khoản: tắt → not_found; đã xoá → gán lại sang tài khoản Facebook khác được.
  v := update_control_campaign_atomic(301, 30, 30017, (SELECT updated_at FROM auto_campaigns WHERE id = 30017), '{"name":"x"}');
  ASSERT v = '{"updated":false,"reason":"not_found"}'::jsonb, 'inactive facebook account';
  v := update_control_campaign_atomic(301, 30, 30016, (SELECT updated_at FROM auto_campaigns WHERE id = 30016), '{"account_id":3005}');
  ASSERT (v->>'updated')::boolean AND (SELECT account_id = 3005 FROM auto_campaigns WHERE id = 30016), 'reassign deleted facebook account';
  -- Thêm data qua sửa: Email phải hợp lệ.
  PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30008, %L, '{"name":"x"}', NULL, false, 'ap-1', 1, '[{"email":"bad"}]')$$,
    (SELECT updated_at FROM auto_campaigns WHERE id = 30008)), 'control_input_email_invalid', 'row=0');
  v := update_control_campaign_atomic(301, 30, 30008, (SELECT updated_at FROM auto_campaigns WHERE id = 30008), '{"name":"CD Email sửa"}', NULL, false,
    'ap-2', 1, '[{"email":"new@example.test","name":"Mới"}]');
  ASSERT (v->>'updated')::boolean AND (v->>'appended_input_count')::integer = 1, 'email append ' || v::text;

  -- G. Thêm data (add_control_campaign_input_rows).
  v := add_control_campaign_input_rows(301, 30, 30005, 'add-fb-1', 1, '[{"uid":"https://www.facebook.com/groups/2","name":"G2"}]', now(), 'tạm dừng');
  ASSERT (v->>'inserted')::integer = 1 AND (v->>'created')::boolean, 'facebook add rows ' || v::text;
  PERFORM v530_test.expect_error($$SELECT add_control_campaign_input_rows(301, 30, 30005, 'add-fb-2', 2, '[{"name":"x"}]', now(), 'tạm dừng')$$,
    'control_input_uid_required', 'row=0');
  PERFORM v530_test.expect_error($$SELECT add_control_campaign_input_rows(301, 30, 30008, 'add-em-1', 2, '[{"email":"a@example.test"},{"email":"x"}]', now(), 'tạm dừng')$$,
    'control_input_email_invalid', 'row=1');
  v := add_control_campaign_input_rows(301, 30, 30018, 'add-em-2', 0, '[{"email":"q@example.test"}]', now(), 'chờ xử lý');
  ASSERT (v->>'inserted')::integer = 1, 'email add rows ' || v::text;
  v := add_control_campaign_input_rows(301, 30, 30017, 'add-fb-3', 0, '[{"uid":"g"}]', now(), 'tạm dừng');
  ASSERT v->>'reason' = 'not_found', 'inactive account add rows';

  -- H. Tài khoản Email SMTP.
  v := create_control_email_account_atomic(301, 30, '  Email mới  ',
    '{"brandName":" Shop ","host":" smtp.gmail.com ","port":"587","secure":false,"user":" u@example.test ","pass":"pw-1",
      "fromEmail":"u@example.test","replyTo":null,"cc":" cc@example.test ","junk":"x"}', true, 'bỏ qua', 4, 3901);
  ASSERT (v->>'created')::boolean, 'email account created ' || v::text;
  n := (v->>'account_id')::bigint;
  acc := v->'account';
  ASSERT NOT (v::text LIKE '%pw-1%') AND acc->'email_session'->>'hasPassword' = 'true' AND NOT (acc->'email_session' ? 'pass'), 'no password in result';
  ASSERT acc->>'name' = 'Email mới' AND acc->>'login_status' = 'đã đăng nhập' AND (acc->>'account_group_id')::bigint = 3901, 'account view';
  ASSERT (SELECT a.email_session = '{"brandName":"Shop","host":"smtp.gmail.com","port":587,"secure":false,"user":"u@example.test","pass":"pw-1",
      "fromEmail":"u@example.test","replyTo":"","cc":"cc@example.test"}'::jsonb
    AND a.flatform_type = 'email' AND a.status = 'chờ xử lý' AND a.login_status = 'đã đăng nhập' AND a.is_active AND NOT a.is_delete
    AND a.rate_limit_minutes = 65 AND NOT a.is_zalo_server AND NOT a.is_zalo_show_web AND a.proxy_id IS NULL
    AND a.email_session_updated_at = now() AND a.email_session_last_verified_at = now() AND a.email_session_last_error IS NULL
    AND a.staff_id = 301 AND a.organization_id = 30
    FROM auto_accounts a WHERE a.id = n), 'email account row like Desktop';
  v := create_control_email_account_atomic(301, 30, 'Email lỗi', '{"host":"h","port":99999,"secure":true,"user":"u","pass":"p","fromEmail":"f@example.test"}',
    false, '  Invalid login: 535  ', 4, NULL);
  ASSERT (v->>'created')::boolean AND (SELECT a.login_status = 'chưa đăng nhập' AND a.email_session_last_verified_at IS NULL
    AND a.email_session_last_error = 'Invalid login: 535' AND (a.email_session->>'port')::integer = 465 AND a.email_session->>'brandName' = ''
    FROM auto_accounts a WHERE a.id = (v->>'account_id')::bigint), 'unverified email account ' || v::text;
  v := create_control_email_account_atomic(301, 30, 'Quá hạn mức', session_ok, true, NULL, 4, NULL);
  ASSERT v = '{"created":false,"reason":"account_limit_reached","max_accounts":4}'::jsonb, 'email quota ' || v::text;
  v := create_control_email_account_atomic(301, 30, 'Không giới hạn', session_ok, true, NULL, NULL, NULL);
  ASSERT (v->>'created')::boolean, 'null max is unlimited';
  v := create_control_email_account_atomic(301, 30, 'Không giới hạn 2', session_ok, true, NULL, 0, NULL);
  ASSERT (v->>'created')::boolean, 'zero max is unlimited';
  v := create_control_email_account_atomic(351, 35, 'Tổ chức 35', session_ok, true, NULL, 1, NULL);
  ASSERT v->>'reason' = 'account_limit_reached', 'org 35 quota';
  PERFORM set_config('v530_test.separate_org', '35', true);
  v := create_control_email_account_atomic(351, 35, 'Tổ chức 35 tách quyền', session_ok, true, NULL, 1, NULL);
  ASSERT (v->>'created')::boolean, 'separate access org leaves quota to trigger';
  PERFORM set_config('v530_test.separate_org', '', true);
  v := create_control_email_account_atomic(341, 34, 'FB only', session_ok, true, NULL, NULL, NULL);
  ASSERT v = '{"created":false,"reason":"capability_unavailable"}'::jsonb, 'no email product';
  v := create_control_email_account_atomic(321, 32, 'Hết hạn', session_ok, true, NULL, NULL, NULL);
  ASSERT v->>'reason' = 'capability_unavailable', 'expired email product';
  v := create_control_email_account_atomic(331, 33, 'Đầu ngày', session_ok, true, NULL, NULL, NULL);
  ASSERT (v->>'created')::boolean, 'email product valid until VN day start';
  FOR n IN SELECT unnest(ARRAY[3902, 3903, 3904, 999]::bigint[]) LOOP
    v := create_control_email_account_atomic(301, 30, 'Nhóm sai', session_ok, true, NULL, NULL, n);
    ASSERT v = '{"created":false,"reason":"account_group_not_found"}'::jsonb, 'bad group ' || n;
  END LOOP;
  FOR t IN SELECT unnest(ARRAY['{"port":587,"user":"u","pass":"p","fromEmail":"f@x.vn"}', '{"host":"h","user":"u","pass":"p"}',
    '{"host":"h","pass":"p","fromEmail":"f@x.vn"}', '{"host":"h","user":"u","fromEmail":"f@x.vn"}', '{"host":"h","user":"u","pass":"","fromEmail":"f@x.vn"}',
    '[]', '"x"']) LOOP
    PERFORM v530_test.expect_error(format($$SELECT create_control_email_account_atomic(301, 30, 'x', %L, true, NULL, NULL, NULL)$$, t),
      'invalid_control_email_account_payload');
  END LOOP;
  PERFORM v530_test.expect_error(format($$SELECT create_control_email_account_atomic(301, 30, '  ', %L, true)$$, session_ok), 'invalid_control_email_account_payload');
  PERFORM v530_test.expect_error(format($$SELECT create_control_email_account_atomic(301, 30, 'x', %L, NULL)$$, session_ok), 'invalid_control_email_account_payload');
  PERFORM v530_test.expect_error(format($$SELECT create_control_email_account_atomic(304, 30, 'x', %L, true)$$, session_ok), 'inactive_control_staff');
  PERFORM v530_test.expect_error(format($$SELECT create_control_email_account_atomic(301, 31, 'x', %L, true)$$, session_ok), 'inactive_control_staff');
  -- Sửa.
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts - interval '1 second', 'x', NULL, NULL, NULL, 3901);
  ASSERT v = '{"updated":false,"reason":"version_conflict"}'::jsonb, 'email account version';
  v := update_control_email_account_atomic(301, 30, 3009, ts, ' Đổi tên ', NULL, NULL, NULL, 3901);
  ASSERT (v->>'updated')::boolean AND v->'account'->>'name' = 'Đổi tên' AND NOT (v::text LIKE '%secret-old%'), 'rename ' || v::text;
  ASSERT (SELECT a.email_session->>'pass' = 'secret-old' AND a.login_status = 'đã đăng nhập' AND a.account_group_id = 3901
    AND a.email_session_last_verified_at < now() AND a.email_session_updated_at < now() FROM auto_accounts a WHERE a.id = 3009), 'rename keeps session';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, '{"host":"smtp.new.test","port":465,"secure":true,"user":"shop@example.test","fromEmail":"shop@example.test"}',
    true, NULL, 3901);
  ASSERT (v->>'updated')::boolean, 'session without pass';
  ASSERT (SELECT a.email_session->>'pass' = 'secret-old' AND a.email_session->>'host' = 'smtp.new.test' AND a.login_status = 'đã đăng nhập'
    AND a.email_session_last_verified_at = now() AND a.email_session_updated_at = now() AND a.email_session_last_error IS NULL
    FROM auto_accounts a WHERE a.id = 3009), 'password kept when omitted';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, '{"host":"smtp.new.test","user":"shop@example.test","pass":"","fromEmail":"shop@example.test"}',
    true, NULL, 3901);
  ASSERT (SELECT a.email_session->>'pass' = 'secret-old' FROM auto_accounts a WHERE a.id = 3009), 'empty pass keeps old';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, '{"host":"h2","user":"u2","pass":"secret-new","fromEmail":"shop@example.test"}',
    false, 'Invalid login', NULL);
  ASSERT (SELECT a.email_session->>'pass' = 'secret-new' AND a.login_status = 'chưa đăng nhập' AND a.email_session_last_verified_at IS NULL
    AND a.email_session_last_error = 'Invalid login' AND a.account_group_id IS NULL FROM auto_accounts a WHERE a.id = 3009), 'new config not verified';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, NULL, true, NULL, NULL);
  ASSERT (SELECT a.login_status = 'đã đăng nhập' AND a.email_session_last_verified_at = now() AND a.email_session_last_error IS NULL
    AND a.email_session->>'pass' = 'secret-new' FROM auto_accounts a WHERE a.id = 3009), 'verify only ok';
  UPDATE auto_accounts SET email_session_last_verified_at = now() - interval '1 day', updated_at = now() - interval '1 hour' WHERE id = 3009;
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, NULL, false, 'Timeout', NULL);
  ASSERT (SELECT a.login_status = 'chưa đăng nhập' AND a.email_session_last_verified_at = now() - interval '1 day' AND a.email_session_last_error = 'Timeout'
    FROM auto_accounts a WHERE a.id = 3009), 'verify only failed keeps last verified time';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  PERFORM v530_test.expect_error(format($$SELECT update_control_email_account_atomic(301, 30, 3009, %L, NULL, %L, NULL, NULL, NULL)$$, ts, session_ok),
    'invalid_control_email_account_payload');
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, NULL, NULL, NULL, 3902);
  ASSERT v = '{"updated":false,"reason":"account_group_not_found"}'::jsonb, 'zalo group rejected';
  FOR n IN SELECT unnest(ARRAY[3002, 3022, 3011, 3005]::bigint[]) LOOP
    v := update_control_email_account_atomic(301, 30, n, now(), 'x', NULL, NULL, NULL, NULL);
    ASSERT v = '{"updated":false,"reason":"not_found"}'::jsonb, 'update not found ' || n;
  END LOOP;
  -- Đọc cấu hình đầy đủ (kể cả mật khẩu) chỉ cho API.
  v := aka_agent_control_email_account_session(301, 30, 3009);
  ASSERT (v->>'found')::boolean AND v->'session'->>'pass' = 'secret-new' AND (v->>'account_id')::bigint = 3009 AND v ? 'updated_at', 'session rpc';
  FOR n IN SELECT unnest(ARRAY[3011, 3002, 3022]::bigint[]) LOOP
    ASSERT aka_agent_control_email_account_session(301, 30, n) = '{"found":false}'::jsonb, 'session not found ' || n;
  END LOOP;
  -- Xoá.
  v := delete_control_email_account_atomic(301, 30, 3010);
  ASSERT v = '{"deleted":false,"reason":"account_running"}'::jsonb, 'running account';
  v := delete_control_email_account_atomic(301, 30, 3009);
  ASSERT v = '{"deleted":false,"reason":"campaign_running"}'::jsonb, 'campaign lease blocks account delete';
  v := delete_control_email_account_atomic(302, 30, 3022);
  ASSERT v = '{"deleted":true,"account_id":3022}'::jsonb AND (SELECT is_delete AND NOT is_active FROM auto_accounts WHERE id = 3022), 'email account deleted';
  ASSERT delete_control_email_account_atomic(302, 30, 3022) = '{"deleted":false,"reason":"not_found"}'::jsonb, 'delete twice';
  ASSERT delete_control_email_account_atomic(301, 30, 3002) = '{"deleted":false,"reason":"not_found"}'::jsonb, 'zalo account not deletable here';

  -- I. Liên kết chiến dịch tìm data → chiến dịch đích.
  UPDATE auto_campaigns SET updated_at = now() - interval '1 hour' WHERE id IN (30010, 30011);
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30011, 30010, 30011]::bigint[], 30012, 'findUidTargetCampaignIds', true);
  ASSERT v = '{"ok":true,"changedSourceIds":[30011],"unchangedSourceIds":[30010]}'::jsonb, 'link add ' || v::text;
  ASSERT (SELECT extra_settings = '{"findUidTargetCampaignIds":[30012]}'::jsonb AND updated_at = now() FROM auto_campaigns WHERE id = 30011), 'null extra gets array';
  ASSERT (SELECT extra_settings->'findUidTargetCampaignIds' = '[30099,"30012"]'::jsonb AND updated_at < now() FROM auto_campaigns WHERE id = 30010),
    'string id counts as present, untouched row keeps updated_at';
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010, 30011]::bigint[], 30012, 'findUidTargetCampaignIds', true);
  ASSERT v = '{"ok":true,"changedSourceIds":[],"unchangedSourceIds":[30010,30011]}'::jsonb, 'link add idempotent';
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010, 30011]::bigint[], 30012, 'findUidTargetCampaignIds', false);
  ASSERT v = '{"ok":true,"changedSourceIds":[30010,30011],"unchangedSourceIds":[]}'::jsonb, 'link remove';
  ASSERT (SELECT extra_settings->'findUidTargetCampaignIds' = '[30099]'::jsonb AND extra_settings->'isFindUid' = 'true'::jsonb FROM auto_campaigns WHERE id = 30010)
    AND (SELECT extra_settings->'findUidTargetCampaignIds' = '[]'::jsonb FROM auto_campaigns WHERE id = 30011), 'removed, other ids kept';
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 30012, 'findUidTargetCampaignIds', false);
  ASSERT v = '{"ok":true,"changedSourceIds":[],"unchangedSourceIds":[30010]}'::jsonb, 'link remove idempotent';
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 30014, 'findPhoneZaloMessagePhoneTargetCampaignIds', true);
  ASSERT v->'changedSourceIds' = '[30010]'::jsonb
    AND (SELECT extra_settings->'findPhoneZaloMessagePhoneTargetCampaignIds' = '[30014]'::jsonb FROM auto_campaigns WHERE id = 30010), 'zalo target key';
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 30013, 'findUidTargetCampaignIds', true);
  ASSERT v = '{"ok":false,"reason":"target_action_mismatch"}'::jsonb, 'target action mismatch';
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 30013, 'findFacebookGroupJoinTargetCampaignIds', true);
  ASSERT (v->>'ok')::boolean, 'join group key';
  ASSERT aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 34101, 'findFacebookGroupPostTargetCampaignIds', true)
    = '{"ok":false,"reason":"target_not_found"}'::jsonb, 'target other org';
  ASSERT aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 30015, 'findFacebookGroupPostTargetCampaignIds', true)
    = '{"ok":false,"reason":"target_not_found"}'::jsonb, 'target deleted';
  SELECT extra_settings INTO acc FROM auto_campaigns WHERE id = 30010;
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010, 30005, 31101]::bigint[], 30012, 'findUidTargetCampaignIds', true);
  ASSERT v = '{"ok":false,"reason":"source_not_found","sourceIds":[30005,31101]}'::jsonb
    AND (SELECT extra_settings FROM auto_campaigns WHERE id = 30010) = acc, 'bad source changes nothing ' || v::text;
  v := aka_agent_control_link_find_data_target(304, 30, ARRAY[30010]::bigint[], 30012, 'findUidTargetCampaignIds', true);
  ASSERT v = '{"ok":false,"reason":"inactive_control_staff"}'::jsonb, 'inactive staff link';
  v := aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 999999, 'findUidTargetCampaignIds', false);
  ASSERT (v->>'ok')::boolean, 'remove does not require target to exist';
  PERFORM v530_test.expect_error($$SELECT aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 30012, 'findPhoneSmsTargetCampaignIds', true)$$,
    'invalid_find_data_target_key');
  PERFORM v530_test.expect_error($$SELECT aka_agent_control_link_find_data_target(301, 30, ARRAY[]::bigint[], 30012, 'findUidTargetCampaignIds', true)$$,
    'invalid_find_data_link_payload');
  PERFORM v530_test.expect_error($$SELECT aka_agent_control_link_find_data_target(301, 30, ARRAY[30012]::bigint[], 30012, 'findUidTargetCampaignIds', true)$$,
    'invalid_find_data_link_payload');
  PERFORM v530_test.expect_error($$SELECT aka_agent_control_link_find_data_target(301, 30, ARRAY[30010]::bigint[], 30012, 'findUidTargetCampaignIds', NULL)$$,
    'invalid_find_data_link_payload');

  -- J. Bộ chạy Desktop ghi từng khoá (SECURITY INVOKER: quyền cột + RLS của phiên Desktop).
  UPDATE auto_campaigns SET extra_settings = '{"contentRotationIndex":3,"imageOption":"all","postBumpRotationIndex":1,"keep":true}',
    updated_at = now() - interval '1 hour' WHERE id = 30006;
  PERFORM set_config('v530_test.desktop_staff', '301', true);
  SET LOCAL ROLE aka_agent_desktop;
  v := aka_agent_desktop_merge_campaign_runtime_settings(30006, '{"contentRotationIndex":4,"sourceLinkIndex":2}', ARRAY['postBumpRotationIndex','imageOption']);
  ASSERT (v->>'updated')::boolean AND (v->>'updatedAt')::timestamptz = now(), 'desktop merge ' || v::text;
  v := aka_agent_desktop_merge_campaign_runtime_settings(30011, '{"k":1}');
  ASSERT (v->>'updated')::boolean, 'merge default remove';
  v := aka_agent_desktop_merge_campaign_runtime_settings(30021, '{"contentRotationIndex":2}', '{}');
  ASSERT v = '{"updated":false,"updatedAt":null}'::jsonb, 'RLS hides other staff ' || v::text;
  BEGIN
    PERFORM aka_agent_desktop_merge_campaign_runtime_settings(30006, '[1]', '{}');
    RAISE EXCEPTION 'merge accepted array';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS t = MESSAGE_TEXT;
    ASSERT t = 'invalid_campaign_runtime_settings', 'merge invalid: ' || t;
  END;
  RESET ROLE;
  ASSERT (SELECT extra_settings FROM auto_campaigns WHERE id = 30006) = '{"contentRotationIndex":4,"sourceLinkIndex":2,"keep":true}'::jsonb, 'merged keys';
  ASSERT (SELECT extra_settings FROM auto_campaigns WHERE id = 30021) = '{"contentRotationIndex":1}'::jsonb, 'other staff untouched';
  ASSERT (SELECT extra_settings->'k' = '1'::jsonb FROM auto_campaigns WHERE id = 30011), 'merge into existing object';
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM aka_agent_desktop_merge_campaign_runtime_settings(30006, '{}', '{}');
    RAISE EXCEPTION 'service_role executed desktop merge';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- K. Quyền hàm mới.
  FOREACH t IN ARRAY ARRAY['public.aka_agent_control_web_email_campaigns_policy(bigint)',
    'public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)',
    'public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)',
    'public.delete_control_email_account_atomic(bigint,bigint,bigint)',
    'public.aka_agent_control_email_account_session(bigint,bigint,bigint)',
    'public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)'] LOOP
    ASSERT has_function_privilege('service_role', t, 'EXECUTE')
      AND NOT has_function_privilege('anon', t, 'EXECUTE') AND NOT has_function_privilege('authenticated', t, 'EXECUTE')
      AND NOT has_function_privilege('aka_agent_desktop', t, 'EXECUTE') AND NOT has_function_privilege('aka_agent_chat_api', t, 'EXECUTE'),
      'service_role only: ' || t;
  END LOOP;
  t := 'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])';
  ASSERT has_function_privilege('aka_agent_desktop', t, 'EXECUTE') AND NOT has_function_privilege('service_role', t, 'EXECUTE')
    AND NOT has_function_privilege('anon', t, 'EXECUTE') AND NOT has_function_privilege('authenticated', t, 'EXECUTE')
    AND NOT has_function_privilege('aka_agent_chat_api', t, 'EXECUTE'), 'desktop only: ' || t;
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = t::regprocedure) IS FALSE, 'desktop merge is security invoker';
  FOREACH t IN ARRAY ARRAY['private.aka_agent_web_email_campaigns_policy(bigint)', 'private.aka_agent_web_facebook_campaigns_policy(bigint)',
    'private.aka_agent_control_assert_campaign_inputs(text,jsonb)',
    'private.aka_agent_control_assert_secondary_account(bigint,bigint,text,text,bigint,bigint)',
    'private.aka_agent_control_normalize_email_session(jsonb,text)', 'private.aka_agent_control_email_account_view(public.auto_accounts)'] LOOP
    ASSERT (SELECT proacl::text FROM pg_proc WHERE oid = t::regprocedure) = '{postgres=X/postgres}', 'owner only: ' || t;
  END LOOP;
  RAISE NOTICE 'v530 assertions passed';
END
$test$;
ROLLBACK;
