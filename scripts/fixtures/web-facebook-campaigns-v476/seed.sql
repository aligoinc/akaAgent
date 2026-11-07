-- Dữ liệu giả lập cho test v476 (tạo một lần, giữ qua apply/rollback để so caller cũ trước–sau).
-- Nền: fixtures V461 + migration V461 + V464, tức đúng 6 định nghĩa live trước V476.
SET client_min_messages = warning;
INSERT INTO org_organization(id, name) VALUES
  (20, 'Tổ chức Zalo + SMS + Facebook'), (21, 'Tổ chức chỉ Facebook'), (22, 'Tổ chức Facebook hết hạn hôm qua'),
  (23, 'Tổ chức chỉ Fanpage còn hạn hôm nay'), (24, 'Tổ chức Facebook đã xoá gói'), (25, 'Tổ chức Zalo Desktop + Facebook');
INSERT INTO org_staff(id, organization_id, name, username, password, is_active) VALUES
  (201, 20, 'Nhân viên 201', 'u201', 'p201', true), (202, 20, 'Nhân viên 202', 'u202', 'p202', true),
  (211, 21, 'Nhân viên 211', 'u211', 'p211', true), (221, 22, 'Nhân viên 221', 'u221', 'p221', true),
  (231, 23, 'Nhân viên 231', 'u231', 'p231', true), (241, 24, 'Nhân viên 241', 'u241', 'p241', true),
  (251, 25, 'Nhân viên 251', 'u251', 'p251', true);
