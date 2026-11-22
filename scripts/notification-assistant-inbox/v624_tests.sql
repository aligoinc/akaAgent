-- V624 behaviour checks. Chạy sau nền thông báo (pgenv.sh) + V621 + V622 + fixture_assistant.sql + V624 (xem smoke_v624.sh).
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE OR REPLACE FUNCTION public.fixture_assert(p_ok boolean, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_message; END IF;
  RETURN 'ok  - ' || p_message;
END $$;
-- Thêm một thông báo; trả mã. `p_status` 'ready' thì có nội dung ngay (như package.expiring / assistant.result).
CREATE OR REPLACE FUNCTION public.fixture_notice(p_staff bigint, p_type text, p_status text, p_key text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key,
      payload, content_status, app_title, app_body, email_subject, content_snapshot, campaign_id)
  SELECT s.organization_id, s.id, p_type, 'info', CASE WHEN p_type = 'campaign.status_changed' THEN 'campaign:10' ELSE 'x:' || p_key END,
      now(), now(), p_key, '{"toStatus":"hoàn thành"}'::jsonb, p_status,
      CASE WHEN p_status = 'ready' THEN 'Tiêu đề ' || p_key END, CASE WHEN p_status = 'ready' THEN 'Thân ' || p_key END,
      CASE WHEN p_status = 'ready' THEN '[akaBiz] ' || p_key END,
      CASE WHEN p_status = 'ready' THEN jsonb_build_object('kind', 'report', 'headline', 'H ' || p_key, 'sections', jsonb_build_array(
        jsonb_build_object('title', 'Số liệu', 'tone', 'info', 'display', 'tiles', 'items', jsonb_build_array(jsonb_build_object('label', 'Thành công', 'value', '12'))))) END,
      CASE WHEN p_type = 'campaign.status_changed' THEN 10 END
    FROM public.org_staff s WHERE s.id = p_staff
  RETURNING id
$$;
CREATE OR REPLACE FUNCTION public.fixture_items(p_staff bigint, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.aka_agent_control_ai_assistant(p_staff, (SELECT organization_id FROM public.org_staff WHERE id = p_staff), 'web', 'stream', p_payload) -> 'items'
$$;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

\echo '== cấu trúc và quyền'
SELECT fixture_assert((SELECT count(*) = 1 FROM information_schema.columns WHERE table_name = 'ai_message' AND column_name = 'notification_id'), 'ai_message.notification_id');
SELECT fixture_assert((SELECT pg_get_constraintdef(oid) LIKE '%REFERENCES auto_notifications(id) ON DELETE CASCADE%' FROM pg_constraint WHERE conname = 'ai_message_notification_id_fkey'),
                      'khóa ngoại tới auto_notifications, xóa thông báo thì xóa mục');
SELECT fixture_assert((SELECT value = '{"audience":"off"}' FROM auto_system_settings WHERE key = 'notifications.assistant_inbox'), 'công tắc mặc định off');
SELECT fixture_assert((SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_aka_agent_ai_assistant_notice'), 'trigger trên auto_notifications');
SELECT fixture_assert(NOT has_function_privilege('service_role', 'private.aka_agent_ai_assistant_notice(bigint)', 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'private.aka_agent_ai_assistant_notice_seen(bigint,bigint)', 'EXECUTE')
                      AND NOT has_function_privilege('aka_agent_desktop', 'private.aka_agent_ai_assistant_notice_allowed(bigint,bigint)', 'EXECUTE'),
                      'hàm mới chỉ chủ sở hữu gọi được');

\echo '== công tắc off: không chép'
SELECT fixture_assert(fixture_notice(1, 'report.morning', 'ready', 'off-1') > 0, 'thêm thông báo khi off');
SELECT fixture_assert((SELECT count(*) = 0 FROM ai_message WHERE notification_id IS NOT NULL), 'off: không có mục thông báo');

\echo '== admin_akabiz: chỉ nhân viên admin akaBiz'
UPDATE org_staff SET is_admin_akabiz = (id = 1);
UPDATE auto_system_settings SET value = '{"audience":"admin_akabiz"}' WHERE key = 'notifications.assistant_inbox';
SELECT fixture_assert(fixture_notice(1, 'report.morning', 'ready', 'admin-1') > 0 AND fixture_notice(2, 'report.morning', 'ready', 'admin-2') > 0, 'thêm cho 1 và 2');
SELECT fixture_assert((SELECT count(*) = 1 AND bool_and(m.assistant_staff_id = 1) FROM ai_message m WHERE m.notification_id IS NOT NULL), 'chỉ nhân viên 1 có mục');

\echo '== orgs: theo tổ chức'
UPDATE auto_system_settings SET value = '{"audience":"orgs","organizationIds":[2]}' WHERE key = 'notifications.assistant_inbox';
SELECT fixture_assert(fixture_notice(2, 'report.morning', 'ready', 'orgs-2') > 0, 'thêm cho nhân viên 2 (tổ chức 1)');
SELECT fixture_assert((SELECT count(*) = 1 FROM ai_message WHERE notification_id IS NOT NULL), 'tổ chức không trong danh sách: không chép');

\echo '== all: mọi loại trừ assistant.result, system.*'
UPDATE auto_system_settings SET value = '{"audience":"all"}' WHERE key = 'notifications.assistant_inbox';
SELECT fixture_assert(fixture_notice(2, 'campaign.status_changed', 'ready', 'all-camp') > 0 AND fixture_notice(2, 'package.expiring', 'ready', 'all-pkg') > 0
                      AND fixture_notice(2, 'account.status_changed', 'ready', 'all-acc') > 0 AND fixture_notice(2, 'report.scheduled', 'ready', 'all-rep') > 0
                      AND fixture_notice(2, 'assistant.result', 'ready', 'all-ar') > 0 AND fixture_notice(2, 'system.test', 'ready', 'all-test') > 0
                      AND fixture_notice(2, 'system.verify_email', 'ready', 'all-verify') > 0, 'thêm 7 loại');
SELECT fixture_assert((SELECT count(*) = 4 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE m.assistant_staff_id = 2), '4 mục cho 4 loại được chép');
SELECT fixture_assert((SELECT count(*) = 0 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id
                        WHERE n.event_type IN ('assistant.result', 'system.test', 'system.verify_email')), 'không chép assistant.result / system.*');
SELECT fixture_assert((SELECT count(*) = 1 FROM ai_message_thread WHERE org_staff_id = 2 AND (intake_data ->> 'kind') = 'notices'
                        AND answer_mode = 'assistant' AND message_count = 4 AND last_message_seq = 4 AND last_read_seq = 4 AND project_id = 10),
                      'một hội thoại thông báo, làn assistant, luôn đã xem ở mức hội thoại');
SELECT fixture_assert((SELECT array_agg(seq ORDER BY id) = '{1,2,3,4}' FROM ai_message WHERE assistant_staff_id = 2 AND notification_id IS NOT NULL), 'seq tăng dần');
SELECT fixture_assert((SELECT m.status = 'hoàn thành' AND m.brief IS NULL AND m.answer_mode = 'assistant' AND m.question = 'Tiêu đề all-camp' AND m.answer = 'Thân all-camp'
                              AND m.answer_json #>> '{notice,eventType}' = 'campaign.status_changed' AND (m.answer_json #>> '{notice,campaignId}')::int = 10
                              AND m.answer_json #>> '{notice,content,sections,0,display}' = 'tiles'
                         FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'all-camp'), 'nội dung mục: tiêu đề, thân, ô số');

\echo '== chờ nội dung rồi mới chép; cập nhật khác không chép lại'
SELECT fixture_assert(fixture_notice(2, 'report.scheduled', 'pending', 'pend-1') > 0, 'thêm thông báo chờ dựng');
SELECT fixture_assert((SELECT count(*) = 0 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'pend-1'), 'chưa có nội dung: chưa chép');
UPDATE auto_notifications SET content_status = 'rendering', lease_token = '00000000-0000-4000-8000-000000000001' WHERE dedupe_key = 'pend-1';
SELECT fixture_assert((public.aka_agent_notification_worker('complete_render', jsonb_build_object('id', (SELECT id FROM auto_notifications WHERE dedupe_key = 'pend-1'),
         'leaseToken', '00000000-0000-4000-8000-000000000001', 'status', 'ready', 'appTitle', 'Báo cáo 12:00', 'appBody', 'Thành công 12', 'emailSubject', '[akaBiz] Báo cáo',
         'contentSnapshot', '{"kind":"report","sections":[]}'::jsonb)) ->> 'ok')::boolean, 'worker dựng xong (đường thật complete_render → fanout)');
SELECT fixture_assert((SELECT count(*) = 1 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'pend-1' AND m.question = 'Báo cáo 12:00'), 'dựng xong: có đúng một mục');
UPDATE auto_notifications SET push_state = 'sent', content_status = 'ready' WHERE dedupe_key = 'pend-1';
SELECT fixture_assert((SELECT count(*) = 1 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'pend-1'), 'cập nhật sau đó: không chép lại');
SELECT fixture_assert(fixture_notice(2, 'campaign.status_changed', 'merged', 'merged-1') > 0
                      AND (SELECT count(*) = 0 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'merged-1'), 'thông báo đã gộp: không chép');

\echo '== nhân viên nghỉ, Trợ lý aka tắt: không chép'
SELECT fixture_assert(fixture_notice(3, 'report.morning', 'ready', 'inactive-3') > 0
                      AND (SELECT count(*) = 0 FROM ai_message WHERE assistant_staff_id = 3), 'nhân viên nghỉ việc');
UPDATE ai_project SET is_active = false WHERE code = 'tro-ly-aka';
SELECT fixture_assert(fixture_notice(2, 'report.morning', 'ready', 'disabled-2') > 0
                      AND (SELECT count(*) = 0 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'disabled-2'), 'Trợ lý aka đang tắt');
UPDATE ai_project SET is_active = true WHERE code = 'tro-ly-aka';

\echo '== lỗi khi chép không làm hỏng thông báo'
CREATE FUNCTION public.fixture_break() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'hỏng có chủ đích'; END $$;
CREATE TRIGGER fixture_break BEFORE INSERT ON public.ai_message FOR EACH ROW WHEN (NEW.notification_id IS NOT NULL) EXECUTE FUNCTION public.fixture_break();
SELECT fixture_assert(fixture_notice(2, 'report.morning', 'ready', 'broken-2') > 0, 'thông báo vẫn được ghi');
SELECT fixture_assert((SELECT count(*) = 0 FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'broken-2')
                      AND (SELECT message_count = 5 FROM ai_message_thread WHERE org_staff_id = 2 AND (intake_data ->> 'kind') = 'notices'), 'không có mục, hội thoại không đổi');
DROP TRIGGER fixture_break ON public.ai_message;

\echo '== hộp hội thoại: app cũ không thấy mục thông báo'
SELECT fixture_assert((SELECT count(*) = 0 FROM jsonb_array_elements(fixture_items(2, '{}')) x WHERE x ->> 'kind' = 'notice'), 'stream không cờ: không có mục thông báo');
SELECT fixture_assert((SELECT count(*) = 5 AND bool_and((x ->> 'notificationId') IS NOT NULL) FROM jsonb_array_elements(fixture_items(2, '{"includeNotices":true}')) x WHERE x ->> 'kind' = 'notice'),
                      'stream có cờ: 5 mục thông báo, có notificationId');
SELECT fixture_assert((SELECT x #>> '{answerJson,notice,title}' = 'Tiêu đề all-camp' FROM jsonb_array_elements(fixture_items(2, '{"includeNotices":true}')) x
                        WHERE x #>> '{answerJson,notice,eventType}' = 'campaign.status_changed'), 'answerJson.notice đi kèm mục');
SELECT fixture_assert((SELECT jsonb_array_length(aka_agent_control_ai_assistant(2, 1, 'web', 'sync', '{"afterId":0}') -> 'items') = 0
                         AND jsonb_array_length(aka_agent_control_ai_assistant(2, 1, 'web', 'sync', '{"afterId":0,"includeNotices":true}') -> 'items') = 5),
                      'sync: theo cờ');
-- Một lượt trao đổi thường (như commit ghi) xen giữa các mục thông báo: vẫn là 'turn', thứ tự theo id.
INSERT INTO ai_message_thread (project_id, project_version, name, first_question, organization_id, org_staff_id, intake_data, source, request_id)
VALUES (10, 1, 'Hỏi', 'Hỏi', 1, 2, '{"kind":"conversation","state":"trao_doi"}', 'web', gen_random_uuid());
INSERT INTO ai_message (thread_id, seq, request_id, question, answer, answer_json, status, thread_rev, deadline_at, assistant_staff_id)
SELECT id, 1, gen_random_uuid(), 'Chiến dịch của tôi sao rồi?', 'Đang chạy.', '{"action":"reply"}', 'hoàn thành', 2, now(), 2
  FROM ai_message_thread WHERE org_staff_id = 2 AND (intake_data ->> 'kind') = 'conversation';
SELECT fixture_assert((SELECT array_agg(x ->> 'kind' ORDER BY (x ->> 'id')::bigint) = '{notice,notice,notice,notice,notice,turn}'
                         FROM jsonb_array_elements(fixture_items(2, '{"includeNotices":true}')) x), 'lượt thường vẫn là turn, thứ tự theo id');
SELECT fixture_assert((SELECT array_agg(x ->> 'kind') = '{turn}' FROM jsonb_array_elements(fixture_items(2, '{}')) x), 'app cũ chỉ thấy lượt thường');

\echo '== đọc trong Trợ lý aka: thông báo tính đã đọc, hủy lượt đẩy còn chờ'
INSERT INTO auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, status)
SELECT n.id, 2, 'push', 'apns', 'device:x' || n.id, 'pending' FROM auto_notifications n WHERE n.dedupe_key IN ('all-camp', 'all-pkg');
SELECT fixture_assert((aka_agent_control_ai_assistant(2, 1, 'web', 'read',
         jsonb_build_object('uptoId', (SELECT max(id) FROM ai_message WHERE assistant_staff_id = 2))) ->> 'notificationUnreadCount') IS NULL
                      AND (SELECT count(*) = 0 FROM auto_notifications WHERE staff_id = 2 AND read_at IS NOT NULL), 'app cũ đọc: thông báo không đổi');
SELECT fixture_assert((SELECT (r ->> 'notificationUnreadCount') IS NOT NULL FROM (SELECT aka_agent_control_ai_assistant(2, 1, 'web', 'read',
         jsonb_build_object('uptoId', (SELECT m.id FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'all-acc'), 'includeNotices', true)) r) x),
                      'app mới đọc tới mục all-acc');
SELECT fixture_assert((SELECT bool_and(read_at IS NOT NULL) FROM auto_notifications WHERE dedupe_key IN ('all-camp', 'all-pkg', 'all-acc'))
                      AND (SELECT bool_and(read_at IS NULL) FROM auto_notifications WHERE dedupe_key IN ('all-rep', 'pend-1')), 'chỉ thông báo đã hiện tới mốc được tính đã đọc');
SELECT fixture_assert((SELECT bool_and(status = 'cancelled' AND last_error_code = 'read_in_app') FROM auto_notification_deliveries d JOIN auto_notifications n ON n.id = d.notification_id
                        WHERE n.dedupe_key IN ('all-camp', 'all-pkg') AND d.channel = 'push'), 'lượt đẩy còn chờ bị hủy');

\echo '== lượt đẩy kèm mục Trợ lý aka và bản app'
INSERT INTO auto_notification_devices (staff_id, organization_id, control_session_id, installation_id, bundle_id, push_token, apns_environment, app_version, is_active, is_enabled)
VALUES (2, 1, 'aaaaaaaa-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000001', 'net.akabiz.agent', repeat('ab', 32), 'production', '0.7.0', true, true);
INSERT INTO auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, device_id, status)
SELECT n.id, 2, 'push', 'apns', 'device:' || dv.id, dv.id, 'pending' FROM auto_notifications n, auto_notification_devices dv WHERE n.dedupe_key = 'all-rep' AND dv.push_token = repeat('ab', 32);
INSERT INTO auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, status)
SELECT n.id, 2, 'email', 'smtp', 'nam@example.test', 'pending' FROM auto_notifications n WHERE n.dedupe_key = 'all-rep';
SELECT fixture_assert((SELECT bool_and(CASE WHEN i ->> 'channel' = 'push'
                                            THEN (i #>> '{notification,assistantItemId}')::bigint = (SELECT m.id FROM ai_message m JOIN auto_notifications n ON n.id = m.notification_id WHERE n.dedupe_key = 'all-rep')
                                                 AND i #>> '{device,appVersion}' = '0.7.0'
                                            ELSE (i #>> '{notification,assistantItemId}') IS NULL END) AND count(*) = 2
                         FROM jsonb_array_elements(public.aka_agent_notification_worker('claim_deliveries', '{"limit":100}') -> 'items') i
                        WHERE (i #>> '{notification,id}')::bigint = (SELECT id FROM auto_notifications WHERE dedupe_key = 'all-rep')),
                      'claim_deliveries: lượt đẩy có assistantItemId + appVersion, email không có');

\echo '== xóa thông báo thì xóa mục'
DELETE FROM auto_notification_deliveries WHERE notification_id = (SELECT id FROM auto_notifications WHERE dedupe_key = 'all-acc');
DELETE FROM auto_notifications WHERE dedupe_key = 'all-acc';
SELECT fixture_assert((SELECT count(*) = 4 FROM ai_message WHERE assistant_staff_id = 2 AND notification_id IS NOT NULL), 'mục của thông báo đã xóa cũng bị xóa');

-- (phần chạy song song nằm ở smoke_v624.sh: hai phiên psql)
