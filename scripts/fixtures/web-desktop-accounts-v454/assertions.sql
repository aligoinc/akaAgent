-- Kiểm chứng v454 trên dữ liệu giả lập. Chạy trong BEGIN ... ROLLBACK để chạy lại được.
BEGIN;
INSERT INTO org_organization(id, name) VALUES (9, 'Tổ chức Web'), (10, 'Tổ chức chỉ Desktop');
INSERT INTO org_staff(id, organization_id, name, username, password, is_active) VALUES
  (7, 9, 'Nhân viên 7', 'u7', 'p7', true), (8, 9, 'Nhân viên 8', 'u8', 'p8', true), (70, 10, 'Nhân viên 70', 'u70', 'p70', true);
INSERT INTO org_organization_product(id, organization_id, product_id, expiration_date, is_deleted, is_zalo_server, is_zalo_show_web) VALUES
  (1, 9, 16, now() + interval '30 days', false, true, true),
  (2, 10, 16, now() + interval '30 days', false, false, false);
INSERT INTO auto_campaign_actions(id, name, flatform_type, workflow_id) VALUES
  ('zalo_message_phone', 'Zalo - Nhắn tin', 'zalo', 1), ('sms_send', 'SMS', 'sms', 2);
INSERT INTO auto_accounts(id, name, flatform_type, staff_id, organization_id, is_zalo_server, is_zalo_show_web, is_delete, zalo_session, login_status) VALUES
  (1, 'Zalo Server', 'zalo', 7, 9, true, false, false, '{"cookie":"x"}', 'đã đăng nhập'),
  (2, 'Zalo QR', 'zalo', 7, 9, false, false, false, NULL, 'đã đăng nhập'),
  (3, 'Zalo trình duyệt', 'zalo', 7, 9, false, true, false, NULL, 'đã đăng nhập'),
  (4, 'SMS', 'sms', 7, 9, false, false, false, NULL, NULL),
  (5, 'QR đã xóa', 'zalo', 7, 9, false, false, true, NULL, 'đã đăng nhập'),
  (6, 'Hai cờ lỗi', 'zalo', 7, 9, true, true, false, NULL, 'đã đăng nhập'),
  (7, 'QR khác', 'zalo', 7, 9, false, false, false, NULL, 'chưa đăng nhập'),
  (8, 'QR nhân viên 8', 'zalo', 8, 9, false, false, false, NULL, 'đã đăng nhập');
INSERT INTO auto_campaigns(id, name, action_id, account_id, status, staff_id, organization_id, schedule, runtime_claim_token, runtime_claim_target, runtime_unit_token) VALUES
  (101, 'CD Server', 'zalo_message_phone', 1, 'chờ xử lý', 7, 9, now(), NULL, NULL, NULL),
  (102, 'CD QR', 'zalo_message_phone', 2, 'chờ xử lý', 7, 9, now(), NULL, NULL, NULL),
  (103, 'CD trình duyệt', 'zalo_message_phone', 3, 'đang chạy', 7, 9, now(), gen_random_uuid(), 'desktop', gen_random_uuid()),
  (104, 'CD QR dừng', 'zalo_message_phone', 2, 'tạm dừng', 7, 9, now(), NULL, NULL, NULL),
  (105, 'CD SMS', 'sms_send', 4, 'chờ xử lý', 7, 9, now(), NULL, NULL, NULL),
  (106, 'CD QR dừng còn lease', 'zalo_message_phone', 7, 'tạm dừng', 7, 9, now(), NULL, NULL, gen_random_uuid()),
  (107, 'CD Server dừng', 'zalo_message_phone', 1, 'tạm dừng', 7, 9, now(), NULL, NULL, NULL);