-- Hạn gói theo ngày Việt Nam: còn hạn khi expiration_date >= 00:00 hôm nay giờ Việt Nam.
INSERT INTO org_organization_product(id, organization_id, product_id, product_name, expiration_date, is_deleted, is_zalo_server, is_zalo_show_web)
SELECT x.id, x.org, x.product, x.name, x.exp, x.deleted, x.server, x.web
FROM (SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' AS day_start) d,
LATERAL (VALUES
  (2001::bigint, 20::bigint, 16::bigint, 'akaAgent Zalo', now() + interval '30 days', false, true, true),
  (2002, 20, 17, 'akaAgent SMS', now() + interval '30 days', false, NULL::boolean, NULL::boolean),
  (2003, 20, 3, 'akaAgent Facebook', now() + interval '30 days', false, NULL, NULL),
  (2101, 21, 3, 'akaAgent Facebook', now() + interval '30 days', false, NULL, NULL),
  (2201, 22, 3, 'akaAgent Facebook', d.day_start - interval '1 second', false, NULL, NULL),
  (2301, 23, 10, 'Fanpage', d.day_start, false, NULL, NULL),
  (2401, 24, 3, 'akaAgent Facebook', now() + interval '30 days', true, NULL, NULL),
  (2501, 25, 16, 'akaAgent Zalo', now() + interval '30 days', false, false, false),
  (2502, 25, 3, 'akaAgent Facebook', now() + interval '30 days', false, NULL, NULL)
) AS x(id, org, product, name, exp, deleted, server, web);
INSERT INTO auto_campaign_actions(id, name, flatform_type, workflow_id) VALUES
  ('zalo_message_phone', 'Zalo - Nhắn tin', 'zalo', 1), ('sms_send', 'SMS', 'sms', 2),
  ('facebook_group_post', 'Đăng bài vào group', 'facebook', 3), ('facebook_comment_seeding', 'Comment seeding', 'facebook', 4);
INSERT INTO auto_accounts(id, name, flatform_type, staff_id, organization_id, is_zalo_server, is_zalo_show_web, is_delete, is_active, zalo_session, login_status, username) VALUES
  (2001, 'Zalo Server', 'zalo', 201, 20, true, false, false, true, '{"cookie":"x"}', 'đã đăng nhập', NULL),
  (2002, 'Zalo QR', 'zalo', 201, 20, false, false, false, true, NULL, 'đã đăng nhập', NULL),
  (2003, 'Zalo trình duyệt', 'zalo', 201, 20, false, true, false, true, NULL, 'chưa đăng nhập', NULL),
  (2004, 'SMS', 'sms', 201, 20, false, false, false, true, NULL, NULL, 'sms-user'),
  (2005, 'FB chính', 'facebook', 201, 20, false, false, false, true, NULL, 'đã đăng nhập', 'fb-login@example.test'),
  (2006, 'FB checkpoint', 'facebook', 201, 20, false, false, false, true, NULL, 'checkpoint', NULL),
  (2007, 'FB đã xoá', 'facebook', 201, 20, false, false, true, true, NULL, 'đã đăng nhập', NULL),
  (2008, 'FB tắt', 'facebook', 201, 20, false, false, false, false, NULL, 'chưa đăng nhập', NULL),
  (2009, 'FB cờ Zalo lạ', 'facebook', 201, 20, true, true, false, true, NULL, 'đã đăng nhập', NULL),
  (2021, 'FB nhân viên 202', 'facebook', 202, 20, false, false, false, true, NULL, 'đã đăng nhập', NULL),
  (2101, 'FB tổ chức 21', 'facebook', 211, 21, false, false, false, true, NULL, 'đã đăng nhập', NULL),
  (2501, 'Zalo QR tổ chức 25', 'zalo', 251, 25, false, false, false, true, NULL, 'đã đăng nhập', NULL),
  (2502, 'FB tổ chức 25', 'facebook', 251, 25, false, false, false, true, NULL, 'đã đăng nhập', NULL);
INSERT INTO auto_campaigns(id, name, action_id, account_id, status, staff_id, organization_id, schedule, is_delete,
  runtime_claim_token, runtime_claim_target, runtime_unit_token, last_run_at) VALUES
  (3001, 'CD Server', 'zalo_message_phone', 2001, 'chờ xử lý', 201, 20, now() - interval '1 hour', false, NULL, NULL, NULL, NULL),
  (3002, 'CD QR', 'zalo_message_phone', 2002, 'chờ xử lý', 201, 20, now() - interval '2 hours', false, NULL, NULL, NULL, now() - interval '5 minutes'),
  (3003, 'CD trình duyệt', 'zalo_message_phone', 2003, 'đang chạy', 201, 20, now() - interval '3 hours', false,
    '00000000-0000-0000-0000-00000000c003', 'desktop', '00000000-0000-0000-0000-00000000d003', now() - interval '1 minute'),
  (3004, 'CD SMS', 'sms_send', 2004, 'chờ xử lý', 201, 20, now() - interval '4 hours', false, NULL, NULL, NULL, NULL),
  (3005, 'CD FB group', 'facebook_group_post', 2005, 'chờ xử lý', 201, 20, now() - interval '5 hours', false, NULL, NULL, NULL, now() - interval '3 minutes'),
  (3006, 'CD FB đang chạy', 'facebook_group_post', 2005, 'đang chạy', 201, 20, now() - interval '6 hours', false,
    '00000000-0000-0000-0000-00000000c006', 'desktop', '00000000-0000-0000-0000-00000000d006', now() - interval '1 minute'),
  (3007, 'CD FB dừng còn lease', 'facebook_comment_seeding', 2006, 'tạm dừng', 201, 20, now() - interval '7 hours', false,
    NULL, NULL, '00000000-0000-0000-0000-00000000d007', NULL),
  (3008, 'CD FB dừng', 'facebook_group_post', 2005, 'tạm dừng', 201, 20, now() - interval '8 hours', false, NULL, NULL, NULL, NULL),
  (3009, 'CD FB tài khoản xoá', 'facebook_group_post', 2007, 'tạm dừng', 201, 20, now() - interval '9 hours', false, NULL, NULL, NULL, NULL),
  (3010, 'CD FB tài khoản tắt', 'facebook_group_post', 2008, 'tạm dừng', 201, 20, now() - interval '10 hours', false, NULL, NULL, NULL, NULL),
  (3011, 'CD FB đã xoá', 'facebook_group_post', 2005, 'chờ xử lý', 201, 20, now() - interval '11 hours', true, NULL, NULL, NULL, NULL),
  (3012, 'CD FB cờ lạ', 'facebook_comment_seeding', 2009, 'chờ xử lý', 201, 20, now() - interval '12 hours', false, NULL, NULL, NULL, NULL),
  (3013, 'CD FB hoàn thành', 'facebook_group_post', 2005, 'hoàn thành', 201, 20, now() - interval '13 hours', false, NULL, NULL, NULL, NULL),
  (3021, 'CD FB nhân viên 202', 'facebook_group_post', 2021, 'chờ xử lý', 202, 20, now() - interval '1 hour', false, NULL, NULL, NULL, NULL),
  (3101, 'CD FB tổ chức 21', 'facebook_group_post', 2101, 'chờ xử lý', 211, 21, now() - interval '1 hour', false, NULL, NULL, NULL, NULL),
  (3501, 'CD QR tổ chức 25', 'zalo_message_phone', 2501, 'chờ xử lý', 251, 25, now() - interval '1 hour', false, NULL, NULL, NULL, NULL),
  (3502, 'CD FB tổ chức 25', 'facebook_group_post', 2502, 'chờ xử lý', 251, 25, now() - interval '1 hour', false, NULL, NULL, NULL, NULL);
INSERT INTO auto_campaign_input_data(id, campaign_id, uid, name, status) VALUES
  (30051, 3005, 'https://www.facebook.com/groups/100000001', 'Group 1', 'hoàn thành'),
  (30052, 3005, 'https://www.facebook.com/groups/100000002', 'Group 2', 'chờ xử lý'),
  (30021, 3002, '0901000001', 'Khách 1', 'hoàn thành');
-- Log cũ hơn 10 giây để con trỏ Tiến trình không phụ thuộc thời điểm chạy test.
INSERT INTO auto_campaign_logs(campaign_id, log, created_at) VALUES
  (3002, '10:00:00 07/11/2026 - Zalo QR - CD QR - ▶️ Xử lý QR', now() - interval '2 minutes'),
  (3003, '10:00:01 07/11/2026 - Zalo trình duyệt - CD trình duyệt - ▶️ Xử lý trình duyệt', now() - interval '2 minutes'),
  (3001, '10:00:02 07/11/2026 - Zalo Server - CD Server - server log', now() - interval '2 minutes'),
  (3004, '10:00:03 07/11/2026 - SMS - CD SMS - sms log', now() - interval '2 minutes'),
  (3005, '10:00:04 07/11/2026 - FB chính - CD FB group - 📝 Đăng bài thành công vào Group 1', now() - interval '2 minutes'),
  (3006, '10:00:05 07/11/2026 - FB chính - CD FB đang chạy - 📝 Đăng bài thành công vào Group 3', now() - interval '1 minute'),
  (3021, '10:00:06 07/11/2026 - FB nhân viên 202 - CD FB nhân viên 202 - log khác', now() - interval '1 minute');
-- last_seen_at ở tương lai: online không phụ thuộc thời gian chạy test (ngưỡng 120 giây).
INSERT INTO auto_staff_device_presence(instance_id, staff_id, organization_id, device_fingerprint_hash, device_label, device_platform, app_version, started_at, last_seen_at, ended_at, runtime_state, runtime_state_at) VALUES
  ('00000000-0000-0000-0000-000000000201', 201, 20, repeat('a', 64), 'Windows - PC', 'win', '9.4.0', now() - interval '1 hour', now() + interval '1 day', NULL,
    '{"v":1,"scheduler":{"state":"running"}}', now() - interval '5 seconds'),
  ('00000000-0000-0000-0000-000000000211', 211, 21, repeat('b', 64), 'Mac - FB', 'mac', '9.4.0', now() - interval '1 hour', now() + interval '1 day', NULL, NULL, NULL);
INSERT INTO auto_control_sessions(id, staff_id, organization_id, token_hash, client_type, expires_at, last_seen_at) VALUES
  ('00000000-0000-0000-0000-0000000a2010', 201, 20, 'h-201-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2011', 201, 20, 'h-201-native', 'native', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2110', 211, 21, 'h-211-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2111', 211, 21, 'h-211-pwa', 'pwa', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2112', 211, 21, 'h-211-native', 'native', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2113', 211, 21, 'h-211-other', 'desktop', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2210', 221, 22, 'h-221-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2310', 231, 23, 'h-231-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2410', 241, 24, 'h-241-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a2510', 251, 25, 'h-251-web', 'web', now() + interval '1 day', now());
-- Giá trị chính sách V461 đang chạy trên production (bật cho mọi tổ chức, cho tổ chức chỉ có Desktop đăng nhập).
UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"desktopOnlyLogin":true}' WHERE key = 'web.desktop_accounts';
