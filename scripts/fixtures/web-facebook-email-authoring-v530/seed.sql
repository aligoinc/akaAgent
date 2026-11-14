-- Dữ liệu giả lập cho test v530 (tạo một lần, giữ qua apply/rollback để so caller cũ trước–sau).
-- Nền: fixtures V461 + migration V461/V464/V476/V490 + schema-extension.sql = đúng định nghĩa live trước v530.
SET client_min_messages = warning;
INSERT INTO org_organization(id, name) VALUES
  (30, 'Tổ chức đủ gói Zalo Server + SMS + Facebook + Email'), (31, 'Tổ chức chỉ Email'), (32, 'Tổ chức Email hết hạn hôm qua'),
  (33, 'Tổ chức Email còn hạn tới đầu ngày hôm nay'), (34, 'Tổ chức chỉ Facebook'), (35, 'Tổ chức Email tách quyền');
INSERT INTO org_staff(id, organization_id, name, username, password, is_active) VALUES
  (301, 30, 'Nhân viên 301', 'u301', 'p301', true), (302, 30, 'Nhân viên 302 (app tắt)', 'u302', 'p302', true),
  (303, 30, 'Nhân viên 303 (chưa từng mở app)', 'u303', 'p303', true), (304, 30, 'Nhân viên 304 nghỉ', 'u304', 'p304', false),
  (311, 31, 'Nhân viên 311', 'u311', 'p311', true), (321, 32, 'Nhân viên 321', 'u321', 'p321', true),
  (331, 33, 'Nhân viên 331', 'u331', 'p331', true), (341, 34, 'Nhân viên 341', 'u341', 'p341', true),
  (351, 35, 'Nhân viên 351', 'u351', 'p351', true);
