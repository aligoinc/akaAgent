-- Bài kiểm V660 (chạy bằng v660-smoke.sh). Mỗi khẳng định sai thì RAISE và dừng.
\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

INSERT INTO org_staff VALUES (10, 1), (20, 2);
INSERT INTO auto_accounts (id, name, staff_id, organization_id, flatform_type, is_zalo_server) VALUES
  (100, 'zl Kho', 10, 1, 'zalo', false), (200, 'zl Server', 20, 2, 'zalo', true), (300, 'zl Web', 10, 1, 'zalo', false);
UPDATE auto_accounts SET is_zalo_show_web = true WHERE id = 300;
INSERT INTO zalo_users VALUES (100, '901', 'Nguyễn Văn A', 'A'), (100, '902', NULL, 'Trần B');
INSERT INTO auto_campaigns (id, name, action_id, account_id, staff_id, organization_id, status, extra_settings) VALUES
  (1, 'Chăm sóc VIP', 'zalo_message_friend', 100, 10, 1, 'hoàn thành',
   '{"zaloFriendTargetMode":"tagged_friends","zaloFriendSourceTagIds":[5,"7"],"zaloFriendSourceTagNames":["VIP","Mới"],"zaloFriendTagAutoAddEnabled":true}'),
  (2, 'Không bật ô', 'zalo_message_friend', 100, 10, 1, 'hoàn thành',
   '{"zaloFriendTargetMode":"tagged_friends","zaloFriendSourceTagIds":[5],"zaloFriendDataMaterializedAt":"2026-11-01T00:00:00Z"}'),
  (3, 'Server tag', 'zalo_message_friend', 200, 20, 2, 'tạm dừng',
   '{"zaloFriendTargetMode":"tagged_friends","zaloFriendSourceTagIds":[9],"zaloFriendTagAutoAddEnabled":true,"zaloFriendDataMaterializedAt":"x"}'),
  (4, 'Zalo web', 'zalo_message_friend', 300, 10, 1, 'hoàn thành',
   '{"zaloFriendTargetMode":"tagged_friends","zaloFriendSourceTagIds":[5],"zaloFriendTagAutoAddEnabled":true,"zaloFriendDataMaterializedAt":"x"}'),
  (5, 'SĐT', 'zalo_message_phone', 100, 10, 1, 'hoàn thành', '{"zaloFriendTagAutoAddEnabled":true}');
INSERT INTO auto_campaign_input_data (campaign_id, name, uid, status) VALUES (1, 'Cũ', '900', 'hoàn thành');

\i :migration

SELECT pg_temp.ok((SELECT array_agg(campaign_id ORDER BY campaign_id) FROM auto_zalo_tag_sync_campaigns) = ARRAY[1,3,4]::bigint[], 'nạp sẵn: chỉ chiến dịch theo tag bật ô');
SELECT pg_temp.ok((SELECT tag_ids FROM auto_zalo_tag_sync_campaigns WHERE campaign_id = 1) = ARRAY['5','7'], 'mã tag số và chữ đều thành chữ');

-- Tắt tổng: không làm gì.
SELECT pg_temp.ok((aka_agent_sync_zalo_tags('server', '[{"a":"200","v":"1"}]')->>'enabled')::boolean = false, 'tắt tổng thì enabled=false');
UPDATE auto_system_settings SET value = 'true' WHERE key = 'zalo.tag_sync.enabled';

SELECT pg_temp.ok(aka_agent_zalo_tag_sync_accounts('server')->'accountIds' = '[200]', 'danh sách Server chỉ có tài khoản Server');
SET test.staff = '10';
SELECT pg_temp.ok(aka_agent_desktop_zalo_tag_sync_accounts()->'accountIds' = '[100]', 'Desktop: không có Zalo trình duyệt');

-- Nhịp đầu: chưa có mốc → xin danh sách.
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"1"}]')->'needTags' = '["100"]', 'chưa có mốc thì xin danh sách');
-- Danh sách đầu: chỉ lấy mốc.
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"1","tags":[{"id":"5","name":"VIP","m":["900","901"]},{"id":"8","name":"Khác","m":["950"]}]}]')->'baselined' = '["100"]', 'lần đầu chỉ lấy mốc');
SELECT pg_temp.ok((SELECT count(*) FROM auto_zalo_tag_members WHERE account_id = 100) = 3, 'mốc có 3 người');
SELECT pg_temp.ok((SELECT count(*) FROM auto_zalo_tag_member_events) = 0, 'mốc không ghi nhật ký');
-- Cùng phiên bản: không xin.
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"1"}]')->'needTags' = '[]', 'cùng phiên bản thì không xin');
-- Phiên bản đổi: xin.
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"2"}]')->'needTags' = '["100"]', 'phiên bản đổi thì xin');

