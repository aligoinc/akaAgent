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
  -- uid phải là chuỗi hoặc số; email phải là chuỗi (mảng/đối tượng/boolean/null/số bị từ chối, không ghi "[...]" vào cột).
  FOR t IN SELECT unnest(ARRAY['["g1"]', '{"id":"g1"}', 'true', 'null', '""']) LOOP
    PERFORM v530_test.expect_error(format($$SELECT create_control_campaign_v2(301, 30, 'k-e3b', '{"accountId":3005,"actionId":"facebook_group_post","name":"x"}',
      '[{"uid":"ok"},{"uid":"ok2"},{"uid":%s}]', 'tạm dừng')$$, t), 'control_input_uid_required', 'row=2');
  END LOOP;
  v := create_control_campaign_v2(301, 30, 'k-e3c', '{"accountId":3005,"actionId":"facebook_message_uid","name":"uid số"}', '[{"uid":100012345678901},{"uid":" 61550000000001 "}]', 'tạm dừng');
  ASSERT (SELECT array_agg(i.uid ORDER BY i.id) FROM auto_campaign_input_data i WHERE i.campaign_id = (v->>'campaign_id')::bigint)
    = ARRAY['100012345678901', ' 61550000000001 '], 'numeric uid stored as text';
  FOR t IN SELECT unnest(ARRAY['["a@example.test"]', '{"address":"a@example.test"}', 'true', 'null', '123']) LOOP
    PERFORM v530_test.expect_error(format($$SELECT create_control_campaign_v2(301, 30, 'k-e3d', '{"accountId":3009,"actionId":"email_send","name":"x"}',
      '[{"email":"ok@example.test"},{"email":%s}]', 'tạm dừng')$$, t), 'control_input_email_invalid', 'row=1');
  END LOOP;
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
  -- Zalo/SMS: khoá secondaryAccountId bị bỏ qua hoàn toàn như trước v530 (kể cả giá trị không phải số).
  FOR t IN SELECT unnest(ARRAY['3003', '"abc"', '{"id":3003}', '[3003]', 'true', '1.5']) LOOP
    v := create_control_campaign_v2(301, 30, 'k-e9-' || t, format('{"accountId":3002,"actionId":"zalo_message_phone","name":"x","secondaryAccountId":%s}', t)::jsonb,
      '[]', 'tạm dừng');
    ASSERT (v->>'created')::boolean AND (SELECT secondary_account_id IS NULL FROM auto_campaigns WHERE id = (v->>'campaign_id')::bigint),
      'zalo ignores secondaryAccountId ' || t;
  END LOOP;
  v := create_control_campaign_v2(301, 30, 'k-e9-sms', '{"accountId":3004,"actionId":"sms_send","name":"x","secondaryAccountId":"abc"}', '[]', 'tạm dừng');
  ASSERT (v->>'created')::boolean, 'sms ignores secondaryAccountId';
  -- Facebook: giá trị phải là số nguyên dương hoặc chuỗi chữ số; kiểu khác không bị ép kiểu mù (không còn lỗi 22P02).
  FOR t IN SELECT unnest(ARRAY['"abc"', '"30 06"', '-5', '0', '1.5', 'true', '[3006]', '{"id":3006}', '"9999999999999999999999"']) LOOP
    PERFORM v530_test.expect_error(format($$SELECT create_control_campaign_v2(301, 30, 'k-e9b', '{"accountId":3005,"actionId":"facebook_group_post","name":"x","secondaryAccountId":%s}',
      '[]', 'tạm dừng')$$, t), 'control_secondary_account_not_found');
  END LOOP;
  v := create_control_campaign_v2(301, 30, 'k-e9c', '{"accountId":3005,"actionId":"facebook_group_post","name":"x","secondaryAccountId":" 3006 "}', '[]', 'tạm dừng');
  ASSERT (SELECT secondary_account_id = 3006 FROM auto_campaigns WHERE id = (v->>'campaign_id')::bigint), 'digit string secondary';
  FOR t IN SELECT unnest(ARRAY['""', '"  "', 'null']) LOOP
    v := create_control_campaign_v2(301, 30, 'k-e9d-' || t, format('{"accountId":3005,"actionId":"facebook_timeline_post","name":"x","secondaryAccountId":%s}', t)::jsonb,
      '[]', 'tạm dừng');
    ASSERT (SELECT secondary_account_id IS NULL FROM auto_campaigns WHERE id = (v->>'campaign_id')::bigint), 'empty secondary ' || t;
  END LOOP;
  PERFORM v530_test.expect_error($$SELECT create_control_campaign_v2(301, 30, 'k-e9e', '{"accountId":3009,"actionId":"email_send","name":"x","secondaryAccountId":"abc"}',
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
  -- Zalo/SMS: cả hai cách viết khoá tài khoản phụ đều bị bỏ qua như trước v530 (không lỗi, không ghi cột).
  FOR t IN SELECT unnest(ARRAY['{"secondary_account_id":3003}', '{"secondary_account_id":"abc"}', '{"secondaryAccountId":{"x":1}}', '{"secondary_account_id":null}']) LOOP
    v := update_control_campaign_atomic(301, 30, 30002, (SELECT updated_at FROM auto_campaigns WHERE id = 30002), t::jsonb);
    ASSERT (v->>'updated')::boolean AND (SELECT secondary_account_id IS NULL FROM auto_campaigns WHERE id = 30002), 'zalo ignores secondary key ' || t;
  END LOOP;
  UPDATE auto_campaigns SET secondary_account_id = 3003 WHERE id = 30014;
  v := update_control_campaign_atomic(301, 30, 30014, (SELECT updated_at FROM auto_campaigns WHERE id = 30014), '{"secondary_account_id":null,"name":"giữ cột"}');
  ASSERT (v->>'updated')::boolean AND (SELECT secondary_account_id = 3003 FROM auto_campaigns WHERE id = 30014), 'zalo keeps stored secondary column';
  UPDATE auto_campaigns SET secondary_account_id = NULL WHERE id = 30014;
  v := update_control_campaign_atomic(301, 30, 30004, (SELECT updated_at FROM auto_campaigns WHERE id = 30004), '{"secondary_account_id":"abc","content":"SMS x"}');
  ASSERT (v->>'updated')::boolean, 'sms ignores secondary key';
  -- Facebook: giá trị sai kiểu không bị ép kiểu mù.
  SELECT updated_at INTO ts FROM auto_campaigns WHERE id = 30005;
  FOR t IN SELECT unnest(ARRAY['"abc"', '-1', '0', '2.5', 'false', '[3006]', '{"id":3006}']) LOOP
    PERFORM v530_test.expect_error(format($$SELECT update_control_campaign_atomic(301, 30, 30005, %L, '{"secondary_account_id":%s}')$$, ts, t),
      'control_secondary_account_not_found');
  END LOOP;
  v := update_control_campaign_atomic(301, 30, 30005, ts, '{"secondary_account_id":""}');
  ASSERT (v->>'updated')::boolean AND (SELECT secondary_account_id IS NULL FROM auto_campaigns WHERE id = 30005), 'empty string clears secondary';
  SELECT updated_at INTO ts FROM auto_campaigns WHERE id = 30005;
  v := update_control_campaign_atomic(301, 30, 30005, ts, '{"secondary_account_id":"3006"}');
  ASSERT (v->>'updated')::boolean AND (SELECT secondary_account_id = 3006 FROM auto_campaigns WHERE id = 30005), 'digit string sets secondary';
  SELECT updated_at INTO ts FROM auto_campaigns WHERE id = 30005;
  v := update_control_campaign_atomic(301, 30, 30005, ts, '{"extra_settings":null}');
  ASSERT (v->>'updated')::boolean AND (SELECT jsonb_typeof(extra_settings) = 'null' FROM auto_campaigns WHERE id = 30005), 'non-object patch kept as before';
  -- 4 cặp dấu "đã lấy data" của Zalo (Server không bị chặn khi còn lease): dấu gửi JSON null = Web chủ động đặt
  -- lại, cả cặp lấy từ patch như trước v530; ngoài ra giữ giá trị DB của cả cặp (DB không có thì không có).
  v := update_control_campaign_atomic(301, 30, 30001, (SELECT updated_at FROM auto_campaigns WHERE id = 30001),
    '{"extra_settings":{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0,"enableMessage":false}}');
  ASSERT (v->>'updated')::boolean AND (SELECT extra_settings FROM auto_campaigns WHERE id = 30001)
    = '{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0,"enableMessage":false}'::jsonb, 'explicit reset applied ' || v::text;
  FOR r IN SELECT * FROM (VALUES
    -- (nhãn, extra_settings trong DB, extra_settings của patch, kết quả)
    ('stale copy keeps db',
      '{"zaloFriendDataMaterializedAt":"2026-11-10T01:00:00Z","zaloFriendMaterializedCount":7,"a":1}',
      '{"zaloFriendDataMaterializedAt":"2026-11-01T00:00:00Z","zaloFriendMaterializedCount":2,"a":2}',
      '{"zaloFriendDataMaterializedAt":"2026-11-10T01:00:00Z","zaloFriendMaterializedCount":7,"a":2}'),
    ('marker absent keeps db pair',
      '{"zaloFriendDataMaterializedAt":"2026-11-10T01:00:00Z","zaloFriendMaterializedCount":7}',
      '{"zaloFriendMaterializedCount":0,"a":2}',
      '{"zaloFriendDataMaterializedAt":"2026-11-10T01:00:00Z","zaloFriendMaterializedCount":7,"a":2}'),
    ('marker absent, db has no pair',
      '{"a":1}',
      '{"zaloFriendMaterializedCount":0,"zaloBirthdayDataMaterializedDate":"2026-11-14","zaloBirthdayMaterializedCount":3,"a":2}',
      '{"a":2}'),
    ('reset takes patch pair',
      '{"zaloFriendDataMaterializedAt":"2026-11-10T01:00:00Z","zaloFriendMaterializedCount":7}',
      '{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0}',
      '{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0}'),
    ('reset without count drops db count',
      '{"zaloBirthdayDataMaterializedDate":"2026-11-13","zaloBirthdayMaterializedCount":4}',
      '{"zaloBirthdayDataMaterializedDate":null}',
      '{"zaloBirthdayDataMaterializedDate":null}'),
    ('count null is not a reset',
      '{"zaloBirthdayDataMaterializedDate":"2026-11-13","zaloBirthdayMaterializedCount":4}',
      '{"zaloBirthdayMaterializedCount":null}',
      '{"zaloBirthdayDataMaterializedDate":"2026-11-13","zaloBirthdayMaterializedCount":4}'),
    ('pairs are independent',
      '{"zaloFriendRecommendationDataMaterializedAt":"2026-11-12T00:00:00Z","zaloFriendRecommendationMaterializedCount":10,
        "zaloCancelFriendRequestDataMaterializedAt":"2026-11-11T00:00:00Z","zaloCancelFriendRequestMaterializedCount":5}',
      '{"zaloFriendRecommendationDataMaterializedAt":null,"zaloFriendRecommendationMaterializedCount":0,
        "zaloCancelFriendRequestDataMaterializedAt":"2026-01-01T00:00:00Z","zaloCancelFriendRequestMaterializedCount":1}',
      '{"zaloFriendRecommendationDataMaterializedAt":null,"zaloFriendRecommendationMaterializedCount":0,
        "zaloCancelFriendRequestDataMaterializedAt":"2026-11-11T00:00:00Z","zaloCancelFriendRequestMaterializedCount":5}'),
    ('web form of another zalo type (all four reset) keeps the five runtime keys',
      '{"contentRotationIndex":4,"internalSmsCreatedCampaignIdsByAccount":{"3004":30004},"zaloBirthdayMaterializedCount":4}',
      '{"contentRotationIndex":0,"sourceLinkIndex":1,"internalSmsCreatedCampaignIdsByAccount":{},
        "zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0,"zaloBirthdayDataMaterializedDate":null,"zaloBirthdayMaterializedCount":0,
        "zaloFriendRecommendationDataMaterializedAt":null,"zaloFriendRecommendationMaterializedCount":0,
        "zaloCancelFriendRequestDataMaterializedAt":null,"zaloCancelFriendRequestMaterializedCount":0,"enableMessage":true}',
      '{"contentRotationIndex":4,"internalSmsCreatedCampaignIdsByAccount":{"3004":30004},
        "zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0,"zaloBirthdayDataMaterializedDate":null,"zaloBirthdayMaterializedCount":0,
        "zaloFriendRecommendationDataMaterializedAt":null,"zaloFriendRecommendationMaterializedCount":0,
        "zaloCancelFriendRequestDataMaterializedAt":null,"zaloCancelFriendRequestMaterializedCount":0,"enableMessage":true}')
  ) AS x(label, db_extra, patch_extra, expected) LOOP
    UPDATE auto_campaigns SET extra_settings = r.db_extra::jsonb WHERE id = 30014;
    v := update_control_campaign_atomic(301, 30, 30014, (SELECT updated_at FROM auto_campaigns WHERE id = 30014),
      jsonb_build_object('extra_settings', r.patch_extra::jsonb));
    ASSERT (v->>'updated')::boolean AND (SELECT extra_settings FROM auto_campaigns WHERE id = 30014) = r.expected::jsonb,
      'materialized pair: ' || r.label || ' → ' || (SELECT extra_settings::text FROM auto_campaigns WHERE id = 30014);
  END LOOP;
  -- Cùng luật qua bản theo config_version, và trên chiến dịch Facebook (khoá Zalo lạ vẫn theo luật cặp).
  UPDATE auto_campaigns SET extra_settings = '{"zaloFriendDataMaterializedAt":"2026-11-10T01:00:00Z","zaloFriendMaterializedCount":7}' WHERE id = 30014;
  v := update_control_campaign_by_config_version_atomic(301, 30, 30014, now() - interval '1 year',
    jsonb_build_object('extra_settings', '{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0,"b":1}'::jsonb,
      '_expected_config_version', (SELECT aka_agent_campaign_config_version(c) FROM auto_campaigns c WHERE c.id = 30014)));
  ASSERT (v->>'updated')::boolean AND (SELECT extra_settings FROM auto_campaigns WHERE id = 30014)
    = '{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0,"b":1}'::jsonb, 'reset through config-version wrapper ' || v::text;
  UPDATE auto_campaigns SET extra_settings = '{}' WHERE id = 30014;
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
  v := create_control_email_account_atomic(301, 30, 'Email lỗi', '{"host":"h","port":null,"secure":true,"user":"u","pass":"p","fromEmail":"f@example.test"}',
    false, '  Invalid login: 535  ', 4, NULL);
  ASSERT (v->>'created')::boolean AND (SELECT a.login_status = 'chưa đăng nhập' AND a.email_session_last_verified_at IS NULL
    AND a.email_session_last_error = 'Invalid login: 535' AND (a.email_session->>'port')::integer = 465 AND a.email_session->>'brandName' = ''
    FROM auto_accounts a WHERE a.id = (v->>'account_id')::bigint), 'unverified email account ' || v::text;
  -- secure thiếu/null = false (boolean, không phải JSON null); port thiếu/rỗng = 587 khi không secure.
  FOR t IN SELECT unnest(ARRAY['{"host":"h","user":"u","pass":"p","fromEmail":"f@example.test"}',
    '{"host":"h","secure":null,"port":"","user":"u","pass":"p","fromEmail":"f@example.test"}']) LOOP
    ASSERT private.aka_agent_control_normalize_email_session(t::jsonb, NULL)
      = '{"brandName":"","host":"h","port":587,"secure":false,"user":"u","pass":"p","fromEmail":"f@example.test","replyTo":"","cc":""}'::jsonb,
      'secure/port defaults ' || private.aka_agent_control_normalize_email_session(t::jsonb, NULL)::text;
  END LOOP;
  ASSERT private.aka_agent_control_normalize_email_session('{"host":"h","port":" 2525 ","secure":true,"user":"u","fromEmail":"f@x.vn","pass":null}', 'cũ')
    = '{"brandName":"","host":"h","port":2525,"secure":true,"user":"u","pass":"cũ","fromEmail":"f@x.vn","replyTo":"","cc":""}'::jsonb, 'digit-string port, null pass keeps current';
  -- Kiểu JSON sai bị từ chối (không ép kiểu ngầm): port ngoài 1..65535/không nguyên/không phải số, secure không phải
  -- boolean, trường chữ không phải chuỗi.
  FOR t IN SELECT unnest(ARRAY['"port":99999', '"port":0', '"port":-1', '"port":587.5', '"port":"abc"', '"port":"58a"', '"port":true', '"port":[587]',
    '"secure":"true"', '"secure":1', '"secure":[]', '"brandName":5', '"host":["h"]', '"user":{"u":1}', '"pass":123', '"fromEmail":true',
    '"replyTo":1', '"cc":["a@x.vn"]']) LOOP
    PERFORM v530_test.expect_error(format($$SELECT private.aka_agent_control_normalize_email_session(%L, NULL)$$,
      ('{"host":"h","user":"u","pass":"p","fromEmail":"f@x.vn"}'::jsonb || ('{' || t || '}')::jsonb)::text), 'invalid_control_email_account_payload');
  END LOOP;
  PERFORM v530_test.expect_error($$SELECT create_control_email_account_atomic(301, 30, 'x', '{"host":"h","port":99999,"user":"u","pass":"p","fromEmail":"f@x.vn"}', true)$$,
    'invalid_control_email_account_payload');
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
  -- p_verified NULL kèm cấu hình mới (API không kiểm được từ máy chủ): lưu cấu hình, GIỮ trạng thái đăng nhập, mốc
  -- đã kiểm và lỗi cũ; email_session_updated_at vẫn đổi. Thử ở cả hai trạng thái.
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL,
    '{"brandName":"Giữ trạng thái","host":"h3","port":2525,"user":"u3","fromEmail":"shop@example.test"}', NULL, 'bị bỏ qua', NULL);
  ASSERT (v->>'updated')::boolean AND v->'account'->>'login_status' = 'chưa đăng nhập', 'session with null verified ' || v::text;
  ASSERT (SELECT a.login_status = 'chưa đăng nhập' AND a.email_session_last_verified_at = now() - interval '1 day' AND a.email_session_last_error = 'Timeout'
    AND a.email_session = '{"brandName":"Giữ trạng thái","host":"h3","port":2525,"secure":false,"user":"u3","pass":"secret-new","fromEmail":"shop@example.test","replyTo":"","cc":""}'::jsonb
    AND a.email_session_updated_at = now() FROM auto_accounts a WHERE a.id = 3009), 'null verified keeps failed status, saves session';
  UPDATE auto_accounts SET login_status = 'đã đăng nhập', email_session_last_verified_at = now() - interval '2 days', email_session_last_error = NULL,
    email_session_updated_at = now() - interval '3 days', updated_at = now() - interval '2 hours' WHERE id = 3009;
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, 'Tên mới', '{"host":"h4","user":"u4","pass":"secret-4","fromEmail":"shop@example.test"}', NULL, NULL, NULL);
  ASSERT (SELECT a.login_status = 'đã đăng nhập' AND a.email_session_last_verified_at = now() - interval '2 days' AND a.email_session_last_error IS NULL
    AND a.email_session->>'host' = 'h4' AND a.email_session->>'pass' = 'secret-4' AND a.email_session_updated_at = now() AND a.name = 'Tên mới'
    FROM auto_accounts a WHERE a.id = 3009), 'null verified keeps working account logged in';
  -- p_verified true/false kèm cấu hình vẫn như trước.
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, '{"host":"h5","user":"u5","fromEmail":"shop@example.test"}', false, 'Sai mật khẩu', NULL);
  ASSERT (SELECT a.login_status = 'chưa đăng nhập' AND a.email_session_last_verified_at IS NULL AND a.email_session_last_error = 'Sai mật khẩu'
    AND a.email_session->>'pass' = 'secret-4' FROM auto_accounts a WHERE a.id = 3009), 'false with session clears verified time';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, '{"host":"h5","user":"u5","pass":"secret-new","fromEmail":"shop@example.test"}', true, NULL, NULL);
  ASSERT (SELECT a.login_status = 'đã đăng nhập' AND a.email_session_last_verified_at = now() AND a.email_session_last_error IS NULL
    FROM auto_accounts a WHERE a.id = 3009), 'true with session verifies';
  -- Chuyển nhóm: nhóm Email khác của chính nhân viên; trigger production (khoá dùng chung nhóm cũ + mới) chạy cùng.
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, NULL, NULL, NULL, 3905);
  ASSERT (v->>'updated')::boolean AND (SELECT account_group_id = 3905 FROM auto_accounts WHERE id = 3009), 'move to another email group';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
  v := update_control_email_account_atomic(301, 30, 3009, ts, NULL, NULL, NULL, NULL, NULL);
  ASSERT (v->>'updated')::boolean AND (SELECT account_group_id IS NULL FROM auto_accounts WHERE id = 3009), 'leave group';
  SELECT updated_at INTO ts FROM auto_accounts WHERE id = 3009;
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
  PERFORM set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000301"}', true);
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
  -- Phiên Desktop không hợp lệ (sub lạ / không có claims): RLS không cho dòng nào.
  PERFORM set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-00000000ffff"}', true);
  v := aka_agent_desktop_merge_campaign_runtime_settings(30006, '{"contentRotationIndex":9}');
  ASSERT v = '{"updated":false,"updatedAt":null}'::jsonb, 'unknown desktop user sees nothing ' || v::text;
  PERFORM set_config('request.jwt.claims', '', true);
  v := aka_agent_desktop_merge_campaign_runtime_settings(30006, '{"contentRotationIndex":9}');
  ASSERT v = '{"updated":false,"updatedAt":null}'::jsonb, 'no claims sees nothing ' || v::text;
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
    'private.aka_agent_control_resolve_secondary_account(bigint,bigint,text,text,bigint,jsonb)',
    'private.aka_agent_control_normalize_email_session(jsonb,text)', 'private.aka_agent_control_email_account_view(public.auto_accounts)'] LOOP
    ASSERT (SELECT proacl::text FROM pg_proc WHERE oid = t::regprocedure) = '{postgres=X/postgres}', 'owner only: ' || t;
  END LOOP;
  RAISE NOTICE 'v530 assertions passed';
END
$test$;
ROLLBACK;