-- Hạn gói theo ngày Việt Nam: còn hạn khi expiration_date >= 00:00 hôm nay giờ Việt Nam.
INSERT INTO org_organization_product(id, organization_id, product_id, product_name, expiration_date, is_deleted, is_zalo_server, is_zalo_show_web, max_accounts)
SELECT x.id, x.org, x.product, x.name, x.exp, false, x.server, x.web, x.max_accounts
FROM (SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' AS day_start) d,
LATERAL (VALUES
  (3001::bigint, 30::bigint, 16::bigint, 'akaAgent Zalo', now() + interval '30 days', true, true, 10),
  (3002, 30, 17, 'akaAgent SMS', now() + interval '30 days', NULL::boolean, NULL::boolean, 5),
  (3003, 30, 3, 'akaAgent Facebook', now() + interval '30 days', NULL, NULL, 10),
  (3004, 30, 13, 'Email Marketing', now() + interval '30 days', NULL, NULL, 4),
  (3101, 31, 13, 'Email Marketing', now() + interval '30 days', NULL, NULL, 2),
  (3201, 32, 13, 'Email Marketing', d.day_start - interval '1 second', NULL, NULL, 2),
  (3301, 33, 13, 'Email Marketing', d.day_start, NULL, NULL, 2),
  (3401, 34, 3, 'akaAgent Facebook', now() + interval '30 days', NULL, NULL, 5),
  (3501, 35, 13, 'Email Marketing', now() + interval '30 days', NULL, NULL, 1)
) AS x(id, org, product, name, exp, server, web, max_accounts);
INSERT INTO auto_campaign_actions(id, name, flatform_type, workflow_id, allow_multiple_accounts, allow_secondary_account) VALUES
  ('zalo_message_phone', 'Zalo - Nhắn tin theo SĐT', 'zalo', 1, true, true),
  ('zalo_join_group_link', 'Zalo - Tham gia group', 'zalo', 2, true, false),
  ('sms_send', 'SMS', 'sms', 3, true, false),
  ('facebook_group_post', 'Đăng bài vào group', 'facebook', 4, true, true),
  ('facebook_message_uid', 'Nhắn tin & kết bạn UID', 'facebook', 5, true, true),
  ('facebook_timeline_post', 'Đăng trang cá nhân', 'facebook', 6, true, false),
  ('facebook_comment_seeding', 'Comment group/page/profile', 'facebook', 7, true, false),
  ('facebook_comment_seeding_post', 'Comment danh sách bài', 'facebook', 8, true, false),
  ('facebook_join_group', 'Tham gia group', 'facebook', 9, true, false),
  ('facebook_find_data_group', 'Tìm data trong group', 'facebook', 10, true, false),
  ('facebook_find_data_search', 'Tìm data bằng từ khoá', 'facebook', 11, true, false),
  ('email_send', 'Gửi email', 'email', 12, true, false);
INSERT INTO auto_account_groups(id, name, settings, flatform_type, staff_id, organization_id, is_delete) VALUES
  (3901, 'Nhóm Email 301', '{}', 'email', 301, 30, false),
  (3902, 'Nhóm Zalo 301', '{}', 'zalo', 301, 30, false),
  (3903, 'Nhóm Email 302', '{}', 'email', 302, 30, false),
  (3904, 'Nhóm Email đã xoá', '{}', 'email', 301, 30, true),
  (3905, 'Nhóm Email 301 B', '{}', 'email', 301, 30, false);
INSERT INTO auto_proxies(id, name) VALUES (3951, 'Proxy 301');
-- Phiên Desktop (JWT sub → nhân viên) như private.aka_agent_desktop_users của production. 303 chưa từng đăng nhập 9.x.
INSERT INTO private.aka_agent_desktop_users(staff_id, auth_user_id) VALUES
  (301, '00000000-0000-4000-8000-000000000301'), (302, '00000000-0000-4000-8000-000000000302');
INSERT INTO auto_accounts(id, name, flatform_type, staff_id, organization_id, is_zalo_server, is_zalo_show_web, is_delete, is_active,
  zalo_session, login_status, status, username, email_session, email_session_updated_at, email_session_last_verified_at, account_group_id) VALUES
  (3001, 'Zalo Server', 'zalo', 301, 30, true, false, false, true, '{"cookie":"x"}', 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3002, 'Zalo QR', 'zalo', 301, 30, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3003, 'Zalo trình duyệt', 'zalo', 301, 30, false, true, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3004, 'SMS', 'sms', 301, 30, false, false, false, true, NULL, NULL, 'chờ xử lý', 'sms-user', NULL, NULL, NULL, NULL),
  (3005, 'FB chính', 'facebook', 301, 30, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', 'fb@example.test', NULL, NULL, NULL, NULL),
  (3006, 'FB phụ', 'facebook', 301, 30, false, false, false, true, NULL, 'checkpoint', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3007, 'FB đã xoá', 'facebook', 301, 30, false, false, true, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3008, 'FB tắt', 'facebook', 301, 30, false, false, false, false, NULL, 'chưa đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3009, 'Email chính', 'email', 301, 30, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL,
    '{"brandName":"Shop","host":"smtp.gmail.com","port":587,"secure":false,"user":"shop@example.test","pass":"secret-old","fromEmail":"shop@example.test","replyTo":"","cc":""}',
    now() - interval '2 days', now() - interval '2 days', 3901),
  (3010, 'Email đang chạy', 'email', 301, 30, false, false, false, true, NULL, 'đã đăng nhập', 'đang chạy', NULL,
    '{"brandName":"","host":"smtp.example.test","port":465,"secure":true,"user":"u2","pass":"p2","fromEmail":"b@example.test","replyTo":"","cc":""}',
    now() - interval '1 day', now() - interval '1 day', NULL),
  (3011, 'Email đã xoá', 'email', 301, 30, false, false, true, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3012, 'FB tài khoản chiến dịch đã xoá', 'facebook', 301, 30, false, false, true, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3021, 'FB nhân viên 302', 'facebook', 302, 30, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3022, 'Email nhân viên 302', 'email', 302, 30, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL,
    '{"brandName":"","host":"h","port":587,"secure":false,"user":"u","pass":"p","fromEmail":"c@example.test","replyTo":"","cc":""}', now(), now(), NULL),
  (3023, 'Zalo QR nhân viên 302', 'zalo', 302, 30, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3031, 'FB nhân viên 303', 'facebook', 303, 30, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3111, 'Email tổ chức 31', 'email', 311, 31, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL,
    '{"brandName":"","host":"h","port":587,"secure":false,"user":"u","pass":"p","fromEmail":"d@example.test","replyTo":"","cc":""}', now(), now(), NULL),
  (3411, 'FB tổ chức 34', 'facebook', 341, 34, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL, NULL, NULL, NULL, NULL),
  (3511, 'Email tổ chức 35', 'email', 351, 35, false, false, false, true, NULL, 'đã đăng nhập', 'chờ xử lý', NULL,
    '{"brandName":"","host":"h","port":587,"secure":false,"user":"u","pass":"p","fromEmail":"e@example.test","replyTo":"","cc":""}', now(), now(), NULL);
INSERT INTO auto_campaigns(id, name, action_id, account_id, secondary_account_id, status, staff_id, organization_id, schedule, is_delete,
  extra_settings, runtime_claim_token, runtime_claim_target, runtime_unit_token, last_run_at, content) VALUES
  (30001, 'CD Server', 'zalo_message_phone', 3001, NULL, 'tạm dừng', 301, 30, now() - interval '1 hour', false,
    '{"zaloFriendDataMaterializedAt":"2026-11-01T00:00:00Z","enableMessage":true}', NULL, NULL, '00000000-0000-0000-0000-0000000d3001', NULL, 'Xin chào'),
  (30002, 'CD QR', 'zalo_message_phone', 3002, NULL, 'tạm dừng', 301, 30, now() - interval '2 hours', false,
    '{"enableMessage":true,"zaloBirthdayMaterializedCount":4}', NULL, NULL, NULL, now() - interval '5 minutes', 'Nội dung QR'),
  (30003, 'CD trình duyệt còn lease', 'zalo_message_phone', 3003, NULL, 'tạm dừng', 301, 30, now() - interval '3 hours', false,
    '{}', NULL, NULL, '00000000-0000-0000-0000-0000000d3003', now() - interval '1 minute', ''),
  (30004, 'CD SMS', 'sms_send', 3004, NULL, 'chờ xử lý', 301, 30, now() - interval '4 hours', false, '{}', NULL, NULL, NULL, NULL, 'SMS'),
  (30005, 'CD FB group', 'facebook_group_post', 3005, 3006, 'tạm dừng', 301, 30, now() - interval '5 hours', false,
    '{"contentRotationIndex":3,"postBumpCreatedCampaignIdsByAccount":{"3005":30015},"enablePostBump":true,"imageOption":"all"}',
    NULL, NULL, NULL, now() - interval '3 minutes', 'Bài đăng'),
  (30006, 'CD FB dừng còn claim', 'facebook_group_post', 3005, NULL, 'tạm dừng', 301, 30, now() - interval '6 hours', false,
    '{}', '00000000-0000-0000-0000-0000000c3006', 'desktop', NULL, now() - interval '1 minute', ''),
  (30007, 'CD FB đang chạy', 'facebook_group_post', 3005, NULL, 'đang chạy', 301, 30, now() - interval '7 hours', false,
    '{}', '00000000-0000-0000-0000-0000000c3007', 'desktop', '00000000-0000-0000-0000-0000000d3007', now() - interval '1 minute', ''),
  (30008, 'CD Email', 'email_send', 3009, NULL, 'tạm dừng', 301, 30, now() - interval '8 hours', false,
    '{"emailSubject":"Chào","emailBodyIsHtml":true}', NULL, NULL, NULL, now() - interval '4 minutes', '<p>Xin chào</p>'),
  (30009, 'CD Email còn lease', 'email_send', 3009, NULL, 'tạm dừng', 301, 30, now() - interval '9 hours', false,
    '{}', NULL, NULL, '00000000-0000-0000-0000-0000000d3009', now() - interval '1 minute', ''),
  (30010, 'CD tìm data group', 'facebook_find_data_group', 3005, NULL, 'tạm dừng', 301, 30, now() - interval '10 hours', false,
    '{"isFindUid":true,"findUidTargetCampaignIds":[30099,"30012"]}', NULL, NULL, NULL, NULL, ''),
  (30011, 'CD tìm data từ khoá', 'facebook_find_data_search', 3005, NULL, 'chờ xử lý', 301, 30, now() - interval '11 hours', false,
    NULL, NULL, NULL, NULL, NULL, ''),
  (30012, 'CD nhắn UID', 'facebook_message_uid', 3005, NULL, 'tạm dừng', 301, 30, now() - interval '12 hours', false, '{}', NULL, NULL, NULL, NULL, ''),
  (30013, 'CD tham gia group', 'facebook_join_group', 3005, NULL, 'tạm dừng', 301, 30, now() - interval '13 hours', false, '{}', NULL, NULL, NULL, NULL, ''),
  (30014, 'CD Zalo nhận SĐT', 'zalo_message_phone', 3002, NULL, 'tạm dừng', 301, 30, now() - interval '14 hours', false, '{}', NULL, NULL, NULL, NULL, ''),
  (30015, 'CD FB đã xoá', 'facebook_group_post', 3005, NULL, 'tạm dừng', 301, 30, now() - interval '15 hours', true, '{}', NULL, NULL, NULL, NULL, ''),
  (30016, 'CD FB tài khoản đã xoá', 'facebook_group_post', 3012, NULL, 'tạm dừng', 301, 30, now() - interval '16 hours', false, '{}', NULL, NULL, NULL, NULL, ''),
  (30017, 'CD FB tài khoản tắt', 'facebook_group_post', 3008, NULL, 'tạm dừng', 301, 30, now() - interval '17 hours', false, '{}', NULL, NULL, NULL, NULL, ''),
  (30018, 'CD Email tài khoản đang chạy', 'email_send', 3010, NULL, 'chờ xử lý', 301, 30, now() - interval '18 hours', false, '{}', NULL, NULL, NULL, NULL, ''),
  (30021, 'CD FB 302 còn lease (app tắt)', 'facebook_group_post', 3021, NULL, 'tạm dừng', 302, 30, now() - interval '1 hour', false,
    '{"contentRotationIndex":1}', NULL, NULL, '00000000-0000-0000-0000-0000000d3021', NULL, ''),
  (30022, 'CD Email 302', 'email_send', 3022, NULL, 'tạm dừng', 302, 30, now() - interval '2 hours', false, '{}', NULL, NULL, NULL, NULL, ''),
  (30023, 'CD QR 302 còn lease (app tắt)', 'zalo_message_phone', 3023, NULL, 'tạm dừng', 302, 30, now() - interval '3 hours', false,
    '{}', '00000000-0000-0000-0000-0000000c3023', 'desktop', NULL, NULL, ''),
  (30024, 'CD tìm data 302', 'facebook_find_data_search', 3021, NULL, 'tạm dừng', 302, 30, now() - interval '4 hours', false,
    '{"isFindUid":true}', NULL, NULL, NULL, NULL, ''),
  (30031, 'CD FB 303 còn lease (chưa có presence)', 'facebook_group_post', 3031, NULL, 'tạm dừng', 303, 30, now() - interval '1 hour', false,
    '{}', NULL, NULL, '00000000-0000-0000-0000-0000000d3031', NULL, ''),
  (31101, 'CD Email tổ chức 31', 'email_send', 3111, NULL, 'chờ xử lý', 311, 31, now() - interval '1 hour', false, '{}', NULL, NULL, NULL, NULL, ''),
  (34101, 'CD FB tổ chức 34', 'facebook_group_post', 3411, NULL, 'chờ xử lý', 341, 34, now() - interval '1 hour', false, '{}', NULL, NULL, NULL, NULL, '');
INSERT INTO auto_campaign_input_data(id, campaign_id, uid, phone, email, name, status) VALUES
  (300021, 30002, NULL, '0901000001', NULL, 'Khách 1', 'hoàn thành'),
  (300041, 30004, NULL, '0901000002', NULL, 'Khách SMS', 'chờ xử lý'),
  (300051, 30005, 'https://www.facebook.com/groups/100000001', NULL, NULL, 'Group 1', 'hoàn thành'),
  (300081, 30008, NULL, NULL, 'a@example.test', 'Người nhận A', 'hoàn thành');
-- Log cũ hơn 10 giây để con trỏ Tiến trình không phụ thuộc thời điểm chạy test.
INSERT INTO auto_campaign_logs(campaign_id, log, created_at) VALUES
  (30002, '10:00:00 14/11/2026 - Zalo QR - CD QR - ▶️ Xử lý QR', now() - interval '3 minutes'),
  (30005, '10:00:01 14/11/2026 - FB chính - CD FB group - 📝 Đăng bài thành công vào Group 1', now() - interval '3 minutes'),
  (30008, '10:00:02 14/11/2026 - Email chính - CD Email - ✅ Đã gửi email tới a@example.test', now() - interval '2 minutes'),
  (30001, '10:00:03 14/11/2026 - Zalo Server - CD Server - server log', now() - interval '2 minutes'),
  (30022, '10:00:04 14/11/2026 - Email nhân viên 302 - CD Email 302 - log 302', now() - interval '2 minutes');
-- 301: app đang mở (last_seen_at ở tương lai: không phụ thuộc thời gian chạy test). 302: phiên đã kết thúc + phiên
-- mồ côi quá 2 phút. 303: chưa có dòng presence.
INSERT INTO auto_staff_device_presence(instance_id, staff_id, organization_id, device_fingerprint_hash, device_label, device_platform, app_version, started_at, last_seen_at, ended_at, runtime_state, runtime_state_at) VALUES
  ('00000000-0000-0000-0000-000000000301', 301, 30, repeat('a', 64), 'Windows - PC', 'win', '9.7.0', now() - interval '1 hour', now() + interval '1 day', NULL,
    '{"v":1,"scheduler":{"state":"running"}}', now() - interval '5 seconds'),
  ('00000000-0000-0000-0000-000000000302', 302, 30, repeat('b', 64), 'Mac', 'mac', '9.7.0', now() - interval '2 hours', now() - interval '30 seconds', now() - interval '30 seconds', NULL, NULL),
  ('00000000-0000-0000-0000-000000000303', 302, 30, repeat('c', 64), 'Mac cũ', 'mac', '9.6.0', now() - interval '3 hours', now() - interval '10 minutes', NULL, NULL, NULL);
INSERT INTO auto_control_sessions(id, staff_id, organization_id, token_hash, client_type, expires_at, last_seen_at) VALUES
  ('00000000-0000-0000-0000-0000000a3010', 301, 30, 'h-301-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3011', 301, 30, 'h-301-native', 'native', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3040', 304, 30, 'h-304-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3110', 311, 31, 'h-311-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3111', 311, 31, 'h-311-pwa', 'pwa', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3112', 311, 31, 'h-311-native', 'native', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3113', 311, 31, 'h-311-other', 'desktop', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3210', 321, 32, 'h-321-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3310', 331, 33, 'h-331-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3410', 341, 34, 'h-341-web', 'web', now() + interval '1 day', now()),
  ('00000000-0000-0000-0000-0000000a3510', 351, 35, 'h-351-web', 'web', now() + interval '1 day', now());
-- Giá trị chính sách đang chạy trên production (14/11/2026).
UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":null,"desktopOnlyLogin":true}' WHERE key = 'web.desktop_accounts';
UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[1],"facebookOnlyLogin":false}' WHERE key = 'web.facebook_campaigns';