INSERT INTO auto_campaign_input_data(id, campaign_id, phone, status) VALUES (1001, 104, '0901000001', 'hoàn thành'), (1002, 104, '0901000002', 'chờ xử lý');
INSERT INTO auto_staff_device_presence(instance_id, staff_id, organization_id, device_fingerprint_hash, device_label, device_platform, app_version, started_at, last_seen_at, ended_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 7, 9, repeat('a', 64), 'Windows - CU', 'win', '9.1.0', now() - interval '2 days', now() - interval '1 day', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000002', 7, 9, repeat('a', 64), 'Windows - PC', 'win', '9.3.0', now() - interval '1 hour', now() - interval '10 seconds', NULL);
UPDATE auto_staff_device_presence SET runtime_state = '{"v":1,"scheduler":{"state":"running"}}', runtime_state_at = now()
WHERE instance_id = '00000000-0000-0000-0000-000000000002';

DO $test$
DECLARE
  v jsonb; ids bigint[]; r record; t text; n integer; s uuid;
  all_scopes text[] := ARRAY['zalo','sms','zalo_qr','zalo_web'];
BEGIN
  -- A. Đọc: caller cũ giữ nguyên, token mới mở đúng loại tài khoản.
  SET LOCAL ROLE service_role;
  v := aka_agent_control_account_snapshot(7, 9, ARRAY['zalo','sms']);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[1,4]::bigint[], 'legacy snapshot scope ' || ids::text;
  ASSERT v->'desktopPresence' = 'null'::jsonb, 'legacy snapshot has no presence';
  v := aka_agent_control_account_snapshot(7, 9, all_scopes);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[1,2,3,4,7]::bigint[], 'desktop snapshot scope ' || ids::text;
  ASSERT (v->'desktopPresence'->>'online')::boolean AND v->'desktopPresence'->>'appVersion' = '9.3.0', 'live presence picked';
  ASSERT v->'desktopPresence'->'runtime'->'scheduler'->>'state' = 'running', 'runtime snapshot exposed';
  ASSERT (SELECT bool_and(x->'state'->>'has_zalo_session' = 'true') FROM jsonb_array_elements(v->'items') x
    WHERE (x->>'id')::bigint IN (2,3)), 'desktop session follows login status';
  ASSERT (SELECT x->'state'->>'has_zalo_session' FROM jsonb_array_elements(v->'items') x WHERE (x->>'id')::bigint = 7) = 'false', 'logged out desktop';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(v->'runningCampaigns') x WHERE (x->>'id')::bigint = 103) = 1, 'desktop running label';
  v := aka_agent_control_account_snapshot(7, 9, ARRAY['zalo_qr']);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[2,7]::bigint[], 'qr only ' || ids::text;
  v := aka_agent_control_account_snapshot(7, 9, ARRAY['zalo_web']);
  SELECT array_agg((x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[3]::bigint[], 'browser only';
  v := aka_agent_control_account_snapshot(7, 9, ARRAY['sms','zalo_qr'], 'campaigns', ARRAY[2,4,1]::bigint[]);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'catalog') x;
  ASSERT ids = ARRAY[2,4,7]::bigint[], 'campaign catalog scope ' || ids::text;
  v := aka_agent_control_account_snapshot(70, 10, ARRAY['zalo_qr']);
  ASSERT jsonb_array_length(v->'items') = 0 AND (v->'desktopPresence'->>'online')::boolean IS FALSE, 'no presence stays offline';

  v := aka_agent_control_campaign_page(7, 9, ARRAY['zalo','sms']);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[101,105,107]::bigint[], 'legacy page ' || ids::text;
  v := aka_agent_control_campaign_page(7, 9, all_scopes);
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[101,102,103,104,105,106,107]::bigint[], 'desktop page ' || ids::text;
  ASSERT (SELECT (x->>'runtimeBusy')::boolean AND (x->>'isZaloShowWeb')::boolean AND NOT (x->>'isZaloServer')::boolean
    FROM jsonb_array_elements(v->'items') x WHERE (x->>'id')::bigint = 103), 'browser running summary';
  v := aka_agent_control_campaign_page(7, 9, all_scopes, '{"runtimeTargets":["desktop"]}');
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[102,103,104,106]::bigint[], 'desktop filter ' || ids::text;
  v := aka_agent_control_campaign_page(7, 9, all_scopes, '{"runtimeTargets":["web"]}');
  SELECT array_agg((x->>'id')::bigint ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(v->'items') x;
  ASSERT ids = ARRAY[101,105,107]::bigint[], 'web filter ' || ids::text;
  v := aka_agent_control_campaign_page(7, 9, all_scopes, '{}', p_selection => true);
  ASSERT jsonb_array_length(v->'items') = 7, 'selection includes desktop';

  ASSERT aka_agent_control_campaign_logs(7, 9, 102, ARRAY['zalo','sms']) IS NULL, 'legacy logs exclude desktop';
  ASSERT aka_agent_control_campaign_logs(7, 9, 102, ARRAY['zalo_qr']) IS NOT NULL, 'qr logs';
  ASSERT aka_agent_control_campaign_logs(7, 9, 103, ARRAY['zalo_qr']) IS NULL, 'browser needs zalo_web';
  ASSERT aka_agent_control_campaign_logs(7, 9, 101, ARRAY['zalo']) IS NOT NULL, 'server logs unchanged';
  RESET ROLE;

  -- B. Ghi: tài khoản Desktop dùng được, cờ lỗi vẫn bị loại, đổi tài khoản phải cùng nơi chạy.
  v := create_control_campaign_v2(7, 9, 'key-qr-1', '{"accountId":2,"actionId":"zalo_message_phone","name":"Tạo từ Web","schedule":"2026-11-03T08:00:00Z"}', '[]', 'tạm dừng');
  ASSERT (v->>'created')::boolean, 'create desktop campaign';
  n := (v->>'campaign_id')::integer;
  ASSERT (SELECT status FROM auto_campaigns WHERE id = n) = 'tạm dừng', 'initial status kept';
  v := create_control_campaign_v2(7, 9, 'key-qr-1', '{"accountId":2,"actionId":"zalo_message_phone","name":"Tạo từ Web"}', '[]', 'tạm dừng');
  ASSERT NOT (v->>'created')::boolean AND (v->>'campaign_id')::integer = n, 'idempotent desktop replay';
  BEGIN
    PERFORM create_control_campaign_v2(7, 9, 'key-bad', '{"accountId":6,"actionId":"zalo_message_phone","name":"x"}', '[]', 'tạm dừng');
    RAISE EXCEPTION 'anomalous account accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS t = MESSAGE_TEXT;
    ASSERT t = 'control_account_not_found', 'anomalous account rejected: ' || t;
  END;
  v := add_control_campaign_input_rows(7, 9, n::bigint, 'append-1', 0, '[{"phone":"0901000003"}]', now(), 'tạm dừng');
  ASSERT (v->>'inserted')::integer = 1, 'append desktop rows ' || v::text;

  v := update_control_campaign_atomic(7, 9, 104, (SELECT updated_at FROM auto_campaigns WHERE id = 104), '{"name":"CD QR đổi tên"}');
  ASSERT (v->>'updated')::boolean, 'update paused desktop ' || v::text;
  BEGIN
    PERFORM update_control_campaign_atomic(7, 9, 104, (SELECT updated_at FROM auto_campaigns WHERE id = 104), '{"account_id":1}');
    RAISE EXCEPTION 'cross runtime move accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS t = MESSAGE_TEXT;
    ASSERT t = 'control_account_not_found', 'desktop → server rejected: ' || t;
  END;
  v := update_control_campaign_atomic(7, 9, 104, (SELECT updated_at FROM auto_campaigns WHERE id = 104), '{"account_id":3}');
  ASSERT (v->>'updated')::boolean, 'qr → browser stays desktop ' || v::text;
  v := update_control_campaign_atomic(7, 9, 103, (SELECT updated_at FROM auto_campaigns WHERE id = 103), '{"name":"x"}');
  ASSERT v->>'reason' = 'campaign_running', 'running desktop locked';

  v := update_control_campaign_input_statuses_atomic(7, 9, 104, ARRAY[1001]::bigint[], 'chờ xử lý', NULL);
  ASSERT (v->>'updated')::boolean AND (v->>'updated_count')::integer = 1, 'desktop input rerun ' || v::text;

  v := delete_control_campaign_atomic(7, 9, 103);
  ASSERT v->>'reason' = 'campaign_running', 'running desktop not deleted';
  v := delete_control_campaign_atomic(7, 9, 106);
  ASSERT v->>'reason' = 'campaign_running', 'desktop lease blocks delete';
  v := delete_control_campaign_atomic(7, 9, n::bigint);
  ASSERT (v->>'deleted')::boolean, 'idle desktop deleted';
  UPDATE auto_campaigns SET runtime_unit_token = gen_random_uuid() WHERE id = 107;
  v := delete_control_campaign_atomic(7, 9, 107);
  ASSERT (v->>'deleted')::boolean, 'server delete behaviour unchanged';

  -- C. Tạm dừng / tiếp tục chiến dịch Desktop.
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(7, 9, 102, 'tạm dừng');
  ASSERT r.ok AND r.reason = 'updated' AND NOT r.pause_pending AND r.campaign_status = 'tạm dừng', 'pause idle';
  SELECT log INTO t FROM auto_campaign_logs WHERE campaign_id = 102 ORDER BY id DESC LIMIT 1;
  ASSERT t ~ '^\d{2}:\d{2}:\d{2} \d{2}/\d{2}/\d{4} - Zalo QR - CD QR - ⏸ Đã tạm dừng chiến dịch từ Web\.$', 'pause log format: ' || t;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(7, 9, 102, 'tạm dừng');
  ASSERT r.ok AND r.reason = 'already_target', 'pause idempotent';
  SELECT runtime_unit_token INTO s FROM auto_campaigns WHERE id = 103;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(7, 9, 103, 'tạm dừng');
  ASSERT r.ok AND r.pause_pending, 'pause running is boundary request';
  ASSERT (SELECT status = 'tạm dừng' AND runtime_claim_token IS NULL AND runtime_unit_token = s FROM auto_campaigns WHERE id = 103),
    'claim cleared by trigger, unit lease untouched';
  ASSERT (SELECT log LIKE '%App Desktop sẽ dừng sau mục tiêu đang xử lý.' FROM auto_campaign_logs WHERE campaign_id = 103 ORDER BY id DESC LIMIT 1), 'pending log';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(7, 9, 103, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'runtime_busy', 'resume waits for lease';
  UPDATE auto_campaigns SET runtime_unit_token = NULL WHERE id = 103;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(7, 9, 103, 'chờ xử lý');
  ASSERT r.ok AND r.campaign_status = 'chờ xử lý', 'resume after settle';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(7, 9, 101, 'tạm dừng');
  ASSERT NOT r.ok AND r.reason = 'not_found', 'server campaign not routed here';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(8, 9, 102, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'not_found', 'other staff';
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(70, 9, 102, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'inactive_control_staff', 'tenant mismatch';
  UPDATE auto_accounts SET is_active = false WHERE id = 2;
  SELECT * INTO r FROM aka_agent_control_set_desktop_campaign_status(7, 9, 102, 'chờ xử lý');
  ASSERT NOT r.ok AND r.reason = 'account_inactive', 'inactive account';
  UPDATE auto_accounts SET is_active = true WHERE id = 2;
  BEGIN
    PERFORM aka_agent_control_set_desktop_campaign_status(7, 9, 102, 'hoàn thành');
    RAISE EXCEPTION 'invalid target accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS t = MESSAGE_TEXT;
    ASSERT t = 'invalid_desktop_campaign_status', t;
  END;

  -- D. Presence lưu runtime có giới hạn, giữ bản cuối khi kết thúc.
  ASSERT aka_agent_device_presence('u7', 'p7', '00000000-0000-0000-0000-000000000003',
    jsonb_build_object('fingerprintHash', repeat('b', 64), 'label', 'Mac', 'platform', 'mac', 'appVersion', '9.3.0',
      'runtime', '{"v":1,"accounts":[{"id":2,"ready":true}]}'::jsonb), false), 'heartbeat ok';
  ASSERT (SELECT runtime_state->'accounts'->0->>'id' = '2' AND runtime_state_at IS NOT NULL FROM auto_staff_device_presence
    WHERE instance_id = '00000000-0000-0000-0000-000000000003'), 'runtime stored';
  ASSERT aka_agent_device_presence('u7', 'p7', '00000000-0000-0000-0000-000000000003',
    jsonb_build_object('fingerprintHash', repeat('b', 64), 'appVersion', '9.3.0'), false), 'old payload heartbeat';
  ASSERT (SELECT runtime_state->'accounts'->0->>'id' = '2' FROM auto_staff_device_presence
    WHERE instance_id = '00000000-0000-0000-0000-000000000003'), 'missing runtime keeps last snapshot';
  ASSERT aka_agent_device_presence('u7', 'p7', '00000000-0000-0000-0000-000000000003',
    jsonb_build_object('fingerprintHash', repeat('b', 64), 'runtime', jsonb_build_object('pad', repeat('x', 40000))), false), 'oversize heartbeat';
  ASSERT (SELECT runtime_state->'accounts' IS NOT NULL FROM auto_staff_device_presence
    WHERE instance_id = '00000000-0000-0000-0000-000000000003'), 'oversize runtime ignored';
  ASSERT aka_agent_device_presence('u7', 'p7', '00000000-0000-0000-0000-000000000003',
    jsonb_build_object('fingerprintHash', repeat('b', 64), 'runtime', '{"v":1}'::jsonb), true), 'end session';
  ASSERT (SELECT ended_at IS NOT NULL AND runtime_state->'accounts' IS NOT NULL FROM auto_staff_device_presence
    WHERE instance_id = '00000000-0000-0000-0000-000000000003'), 'end keeps last runtime';

  -- E. Xác thực phiên: chính sách mặc định tắt; chỉ Web/PWA của tổ chức chỉ có Desktop mới mở khi bật rõ.
  INSERT INTO auto_control_sessions(id, staff_id, organization_id, token_hash, client_type, expires_at) VALUES
    (gen_random_uuid(), 7, 9, 'h-web-9', 'web', now() + interval '1 day'),
    (gen_random_uuid(), 70, 10, 'h-web-10a', 'web', now() + interval '1 day'),
    (gen_random_uuid(), 70, 10, 'h-web-10b', 'pwa', now() + interval '1 day'),
    (gen_random_uuid(), 70, 10, 'h-native-10', 'native', now() + interval '1 day');
  v := aka_agent_authenticate_control_session('h-web-9');
  ASSERT v->>'status' = 'authenticated' AND v->'web_desktop_accounts' = '{"enabled":false,"desktopOnlyLogin":false}'::jsonb, 'default policy off ' || v::text;
  v := aka_agent_authenticate_control_session('h-web-10a');
  ASSERT v->>'status' = 'capability_unavailable', 'desktop-only blocked by default';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[10],"desktopOnlyLogin":true}' WHERE key = 'web.desktop_accounts';
  v := aka_agent_authenticate_control_session('h-web-10b');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'zalo_server')::boolean IS FALSE
    AND (v->'web_desktop_accounts'->>'desktopOnlyLogin')::boolean, 'desktop-only pwa allowed ' || v::text;
  v := aka_agent_authenticate_control_session('h-native-10');
  ASSERT v->>'status' = 'capability_unavailable', 'native stays blocked';
  v := aka_agent_authenticate_control_session('h-web-9');
  ASSERT v->'web_desktop_accounts' = '{"enabled":false,"desktopOnlyLogin":false}'::jsonb, 'allowlist excludes org 9';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"desktopOnlyLogin":false}' WHERE key = 'web.desktop_accounts';
  ASSERT aka_agent_control_web_desktop_accounts_policy(9) = '{"enabled":true,"desktopOnlyLogin":false}'::jsonb, 'all orgs';
  UPDATE auto_system_settings SET value = '{bad json' WHERE key = 'web.desktop_accounts';
  ASSERT aka_agent_control_web_desktop_accounts_policy(9) = '{"enabled":false,"desktopOnlyLogin":false}'::jsonb, 'invalid json fails closed';
  UPDATE auto_system_settings SET value = '{"enabled":"yes"}' WHERE key = 'web.desktop_accounts';
  ASSERT aka_agent_control_web_desktop_accounts_policy(9)->>'enabled' = 'false', 'non boolean fails closed';

  -- F0. Nguồn Tiến trình Desktop: chỉ chiến dịch Desktop đang/vừa chạy, con trỏ tăng dần.
  INSERT INTO auto_campaign_logs(campaign_id, log, created_at) VALUES
    (103, '10:00:00 03/11/2026 - Zalo trình duyệt - CD trình duyệt - ▶️ Xử lý 1', now() - interval '1 minute'),
    (101, '10:00:01 03/11/2026 - Zalo Server - CD Server - server log', now() - interval '1 minute'),
    (105, '10:00:02 03/11/2026 - SMS - CD SMS - sms log', now() - interval '1 minute');
  UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 103;
  v := aka_agent_control_desktop_activity(7, 9, ARRAY['zalo','sms']);
  ASSERT jsonb_array_length(v->'items') = 0, 'legacy scope has no desktop activity';
  v := aka_agent_control_desktop_activity(7, 9, ARRAY['zalo','sms','zalo_qr','zalo_web']);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE (x->>'campaignId')::bigint IN (101,105)), 'server/sms excluded';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE x->>'campaignId' = '103' AND x->>'accountType' = 'zalo_browser'
    AND x->>'log' LIKE '%Xử lý 1'), 'browser running log included';
  n := (v->>'cursor')::bigint;
  ASSERT n = (SELECT max((x->>'id')::bigint) FROM jsonb_array_elements(v->'items') x), 'cursor is max id';
  v := aka_agent_control_desktop_activity(7, 9, ARRAY['zalo_qr','zalo_web'], n::bigint);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE (x->>'id')::bigint <= n
    AND (x->>'createdAt')::timestamptz < now() - interval '10 seconds'), 'cursor excludes old rows';
  ASSERT (v->>'cursor')::bigint >= n, 'cursor monotonic';
  v := aka_agent_control_desktop_activity(7, 9, ARRAY['zalo_qr'], NULL, 1000);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x WHERE x->>'accountType' = 'zalo_browser'), 'browser needs zalo_web';
  v := aka_agent_control_desktop_activity(8, 9, ARRAY['zalo_qr','zalo_web']);
  ASSERT jsonb_array_length(v->'items') = 0, 'other staff isolated';

  -- F. ACL hàm mới.
  ASSERT NOT has_function_privilege('anon', 'aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('aka_agent_desktop', 'aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'aka_agent_control_web_desktop_accounts_policy(bigint)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)', 'EXECUTE');
  ASSERT has_function_privilege('aka_agent_desktop', 'aka_agent_device_presence(text,text,uuid,jsonb,boolean)', 'EXECUTE'), 'presence ACL kept';
  RAISE NOTICE 'v454 assertions passed';
END
$test$;
ROLLBACK;
