-- Dữ liệu mẫu cho script so sánh v454 (trích từ assertions.sql, không có cột runtime chưa tạo).
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