-- Gắn 902 vào tag 7, gỡ 900 khỏi tag 5. Chiến dịch 1 chưa có dấu lấy danh sách lần đầu: chưa thêm.
SELECT pg_temp.ok((aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"2","tags":[{"id":"5","name":"VIP","m":["901"]},{"id":"7","name":"Mới","m":["902"]},{"id":"8","m":["950"]}]}]')->>'campaignRows')::int = 0, 'chưa lấy danh sách lần đầu thì chưa thêm');
SELECT pg_temp.ok((SELECT count(*) FROM auto_zalo_tag_member_events WHERE kind = 'add') = 1 AND (SELECT count(*) FROM auto_zalo_tag_member_events WHERE kind = 'remove') = 1, 'nhật ký ghi 1 gắn, 1 gỡ');

UPDATE auto_campaigns SET extra_settings = extra_settings || '{"zaloFriendDataMaterializedAt":"2026-11-26T00:00:00Z"}' WHERE id = 1;
-- Gắn 901 vào tag 7 (đã ở tag 5 trước), 903 vào tag 5, nhóm g555 vào tag 5, 960 vào tag 8 (không thuộc chiến dịch).
SELECT pg_temp.ok((aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"3","tags":[{"id":"5","name":"VIP","m":["901","903","g555"]},{"id":"7","name":"Mới","m":["902","901"]},{"id":"8","m":["950","960"]}]}]')->>'campaignRows')::int = 2, 'thêm 2 người (901, 903), bỏ nhóm và tag khác');
SELECT pg_temp.ok((SELECT array_agg(uid ORDER BY uid) FROM auto_campaign_input_data WHERE campaign_id = 1 AND control_append_idempotency_key LIKE 'zalotag:%') = ARRAY['901','903'], 'data mới đúng người');
SELECT pg_temp.ok((SELECT name FROM auto_campaign_input_data WHERE campaign_id = 1 AND uid = '901') = 'Nguyễn Văn A', 'tên lấy từ zalo_users');
SELECT pg_temp.ok((SELECT status FROM auto_campaigns WHERE id = 1) = 'chờ xử lý', 'chiến dịch hoàn thành được mở lại');
SELECT pg_temp.ok((SELECT count(*) FROM auto_campaign_input_data WHERE campaign_id = 2) = 0, 'chiến dịch không bật ô không nhận');
SELECT pg_temp.ok((SELECT count(*) FROM auto_campaign_logs WHERE campaign_id = 1 AND log LIKE '%zl Kho - Chăm sóc VIP - 🏷️ Đã thêm "Nguyễn Văn A"%vừa được gắn tag "Mới"') = 1, 'dòng tiến trình đúng khuôn');

-- Bộ chạy ghi lại extra_settings của chiến dịch đang tự thêm: không đặt lại mốc.
UPDATE auto_campaigns SET extra_settings = extra_settings || '{"x":1}' WHERE id = 1;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM auto_zalo_tag_sync_resets WHERE account_id = 100), 'lưu lại chiến dịch không đặt lại mốc');

-- Gỡ 903 rồi gắn lại: không thêm lần hai. 900 (đã có trong data) gắn lại tag 5: không thêm.
SELECT aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"4","tags":[{"id":"5","m":["901"]},{"id":"7","m":["902","901"]}]}]');
SELECT pg_temp.ok((aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"5","tags":[{"id":"5","m":["901","903","900"]},{"id":"7","m":["902","901"]}]}]')->>'campaignRows')::int = 0, 'gỡ rồi gắn lại, hoặc đã có trong data: không thêm');

-- Mất kết nối quá 30 phút: chỉ lấy mốc.
UPDATE auto_zalo_tag_sync_accounts SET last_seen_at = now() - interval '40 minutes' WHERE account_id = 100;
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"6","tags":[{"id":"5","m":["901","903","900","904"]},{"id":"7","m":["902","901"]}]}]')->'baselined' = '["100"]', 'cách lần trước 40 phút thì chỉ lấy mốc');
SELECT pg_temp.ok((SELECT count(*) FROM auto_campaign_input_data WHERE uid = '904') = 0, 'người gắn lúc mất kết nối không được thêm');

-- Desktop gửi tài khoản Server hoặc tài khoản người khác: bị từ chối.
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"200","v":"1"}]')->'rejected' = '["200"]', 'Desktop không gửi được tài khoản Server');
SET test.staff = '20';
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"1"}]')->'rejected' = '["100"]', 'Desktop không gửi được tài khoản của người khác');
RESET test.staff;

-- Server: chiến dịch tạm dừng nhận người nhưng giữ trạng thái.
SELECT aka_agent_sync_zalo_tags('server', '[{"a":"200","v":"1","tags":[{"id":"9","m":["1"]}]}]');
SELECT pg_temp.ok((aka_agent_sync_zalo_tags('server', '[{"a":"200","v":"2","tags":[{"id":"9","m":["1","2"]}]}]')->>'campaignRows')::int = 1, 'Server: thêm người mới');
SELECT pg_temp.ok((SELECT status FROM auto_campaigns WHERE id = 3) = 'tạm dừng', 'chiến dịch tạm dừng giữ nguyên');

-- Hai danh sách trong một lần gọi: từ chối.
DO $$ BEGIN
  PERFORM aka_agent_sync_zalo_tags('server', '[{"a":"200","v":"3","tags":[]},{"a":"100","v":"3","tags":[]}]');
  RAISE EXCEPTION 'FAIL: phải từ chối hai danh sách';
EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'PASS: từ chối hai danh sách một lần gọi'; END $$;

-- Công tắc: dừng → hết theo dõi và xoá mốc; tiếp tục → lần đầu chỉ lấy mốc.
SELECT pg_temp.ok((aka_agent_control_set_campaign_zalo_tag_auto_add(10, 1, 1, false)->>'changed')::boolean, 'dừng tự thêm');
SELECT pg_temp.ok((SELECT extra_settings->>'zaloFriendTagAutoAddEnabled' FROM auto_campaigns WHERE id = 1) = 'false', 'công tắc chỉ đổi đúng khoá');
SELECT pg_temp.ok((SELECT extra_settings->>'zaloFriendSourceTagNames' FROM auto_campaigns WHERE id = 1) IS NOT NULL, 'các khoá khác giữ nguyên');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM auto_zalo_tag_sync_campaigns WHERE campaign_id = 1), 'dừng thì ra khỏi danh sách tự thêm');
SET test.staff = '10';
SELECT pg_temp.ok(aka_agent_desktop_zalo_tag_sync_accounts()->'accountIds' = '[]', 'tài khoản 100 hết được hỏi (chiến dịch 4 là Zalo trình duyệt)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM auto_zalo_tag_sync_resets WHERE account_id = 100), 'ghi dấu đặt lại khi không còn chiến dịch tự thêm');
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"7"}]')->'rejected' = '["100"]', 'đang dừng thì lô bị từ chối');
SELECT pg_temp.ok((aka_agent_desktop_set_campaign_zalo_tag_auto_add(1, true)->>'changed')::boolean, 'tiếp tục tự thêm qua Desktop');
SELECT pg_temp.ok(aka_agent_desktop_sync_zalo_tags('[{"a":"100","v":"7","tags":[{"id":"5","m":["901","905"]}]}]')->'baselined' = '["100"]', 'tiếp tục rồi thì lần đầu chỉ lấy mốc');
SELECT pg_temp.ok((SELECT count(*) FROM auto_campaign_input_data WHERE uid = '905') = 0, 'không thêm bù người gắn lúc dừng');
SELECT pg_temp.ok((SELECT count(*) FROM auto_campaign_logs WHERE campaign_id = 1 AND log LIKE '%Đã dừng tự thêm%') = 1
  AND (SELECT count(*) FROM auto_campaign_logs WHERE campaign_id = 1 AND log LIKE '%Đã tiếp tục tự thêm%') = 1, 'ghi tiến trình khi đổi công tắc');
SELECT pg_temp.ok((aka_agent_desktop_set_campaign_zalo_tag_auto_add(2, true)->>'code') IS NULL, 'bật được cho chiến dịch theo tag khác');
SELECT pg_temp.ok((aka_agent_desktop_set_campaign_zalo_tag_auto_add(5, true)->>'code') = 'campaign_not_tagged_friends', 'không bật được cho loại khác');
SET test.staff = '20';
SELECT pg_temp.ok((aka_agent_desktop_set_campaign_zalo_tag_auto_add(1, false)->>'code') = 'campaign_not_found', 'không đổi được chiến dịch người khác');
RESET test.staff;

-- Xoá chiến dịch: ra khỏi danh sách.
UPDATE auto_campaigns SET is_delete = true WHERE id = 3;
SELECT pg_temp.ok(aka_agent_zalo_tag_sync_accounts('server')->'accountIds' = '[]', 'chiến dịch xoá thì hết hỏi');

-- Quyền.
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.aka_agent_sync_zalo_tags(text, jsonb)', 'EXECUTE'), 'anon không gọi được');
SELECT pg_temp.ok(NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_sync_zalo_tags(text, jsonb)', 'EXECUTE'), 'Desktop không gọi được hàm Server');
SELECT pg_temp.ok(has_function_privilege('aka_agent_chat_api', 'public.aka_agent_sync_zalo_tags(text, jsonb)', 'EXECUTE'), 'Chat API gọi được');
SELECT pg_temp.ok(NOT has_table_privilege('service_role', 'public.auto_zalo_tag_members', 'SELECT'), 'bảng không đọc thẳng được');

SELECT pg_temp.ok(private.aka_agent_zalo_tag_sync_retention() = 0, 'dọn nhật ký chạy được');
SELECT pg_temp.ok((SELECT public_code FROM auto_error WHERE error_code = 'err_engine_zalo_tag_not_friend') = 'EXC04', 'có mã EXC04');
SELECT pg_temp.ok((SELECT quota_effect = 'no_count' AND target_streak_effect = 'ignore' AND detail_mode = 'write' AND detail_status_id = 51 AND campaign_effect = 'none'
  FROM auto_outcome_policies WHERE error_code = 'err_engine_zalo_tag_not_friend'), 'EXC04: Bỏ qua, không tính lượt, không cộng chuỗi');
SELECT pg_temp.ok((SELECT error_code FROM auto_outcome_signal_rules WHERE pattern = 'zalo_tag_not_friend') = 'err_engine_zalo_tag_not_friend', 'luật tín hiệu engine');
\echo ALL PASS
