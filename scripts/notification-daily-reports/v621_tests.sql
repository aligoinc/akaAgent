-- V621 behaviour checks. Chạy sau setup.sql + V457/V465/V466/V467/V520 + v621_fixture.sql + V621 (xem smoke_v621.sh).
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE FUNCTION public.fixture_assert(p_ok boolean, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_message; END IF;
  RETURN 'ok  - ' || p_message;
END $$;
CREATE FUNCTION public.fixture_error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.fixture_assert(boolean, text), public.fixture_error(text) TO PUBLIC;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

\echo '== ràng buộc và quyền'
SELECT fixture_assert((SELECT pg_get_constraintdef(oid) LIKE '%report.morning%' AND pg_get_constraintdef(oid) LIKE '%package.expiring%'
                         FROM pg_constraint WHERE conname = 'auto_notifications_event_type_check'), 'auto_notifications nhận report.morning, giữ loại cũ');
SELECT fixture_assert((SELECT pg_get_constraintdef(oid) LIKE '%default_seed%' AND pg_get_constraintdef(oid) LIKE '%legacy%'
                         FROM pg_constraint WHERE conname = 'auto_email_notification_settings_client_check'), 'cài đặt nhận updated_by_client default_seed');
SELECT fixture_assert(NOT has_function_privilege('anon', 'private.aka_agent_notification_seed_defaults(timestamptz)', 'EXECUTE')
                      AND NOT has_function_privilege('service_role', 'private.aka_agent_notification_morning(bigint,text,timestamptz)', 'EXECUTE'),
                      'hàm mới chỉ chủ sở hữu gọi được');
SELECT fixture_assert(has_function_privilege('service_role', 'public.aka_agent_notification_snapshot(text,jsonb)', 'EXECUTE'), 'snapshot vẫn cho service_role');

\echo '== gieo mặc định: tắt thì không làm gì'
SELECT fixture_assert(private.aka_agent_notification_seed_defaults(now()) = '{"audience":"off"}'::jsonb, 'audience off: không gieo');
SELECT fixture_assert((SELECT count(*) FROM auto_notification_subscriptions WHERE staff_id = 2) = 0, 'nhân viên 2 chưa có đăng ký');

\echo '== gieo mặc định: chỉ tổ chức trong danh sách'
UPDATE auto_system_settings SET value = '{"audience":"orgs","organizationIds":[2]}' WHERE key = 'notifications.default_reports';
SELECT fixture_assert((private.aka_agent_notification_seed_defaults(now()) ->> 'seeded')::int = 0, 'tổ chức khác: không gieo');

\echo '== gieo mặc định: nhân viên chưa có email'
UPDATE auto_system_settings SET value = '{"audience":"all","batch":50}' WHERE key = 'notifications.default_reports';
SELECT fixture_assert((SELECT r ->> 'seeded' = '1' AND r ->> 'morningAdded' = '1' FROM (SELECT private.aka_agent_notification_seed_defaults(now()) r) x),
                      'gieo nhân viên 2 (chưa có cài đặt) và thêm Chào ngày mới cho nhân viên 1 (đã có cài đặt)');
SELECT fixture_assert((SELECT NOT is_enabled AND push_enabled AND cardinality(recipient_emails) = 0 AND updated_by_client = 'default_seed'
                         FROM auto_email_notification_settings WHERE staff_id = 2), 'chưa có email: tắt Email, bật App, không xin email');
SELECT fixture_assert((SELECT count(*) = 3 AND bool_and(is_enabled AND push_enabled AND NOT email_enabled)
                         FROM auto_notification_subscriptions WHERE staff_id = 2), 'ba đăng ký bật, chỉ hộp thư + App');
SELECT fixture_assert((SELECT schedule_times = ARRAY['12:00'::time, '18:00'::time] AND (filters ->> 'skipWhenIdle')::boolean AND next_run_at IS NOT NULL
                         FROM auto_notification_subscriptions WHERE staff_id = 2 AND event_type = 'report.scheduled'), 'báo cáo 12:00 + 18:00, bỏ khi không có gì');
SELECT fixture_assert((SELECT schedule_times = ARRAY['07:00'::time] AND next_run_at IS NOT NULL
                         FROM auto_notification_subscriptions WHERE staff_id = 2 AND event_type = 'report.morning'), 'Chào ngày mới 07:00');
SELECT fixture_assert((SELECT filters -> 'toStatuses' = '["hoàn thành"]'::jsonb FROM auto_notification_subscriptions
                         WHERE staff_id = 2 AND event_type = 'campaign.status_changed'), 'chiến dịch: chỉ Hoàn thành');
SELECT fixture_assert((SELECT updated_by_client IS DISTINCT FROM 'default_seed' FROM auto_email_notification_settings WHERE staff_id = 1)
                      AND (SELECT count(*) FROM auto_notification_subscriptions WHERE staff_id = 1 AND event_type = 'report.morning' AND email_enabled) = 1,
                      'nhân viên đã có cài đặt: chỉ thêm Chào ngày mới, theo kênh email đang bật');
SELECT fixture_assert((SELECT count(*) FROM auto_notification_subscriptions WHERE staff_id = 3) = 0, 'nhân viên nghỉ: không gieo');
SELECT fixture_assert((SELECT r ->> 'seeded' = '0' AND r ->> 'morningAdded' = '0' FROM (SELECT private.aka_agent_notification_seed_defaults(now()) r) x),
                      'chạy lại: không gieo trùng');

\echo '== có email thì tự bật Email'
UPDATE org_staff SET email = ' Nam@Example.Test ' WHERE id = 2;
SELECT fixture_assert((private.aka_agent_notification_seed_defaults(now()) ->> 'emailAdded')::int = 1, 'có email: bật kênh Email');
SELECT fixture_assert((SELECT is_enabled AND recipient_emails = ARRAY['nam@example.test'] AND verified_emails = ARRAY['nam@example.test']
                         FROM auto_email_notification_settings WHERE staff_id = 2), 'email đã chuẩn hoá và coi là đã xác minh');
SELECT fixture_assert((SELECT bool_and(email_enabled) FROM auto_notification_subscriptions WHERE staff_id = 2), 'ba đăng ký bật Email');
UPDATE org_staff SET email = 'khong-hop-le' WHERE id = 2;
SELECT fixture_assert(private.aka_agent_notification_default_email(2) IS NULL, 'email sai dạng: không dùng');

\echo '== cài đặt: Chào ngày mới'
SELECT fixture_assert((SELECT s #>> '{subscriptions,morningReport,time}' = '07:00' AND (s #>> '{subscriptions,morningReport,enabled}')::boolean
                         FROM (SELECT private.aka_agent_notification_center(2, 1, 'web', 'get_settings', '{}', NULL) s) x), 'get_settings trả morningReport');
SELECT fixture_assert(fixture_error($$SELECT private.aka_agent_notification_center(2, 1, 'web', 'save_settings',
  jsonb_build_object('revision', (SELECT revision FROM auto_email_notification_settings WHERE staff_id = 2),
                     'subscriptions', '{"morningReport":{"enabled":true,"email":false,"push":true,"time":"09:00","skipWhenIdle":true}}'::jsonb), NULL)$$)
                      LIKE '22023:notification_invalid_schedule', 'giờ ngoài 06:00–08:00 bị từ chối');
SELECT private.aka_agent_notification_center(2, 1, 'web', 'save_settings',
  jsonb_build_object('revision', (SELECT revision FROM auto_email_notification_settings WHERE staff_id = 2),
                     'subscriptions', '{"morningReport":{"enabled":true,"email":false,"push":true,"time":"06:30","skipWhenIdle":false}}'::jsonb), NULL) IS NOT NULL;
SELECT fixture_assert((SELECT schedule_times = ARRAY['06:30'::time] AND NOT (filters ->> 'skipWhenIdle')::boolean
                         FROM auto_notification_subscriptions WHERE staff_id = 2 AND event_type = 'report.morning'), 'lưu giờ 06:30');
SELECT fixture_assert((SELECT updated_by_client = 'web' FROM auto_email_notification_settings WHERE staff_id = 2), 'khách đã lưu: thôi là dòng gieo sẵn');
SELECT private.aka_agent_notification_center(2, 1, 'desktop', 'save_settings',
  jsonb_build_object('revision', (SELECT revision FROM auto_email_notification_settings WHERE staff_id = 2)), NULL) IS NOT NULL;
SELECT fixture_assert((SELECT schedule_times = ARRAY['06:30'::time] AND is_enabled FROM auto_notification_subscriptions
                         WHERE staff_id = 2 AND event_type = 'report.morning'), 'client cũ (không gửi morningReport) không đổi Chào ngày mới');
SELECT fixture_assert(fixture_error($$SELECT private.aka_agent_notification_center(2, 1, 'web', 'list', '{"eventType":"report.morning"}', NULL)$$) = 'no error',
                      'hộp thư lọc được report.morning');
SELECT fixture_assert(private.aka_agent_notification_center(2, 1, 'web', 'unsubscribe', '{"eventType":"report.morning"}', NULL) ->> 'ok' = 'true',
                      'link tắt nhận Chào ngày mới');
SELECT fixture_assert((SELECT NOT email_enabled FROM auto_notification_subscriptions WHERE staff_id = 2 AND event_type = 'report.morning'), 'đã tắt email Chào ngày mới');

\echo '== lập lịch'
UPDATE auto_notification_subscriptions SET next_run_at = now() - interval '1 minute' WHERE event_type IN ('report.morning', 'report.scheduled');
SELECT fixture_assert(private.aka_agent_notification_schedule_reports(now()) = 4, 'lập lịch cả Chào ngày mới lẫn báo cáo (2 nhân viên × 2 loại)');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE event_type = 'report.morning' AND dedupe_key LIKE 'rm:%' AND entity_key LIKE 'morning:%') = 2,
                      'Chào ngày mới có khoá riêng');
SELECT fixture_assert((SELECT bool_and(deliver_after = occurred_at + make_interval(secs => (staff_id % 241)::double precision))
                         FROM auto_notifications WHERE event_type IN ('report.morning', 'report.scheduled')), 'dựng rải theo nhân viên');
SELECT fixture_assert((SELECT bool_and(next_run_at > now()) FROM auto_notification_subscriptions WHERE event_type IN ('report.morning','report.scheduled') AND is_enabled),
                      'nhảy tới mốc kế tiếp');
SELECT fixture_assert(private.aka_agent_notification_schedule_reports(now()) = 0, 'không tạo trùng');

\echo '== số liệu: tài khoản × thao tác'
INSERT INTO auto_account_actions VALUES (1, 'zalo_find_phone_user', 'Zalo - Tìm SĐT'), (2, 'zalo_message_stranger', 'Zalo - Nhắn tin người lạ');
UPDATE auto_campaign_actions SET limit_check_action_codes = ARRAY['zalo_find_phone_user', 'zalo_message_stranger'] WHERE id = 'zalo_message_phone';
INSERT INTO auto_campaign_details (campaign_id, account_id, action_name, action_code, status, report_group, created_at, error_code) VALUES
  (11, 100, 'Nhắn tin', 'zalo_message_stranger', 'thành công', 'success', now(), NULL),
  (11, 100, 'Nhắn tin', 'zalo_message_stranger', 'thành công', 'success', now(), NULL),
  (11, 100, 'Nhắn tin', 'zalo_message_stranger', 'thất bại', 'failure', now(), 'err_z122'),
  (11, 100, 'Tìm SĐT', 'zalo_find_phone_user', 'thành công', 'success', now(), NULL),
  (11, 100, 'Nhắn tin', 'zalo_message_stranger', 'thành công', 'success', date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' - interval '2 hours', NULL);
INSERT INTO auto_campaign_input_data (campaign_id, status) SELECT 11, 'chờ xử lý' FROM generate_series(1, 40);
SELECT fixture_assert((SELECT a #> '{actions}' @> '[{"code":"zalo_message_stranger","success":2,"failure":1,"pending":41}]'::jsonb
                         FROM jsonb_array_elements(public.aka_agent_notification_snapshot('account_actions', '{"staffId":1,"window":"today"}') -> 'accountActions') a
                        WHERE (a ->> 'accountId')::int = 100), 'hôm nay: thành công / thất bại / chờ của tài khoản × thao tác');
SELECT fixture_assert((SELECT (r ->> 'pendingTotal')::int = 41 AND r ->> 'window' = 'today'
                         FROM (SELECT public.aka_agent_notification_snapshot('account_actions', '{"staffId":1}') r) x), 'tổng data chờ');
SELECT fixture_assert((SELECT r -> 'pendingTotal' = 'null'::jsonb AND (r #> '{accountActions,0,actions}') @> '[{"code":"zalo_message_stranger","success":1,"pending":null}]'::jsonb
                         FROM (SELECT public.aka_agent_notification_snapshot('account_actions', '{"staffId":1,"window":"yesterday"}') r) x), 'hôm qua: không có số chờ');

\echo '== số liệu: chiến dịch hoàn thành hôm nay, lý do thất bại'
INSERT INTO auto_error (error_code, public_code, customer_title) VALUES ('err_z122', 'Z122', 'Người nhận chặn tin nhắn từ người lạ');
UPDATE auto_campaigns SET status = 'hoàn thành', completed_at = now() WHERE id = 11;
INSERT INTO auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id, completed_at)
VALUES (90, 'Up tin cho chiến dịch "Bán hàng"', 'facebook_comment_seeding_post', 100, 'hoàn thành', 1, 1, now());
SELECT fixture_assert((SELECT jsonb_array_length(r -> 'completedToday') = 1 AND r #>> '{completedToday,0,id}' = '11'
                              AND (r #>> '{completedToday,0,success}')::int = 3 AND (r #>> '{completedToday,0,failure}')::int = 1
                         FROM (SELECT public.aka_agent_notification_snapshot('report', '{"staffId":1}') r) x),
                      'báo cáo có Chiến dịch hoàn thành hôm nay, bỏ Up tin, không tính Tìm SĐT');
SELECT fixture_assert(public.aka_agent_notification_snapshot('failure_reasons', '{"staffId":1,"campaignId":11}') -> 'failureReasons'
                      = '[{"code":"Z122","label":"Người nhận chặn tin nhắn từ người lạ","count":1}]'::jsonb, 'lý do thất bại theo mã công khai');
SELECT fixture_assert(public.aka_agent_notification_snapshot('failure_reasons', '{"staffId":2,"campaignId":11}') = '{"found":false}'::jsonb,
                      'chiến dịch của người khác: không trả');

\echo '== số liệu: Chào ngày mới'
UPDATE auto_campaigns SET status = 'chờ xử lý', completed_at = NULL, schedule = now() + interval '1 hour', schedule_type = 'daily' WHERE id = 11;
INSERT INTO v621_test_limits VALUES (11, 'zalo_message_stranger', 25);
INSERT INTO auto_account_action_status (account_id, action_code, count_action_in_day, count_date)
VALUES (100, 'zalo_message_stranger', 5, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
-- Lịch tuần cũ (máy tắt qua đêm, chưa dời): chỉ tính khi hôm nay là ngày chạy.
UPDATE auto_campaigns SET schedule = now() - interval '3 days', schedule_type = 'weekly',
       schedule_week_days = ((extract(isodow FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int % 7) + 2)::text WHERE id = 10;
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id BETWEEN 31 AND 36;
SELECT fixture_assert((SELECT jsonb_array_length(r -> 'campaignsToday') = 1 AND r #>> '{campaignsToday,0,id}' = '11'
                              AND (r #>> '{campaignsToday,0,pendingInputs}')::int = 40 AND (r #>> '{campaignsToday,0,expectedToday}')::int = 20
                              AND (r #>> '{campaignsToday,0,dailyLimit}')::int = 25
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'chiến dịch hôm nay: dự kiến = min(data chờ, giới hạn ngày còn lại); bỏ lịch tuần không phải hôm nay');
UPDATE auto_campaigns SET schedule_week_days = ((extract(isodow FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int) + 1)::text WHERE id = 10;
SELECT fixture_assert((SELECT jsonb_array_length(r -> 'campaignsToday') = 2 FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'lịch tuần đúng ngày hôm nay: có trong danh sách');
INSERT INTO auto_campaign_input_data (campaign_id, status) SELECT 10, 'chờ xử lý' FROM generate_series(1, 30);
INSERT INTO v621_test_limits VALUES (10, 'zalo_message_stranger', 25);
UPDATE auto_campaigns SET schedule = now() + interval '30 minutes' WHERE id = 10;
SELECT fixture_assert((SELECT r #> '{campaignsToday}' @> '[{"id":10,"pendingInputs":31,"expectedToday":20},{"id":11,"pendingInputs":40,"expectedToday":0}]'::jsonb
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'hai chiến dịch cùng tài khoản chia giới hạn ngày còn lại theo giờ chạy');
UPDATE auto_accounts SET login_status = 'chưa đăng nhập' WHERE id = 100;
SELECT fixture_assert((SELECT r #>> '{issues,0,subject}' = 'Zalo Shop Hà' AND r #>> '{issues,0,message}' LIKE '%đăng xuất%2 chiến dịch%'
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x), 'tài khoản cần xử lý trước giờ chạy');
SELECT fixture_assert((SELECT r -> 'reportTimes' = '["08:00"]'::jsonb AND (r ->> 'campaignNotify')::boolean
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x), 'giờ báo cáo trong ngày và thông báo Hoàn thành');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_snapshot('nope', '{"staffId":1}')$$) LIKE '22023:%', 'loại lạ vẫn bị từ chối');

\echo '== tick gọi gieo mặc định (chế độ fly)'
UPDATE auto_system_settings SET value = 'true' WHERE key = 'notifications.enabled';
UPDATE auto_system_settings SET value = 'fly' WHERE key = 'notifications.dispatch_mode';
UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = NULL, leased_until = NULL WHERE id = 1;
SET ROLE service_role;
SELECT fixture_assert((SELECT r #> '{cleanup,seed}' ? 'seeded' FROM (SELECT public.aka_agent_notification_tick() r) x), 'tick chạy gieo mặc định khi dọn hằng giờ');
RESET ROLE;
UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = NULL, leased_until = NULL WHERE id = 1;
UPDATE auto_system_settings SET value = '{"audience":' WHERE key = 'notifications.default_reports';
SET ROLE service_role;
SELECT fixture_assert((SELECT r #>> '{cleanup,seed,error}' = 'invalid_setting' FROM (SELECT public.aka_agent_notification_tick() r) x),
                      'cài đặt hỏng: tick vẫn chạy, gieo báo lỗi');
RESET ROLE;
\echo PASS
