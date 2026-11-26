-- Bài kiểm V672 (Bot sự kiện). Chạy bằng scripts/event-bot/db/v672-smoke.sh sau khi đã apply V660 + V672.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.t(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS TRUE THEN RAISE NOTICE 'PASS: %', p_label; ELSE RAISE EXCEPTION 'FAIL: %', p_label; END IF;
END $$;
CREATE FUNCTION pg_temp.ctl(p_staff bigint, p_org bigint, p_action text, p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.aka_agent_control_event_bot(p_staff, p_org, p_action, p_payload) $$;
CREATE FUNCTION pg_temp.cfg(p_value text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.auto_system_settings SET value = p_value WHERE key = 'event_bot' $$;
CREATE FUNCTION pg_temp.job(p_account bigint, p_uid text, p_dir text) RETURNS public.auto_event_bot_jobs LANGUAGE sql AS $$
  SELECT * FROM public.auto_event_bot_jobs WHERE account_id = p_account AND recipient_uid = p_uid AND direction = p_dir ORDER BY id DESC LIMIT 1 $$;
CREATE FUNCTION pg_temp.tags(p_version text, p_members text[], p_tag text DEFAULT '3', p_extra jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('test.staff', '100', false);
  r := public.aka_agent_desktop_sync_zalo_tags(jsonb_build_array(jsonb_build_object('a', '1001', 'v', p_version,
    'tags', jsonb_build_array(jsonb_build_object('id', p_tag, 'name', 'Khách mới', 'm', to_jsonb(p_members))) || p_extra)));
  RETURN r;
END $$;
-- Việc đến hạn ngay (bỏ khoảng chờ) cho tài khoản.
CREATE FUNCTION pg_temp.due(p_account bigint) RETURNS void LANGUAGE sql AS $$
  UPDATE public.auto_event_bot_jobs SET send_after = clock_timestamp() - interval '1 second' WHERE account_id = p_account AND status = 'pending' $$;
CREATE FUNCTION pg_temp.claim_desktop(p_accounts bigint[], p_limit int DEFAULT 5) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.staff', '100', false);
  RETURN public.aka_agent_desktop_event_bot_claim_v1('runner-1', p_accounts, p_limit);
END $$;
CREATE FUNCTION pg_temp.report_desktop(p_job jsonb, p_result jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.staff', '100', false);
  RETURN public.aka_agent_desktop_event_bot_report_v1((p_job->>'jobId')::bigint, (p_job->>'claimToken')::uuid, p_result);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Dữ liệu
-- ---------------------------------------------------------------------------------------------------------------------
UPDATE auto_system_settings SET value = 'true' WHERE key = 'zalo.tag_sync.enabled';
INSERT INTO org_staff (id, organization_id, name, is_admin_akabiz) VALUES (100, 10, 'Nhân viên A', false), (101, 10, 'Nhân viên B', false),
  (102, 10, 'Admin', true), (300, 30, 'Nhân viên Fly', false);
INSERT INTO zalo_accounts VALUES (1, '9000000001', 'Zalo QR A', 'https://a/1.jpg');
INSERT INTO auto_accounts (id, name, staff_id, organization_id, is_zalo_server, is_zalo_show_web, zalo_account_id) VALUES
  (1001, 'QR A', 100, 10, false, false, 1), (1002, 'Server A', 100, 10, true, false, NULL), (1003, 'Web A', 100, 10, false, true, NULL),
  (1005, 'akaChat A', 100, 10, true, false, NULL), (1101, 'QR B', 101, 10, false, false, NULL), (3001, 'Server Fly', 300, 30, true, false, NULL);
INSERT INTO auto_accounts (id, name, staff_id, organization_id, flatform_type) VALUES (1009, 'FB A', 100, 10, 'facebook');
INSERT INTO test_org_flags VALUES (10, true, false), (30, false, true);
INSERT INTO chat_zalo_account_organization (organization_id, auto_account_id) VALUES (10, 1005);
INSERT INTO auto_account_contacts (id, account_id, contact_type, name, uid, phone, staff_id, organization_id) VALUES
  (1, 1001, 'zalo_tag', 'Khách mới', '3', NULL, 100, 10), (2, 1001, 'zalo_tag', 'Khách cũ', '7', NULL, 100, 10),
  (555, 1001, 'person', 'Bà 555', '555', '0912 345 678', 100, 10),
  (801, 1001, 'person', 'Anh 801', '801', NULL, 100, 10), (802, 1001, 'person', 'Chị không UID', NULL, '0900000002', 100, 10),
  (803, 1101, 'person', 'Khách của B', '803', NULL, 101, 10), (804, 1001, 'person', 'Bị chặn', '804', NULL, 100, 10),
  (901, 1001, 'person', 'Thành viên danh sách', '904', NULL, 100, 10);
-- Nhóm điều kiện 500 (có bộ lọc động 50), nhóm 501 (không bộ lọc), danh sách không gửi 600 của nhân viên 100, 601 của nhân viên 101.
INSERT INTO auto_account_contact_groups (id, name, staff_id, organization_id, purpose, data_type_category_item_id, contact_type) VALUES
  (500, 'Khách VIP', 100, 10, 'data_group', 40, 'person'), (501, 'Không lọc', 100, 10, 'data_group', 40, 'person'),
  (600, 'Không gửi', 100, 10, 'zalo_friend_blocklist', NULL, 'person'), (601, 'Không gửi B', 101, 10, 'zalo_friend_blocklist', NULL, 'person');
INSERT INTO auto_account_contact_group_dynamic_filters (id, group_id, staff_id, organization_id) VALUES (50, 500, 100, 10);
INSERT INTO auto_account_contact_group_members (id, group_id, contact_id) VALUES (7000, 600, 901);
-- Bảng của chiến dịch (độc lập): có sẵn dữ liệu, so trước / sau.
INSERT INTO auto_account_action_status (account_id, action_code, count_action_in_day) VALUES (1001, 'zalo_message_stranger', 3);
INSERT INTO auto_campaign_details (account_id, campaign_id, status) VALUES (1001, 1, 'thành công');
INSERT INTO auto_engine_leases (account_id) VALUES (1002);
INSERT INTO auto_campaigns (id, name, action_id, account_id, staff_id, organization_id, status) VALUES
  (1, 'Sinh nhật cũ', 'zalo_message_birthday', 1001, 100, 10, 'chờ xử lý');
CREATE TEMP TABLE indep_before AS SELECT
  (SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM auto_account_action_status t) a,
  (SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM auto_campaign_details t) d,
  (SELECT md5(string_agg(t::text, ',' ORDER BY account_id)) FROM auto_engine_leases t) l,
  (SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM auto_campaigns t) c;

-- ---------------------------------------------------------------------------------------------------------------------
-- Công tắc
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.t(private.aka_agent_event_bot_config()->>'audience' = 'off', 'công tắc V672 đặt off');
SELECT pg_temp.t((pg_temp.ctl(100, 10, 'access')->'data'->>'enabled') = 'false', 'access: off → false');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'accounts')->>'code' = 'not_enabled', 'accounts khi off → not_enabled');
SELECT pg_temp.cfg('{not json');
SELECT pg_temp.t(private.aka_agent_event_bot_config()->>'audience' = 'off', 'JSON sai = off');
SELECT pg_temp.cfg('{"audience":"admin_akabiz"}');
SELECT pg_temp.t(NOT private.aka_agent_event_bot_access(10, 100) AND private.aka_agent_event_bot_access(10, 102), 'admin_akabiz: chỉ admin');
SELECT pg_temp.t(private.aka_agent_event_bot_config()->'runtimes' = '{"desktop":true,"server":true,"fly":false}', 'thiếu runtimes = mặc định');
SELECT pg_temp.cfg('{"audience":"orgs","organizationIds":[10]}');
SELECT pg_temp.t(private.aka_agent_event_bot_access(10, 100) AND NOT private.aka_agent_event_bot_access(30, 300), 'orgs: theo danh sách');
SELECT pg_temp.t(NOT private.aka_agent_event_bot_access(30, 100), 'nhân viên sai tổ chức → false');
SELECT pg_temp.cfg('{"audience":"all","organizationIds":[],"runtimes":{"desktop":true,"server":true,"fly":false},"pollSeconds":30}');
SELECT pg_temp.t(private.aka_agent_event_bot_access(30, 300), 'all → true');

-- ---------------------------------------------------------------------------------------------------------------------
-- Trang: accounts / get / save
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.t(jsonb_array_length(pg_temp.ctl(100, 10, 'accounts')->'data') = 4, 'accounts: 4 tài khoản Zalo của nhân viên (bỏ Facebook)');
SELECT pg_temp.t((SELECT jsonb_object_agg(x->>'accountId', x->>'runsOn') FROM jsonb_array_elements(pg_temp.ctl(100, 10, 'accounts')->'data') x)
  = '{"1001":"desktop","1002":"server","1003":"desktop","1005":"akachat"}', 'accounts: runsOn đúng từng loại');
SELECT pg_temp.t((SELECT jsonb_object_agg(x->>'accountId', x->>'kind') FROM jsonb_array_elements(pg_temp.ctl(100, 10, 'accounts')->'data') x)
  = '{"1001":"qr","1002":"server","1003":"web","1005":"server"}', 'accounts: kind đúng');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'get', '{"accountId":1101}')->>'code' = 'account_not_found', 'get tài khoản của người khác → account_not_found');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'nope', '{"accountId":1001}')->>'code' = 'unknown_action', 'thao tác lạ → unknown_action');
SELECT pg_temp.t((pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data'->'settings'->>'revision')::int = 0, 'get lần đầu: revision 0');
SELECT pg_temp.t(jsonb_array_length(pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data'->'conflicts'->'birthdayCampaigns') = 1, 'get: cảnh báo chiến dịch sinh nhật');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data'->'tags' = '[{"id":"7","name":"Khách cũ"},{"id":"3","name":"Khách mới"}]', 'get: danh sách tag');
SELECT pg_temp.t((SELECT count(*) FROM jsonb_array_elements(pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data'->'blocklists')) = 1, 'get: chỉ danh sách không gửi của nhân viên');
SELECT pg_temp.t((SELECT x->>'hasDynamicFilter' FROM jsonb_array_elements(pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data'->'dataGroups') x WHERE (x->>'id')::int = 500) = 'true', 'get: nhóm có bộ lọc động');

CREATE TEMP TABLE rules_ok AS SELECT '[
  {"eventType":"birthday","name":"Chúc mừng","enabled":true,"position":0,"config":{"sendTime":"00:00","message":"Chúc mừng sinh nhật #{FULL_NAME}!"},"minGapMinutes":0},
  {"eventType":"tag_change","name":"Gắn tag 3","enabled":true,"position":1,"config":{"direction":"added","tagIds":["3"],"tagNames":["Khách mới"],"message":"Chào khách mới","delay":{"minSeconds":0,"maxSeconds":0}},"minGapMinutes":720},
  {"eventType":"tag_change","name":"Gắn tag 3 (thứ hai)","enabled":true,"position":2,"config":{"direction":"added","tagIds":[3],"tagNames":[],"message":"Không được chạy","delay":{"minSeconds":0,"maxSeconds":0}},"minGapMinutes":0},
  {"eventType":"tag_change","name":"Gỡ tag","enabled":true,"position":3,"config":{"direction":"removed","tagIds":["3","7"],"tagNames":[],"message":"Tạm biệt","delay":{"minSeconds":0,"maxSeconds":0}},"minGapMinutes":0},
  {"eventType":"condition_group","name":"VIP","enabled":true,"position":4,"dataGroupId":500,"config":{"onEnter":{"enabled":true,"message":"Chào VIP"},"onLeave":{"enabled":true,"message":"Hẹn gặp lại"},"delay":{"minSeconds":0,"maxSeconds":0}},"minGapMinutes":0}
]'::jsonb AS r;

SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 0, 'enabled', true, 'blocklistIds', '[600]'::jsonb,
  'rules', (SELECT r FROM rules_ok)))->>'ok' = 'true', 'save: lưu bot + 5 quy tắc');
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_rules WHERE account_id = 1001 AND NOT is_delete) = 5
  AND (SELECT revision FROM auto_event_bot_settings WHERE account_id = 1001) = 1, 'save: 5 quy tắc, revision 1');
SELECT pg_temp.t((SELECT config->'tagIds' FROM auto_event_bot_rules WHERE name = 'Gắn tag 3 (thứ hai)') = '["3"]', 'save: tagIds số → chuỗi');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 0, 'enabled', true, 'rules', '[]'::jsonb))->>'code' = 'revision_conflict', 'save: revision lệch → revision_conflict');
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_rules WHERE account_id = 1001 AND NOT is_delete) = 5, 'revision_conflict không đổi gì');
SELECT pg_temp.t((SELECT x->>'code' = 'rule_invalid' AND x->>'field' = 'message' AND (x->>'index')::int = 0 FROM (SELECT pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true,
  'rules', '[{"eventType":"birthday","name":"x","enabled":true,"position":0,"config":{"sendTime":"08:30","message":"Chào #{INPUT_Name}"},"minGapMinutes":0}]'::jsonb)) x) q),
  'save: biến #{INPUT_…} bị chặn (rule_invalid, field message, index 0)');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true,
  'rules', '[{"eventType":"birthday","config":{"sendTime":"08:30","message":"a"}},{"eventType":"birthday","config":{"sendTime":"09:00","message":"b"}}]'::jsonb))->>'message'
  = 'Mỗi tài khoản chỉ có một quy tắc sinh nhật', 'save: hai quy tắc sinh nhật bị chặn');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true,
  'rules', '[{"eventType":"birthday","config":{"sendTime":"8:30","message":"a"}}]'::jsonb))->>'field' = 'sendTime', 'save: giờ gửi sai dạng');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true,
  'rules', '[{"eventType":"tag_change","config":{"direction":"added","tagIds":["3"],"message":"a","delay":{"minSeconds":60,"maxSeconds":10}}}]'::jsonb))->>'field' = 'delay', 'save: khoảng chờ sai');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true,
  'rules', '[{"eventType":"condition_group","dataGroupId":501,"config":{"onEnter":{"enabled":true,"message":"a"},"onLeave":{"enabled":false,"message":""},"delay":{"minSeconds":0,"maxSeconds":0}}}]'::jsonb))->>'code' = 'data_group_no_filter', 'save: nhóm không có bộ lọc động');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true,
  'rules', '[{"eventType":"condition_group","dataGroupId":500,"config":{"onEnter":{"enabled":false,"message":""},"onLeave":{"enabled":false,"message":""},"delay":{"minSeconds":0,"maxSeconds":0}}}]'::jsonb))->>'field' = 'onEnter', 'save: nhóm không bật tin nào');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true, 'blocklistIds', '[601]'::jsonb,
  'rules', '[]'::jsonb))->>'code' = 'blocklist_not_found', 'save: danh sách không gửi của người khác bị chặn');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1005, 'revision', 0, 'enabled', true, 'rules', '[]'::jsonb))->>'code' = 'account_on_akachat', 'save: tài khoản akaChat bị chặn');
SELECT pg_temp.t(pg_temp.ctl(300, 30, 'save', jsonb_build_object('accountId', 3001, 'revision', 0, 'enabled', true, 'rules', '[]'::jsonb))->>'code' = 'runtime_not_supported', 'save: Zalo Server đi Fly (fly tắt) bị chặn');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', 1, 'enabled', true,
  'rules', '[{"id":999999,"eventType":"birthday","config":{"sendTime":"08:30","message":"a"}}]'::jsonb))->>'code' = 'rule_not_found', 'save: id quy tắc lạ → rule_not_found');
SELECT pg_temp.t(jsonb_array_length(pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data'->'rules') = 5, 'save lỗi không đổi quy tắc');

-- ---------------------------------------------------------------------------------------------------------------------
-- Sổ tag: danh sách hỏi tag
-- ---------------------------------------------------------------------------------------------------------------------
SELECT set_config('test.staff', '100', false);
SELECT pg_temp.t(public.aka_agent_desktop_zalo_tag_sync_accounts()->'accountIds' = '[1001]', 'watched: tài khoản QR có quy tắc tag được hỏi tag (không có chiến dịch)');
SELECT pg_temp.cfg('{"audience":"off"}');
SELECT pg_temp.t(public.aka_agent_desktop_zalo_tag_sync_accounts()->'accountIds' = '[]', 'watched: bot tắt → không hỏi tag');
SELECT pg_temp.cfg('{"audience":"all","runtimes":{"desktop":true,"server":true,"fly":false},"pollSeconds":30}');

-- ---------------------------------------------------------------------------------------------------------------------
-- Tạo việc từ sổ tag
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.t(pg_temp.tags('v1', ARRAY['111', '222'])->'baselined' = '["1001"]', 'tag: lần đầu chỉ lấy mốc');
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_jobs) = 0, 'tag: lấy mốc không tạo việc');
SELECT pg_temp.tags('v2', ARRAY['111', '222', '333', 'g999']);
SELECT pg_temp.t((pg_temp.job(1001, '333', 'added')).status = 'pending'
  AND (SELECT r.name FROM auto_event_bot_rules r WHERE r.id = (pg_temp.job(1001, '333', 'added')).rule_id) = 'Gắn tag 3', 'tag: gắn tag → việc chờ gửi của quy tắc đứng đầu');
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_jobs WHERE recipient_uid = '333') = 1, 'tag: hai quy tắc cùng khớp chỉ một việc');
SELECT pg_temp.t((pg_temp.job(1001, '333', 'added')).message_template = 'Chào khách mới' AND (pg_temp.job(1001, '333', 'added')).tag_id = '3'
  AND (pg_temp.job(1001, '333', 'added')).expires_at BETWEEN clock_timestamp() + interval '29 minutes' AND clock_timestamp() + interval '31 minutes',
  'tag: mẫu tin, tag, hạn 30 phút');
SELECT pg_temp.t((pg_temp.job(1001, '333', 'added')).dedupe_key ~ '^tag:[0-9]+:333:3:added:[0-9]+$', 'tag: khoá chống trùng đúng khuôn');
SELECT pg_temp.t((pg_temp.job(1001, 'g999', 'added')).status = 'skipped' AND (pg_temp.job(1001, 'g999', 'added')).reason_code = 'not_person', 'tag: nhóm Zalo → not_person');
SELECT pg_temp.tags('v3', ARRAY['111', '333', 'g999']);
SELECT pg_temp.t((pg_temp.job(1001, '222', 'removed')).status = 'pending' AND (pg_temp.job(1001, '222', 'removed')).message_template = 'Tạm biệt', 'tag: gỡ tag → việc của quy tắc gỡ');
-- Gắn hàng loạt 25 người.
SELECT pg_temp.tags('v4', ARRAY['111', '333', 'g999'] || ARRAY(SELECT (9000 + i)::text FROM generate_series(1, 25) i));
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_jobs WHERE recipient_uid LIKE '90__' AND status = 'skipped' AND reason_code = 'bulk_tag') = 25, 'tag: > 20 người một lúc → 25 dòng bulk_tag');
-- Tag 7 có 2 người rồi bị xoá hẳn.
SELECT pg_temp.tags('v5', ARRAY['111', '333', 'g999'], '3', '[{"id":"7","name":"Khách cũ","m":["701","702"]}]');
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_jobs WHERE recipient_uid IN ('701', '702')) = 0, 'tag: gắn tag không có quy tắc → không việc');
SELECT pg_temp.tags('v6', ARRAY['111', '333', 'g999']);
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_jobs WHERE recipient_uid IN ('701', '702') AND reason_code = 'tag_deleted') = 2, 'tag: tag bị xoá hẳn → tag_deleted');
-- Loại trừ UID, SĐT (+84 → 0), danh sách không gửi dùng chung.
SELECT pg_temp.t((pg_temp.ctl(100, 10, 'exclusion_add', '{"accountId":1001,"items":[{"kind":"uid","value":"44400000"},{"kind":"uid","value":"44400000"},{"kind":"phone","value":"+84912345678","name":"Bà 555"}]}'::jsonb)->'data'->>'added')::int = 2,
  'exclusion_add: thêm 2 (bỏ trùng trong lô)');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'exclusion_add', '{"accountId":1001,"items":[{"kind":"uid","value":"444"}]}'::jsonb)->>'code' = 'exclusion_invalid', 'exclusion_add: UID quá ngắn bị chặn');
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_exclusions WHERE account_id = 1001) = 2
  AND EXISTS (SELECT 1 FROM auto_event_bot_exclusions WHERE kind = 'phone' AND value = '0912345678'), 'exclusion_add: 2 dòng, SĐT chuẩn hoá');
SELECT pg_temp.tags('v7', ARRAY['111', '333', 'g999', '44400000', '555', '904']);
SELECT pg_temp.t((pg_temp.job(1001, '44400000', 'added')).reason_code = 'excluded', 'tag: UID loại trừ → excluded');
SELECT pg_temp.t((pg_temp.job(1001, '555', 'added')).reason_code = 'excluded', 'tag: SĐT loại trừ (theo liên hệ) → excluded');
SELECT pg_temp.t((pg_temp.job(1001, '904', 'added')).reason_code = 'excluded', 'tag: danh sách không gửi dùng chung → excluded');
-- Trigger lỗi không làm hỏng câu gốc.
ALTER TABLE auto_event_bot_jobs ADD CONSTRAINT test_break CHECK (recipient_uid IS DISTINCT FROM '666');
SELECT pg_temp.t((pg_temp.tags('v8', ARRAY['111', '333', 'g999', '44400000', '555', '904', '666'])->>'added')::int = 1, 'tag: trigger lỗi → lô tag vẫn ghi');
SELECT pg_temp.t(EXISTS (SELECT 1 FROM auto_zalo_tag_members WHERE account_id = 1001 AND member_uid = '666')
  AND NOT EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE recipient_uid = '666'), 'tag: trigger lỗi → sổ tag có, không có việc');
ALTER TABLE auto_event_bot_jobs DROP CONSTRAINT test_break;
-- Bot tắt công tắc → không tạo gì.
SELECT pg_temp.cfg('{"audience":"off"}');
SELECT pg_temp.tags('v9', ARRAY['111', '333', 'g999', '44400000', '555', '904', '666', '667']);
SELECT pg_temp.t(NOT EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE recipient_uid = '667'), 'tag: công tắc off → không tạo việc');
SELECT pg_temp.cfg('{"audience":"all","runtimes":{"desktop":false,"server":true,"fly":false}}');
SELECT pg_temp.tags('v10', ARRAY['111', '333', 'g999', '44400000', '555', '904', '666', '667', '668']);
SELECT pg_temp.t(NOT EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE recipient_uid = '668'), 'tag: runtime desktop tắt → không tạo việc');
SELECT pg_temp.cfg('{"audience":"all","runtimes":{"desktop":true,"server":true,"fly":false},"pollSeconds":30}');

-- ---------------------------------------------------------------------------------------------------------------------
-- Nhận việc / báo kết quả (Desktop)
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.due(1001);
CREATE TEMP TABLE c1 AS SELECT pg_temp.claim_desktop(ARRAY[1001, 1101, 1002]) AS r;
SELECT pg_temp.t(jsonb_array_length((SELECT r->'jobs' FROM c1)) = 1, 'claim: một việc cho một tài khoản');
SELECT pg_temp.t((SELECT r->'jobs'->0->>'recipientUid' FROM c1) = '333' AND (SELECT r->'jobs'->0->>'message' FROM c1) = 'Chào khách mới', 'claim: việc sớm nhất, kèm mẫu tin');
SELECT pg_temp.t((pg_temp.job(1001, '333', 'added')).status = 'sending' AND (pg_temp.job(1001, '333', 'added')).claimed_by = 'desktop:100'
  AND (pg_temp.job(1001, '333', 'added')).runner_id = 'runner-1', 'claim: sending, claimed_by desktop:100');
SELECT pg_temp.t((SELECT last_claim_source FROM auto_event_bot_settings WHERE account_id = 1001) = 'desktop', 'claim: ghi last_claim');
SELECT pg_temp.t(jsonb_array_length(pg_temp.claim_desktop(ARRAY[1001])->'jobs') = 0, 'claim: đang có việc sending → không giao thêm');
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c1) || '{"claimToken":"00000000-0000-0000-0000-000000000000"}', '{"status":"sent","msgId":"m1"}')->>'code' = 'claim_lost', 'report: sai token → claim_lost');
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c1), '{"status":"sent","msgId":"m1"}') = '{"ok":true,"status":"sent","pausedUntil":null}', 'report: sent có msgId → sent');
SELECT pg_temp.t((pg_temp.job(1001, '333', 'added')).zalo_msg_id = 'm1' AND (pg_temp.job(1001, '333', 'added')).sent_at IS NOT NULL, 'report: lưu msgId, sent_at');
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c1), '{"status":"failed","zaloCode":"122"}') @> '{"ok":true,"status":"sent","replay":true}', 'report: báo lại → trả kết quả cũ');
-- Người 222 được gắn lại tag trước lượt gửi việc "gỡ tag".
SELECT pg_temp.tags('v11', ARRAY['111', '333', 'g999', '44400000', '555', '904', '666', '667', '668', '222']);
SELECT pg_temp.due(1001);
CREATE TEMP TABLE c2 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
SELECT pg_temp.t((pg_temp.job(1001, '222', 'removed')).reason_code = 'tagged_again', 'claim: gỡ tag nhưng đã gắn lại → tagged_again');
-- Việc "gắn 222" (khoảng cách 720 phút không dính vì 222 chưa nhận) được giao.
SELECT pg_temp.t((SELECT r->'jobs'->0->>'recipientUid' FROM c2) = '222', 'claim: lượt sau giao việc kế tiếp');
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c2), '{"status":"sent","msgId":""}')->>'status' = 'failed', 'report: sent không msgId → failed');
SELECT pg_temp.t((pg_temp.job(1001, '222', 'added')).reason_code = 'no_msg_id'
  AND (SELECT paused_until BETWEEN clock_timestamp() + interval '29 minutes' AND clock_timestamp() + interval '31 minutes' AND pause_code = 'no_msg_id' FROM auto_event_bot_settings WHERE account_id = 1001),
  'report: no_msg_id → tạm dừng 30 phút');
-- 333 gỡ rồi gắn lại: quy tắc gắn có khoảng cách 720 phút → min_gap.
SELECT pg_temp.tags('v12', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222']);
SELECT pg_temp.tags('v13', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333']);
SELECT pg_temp.t((pg_temp.job(1001, '333', 'added')).reason_code = 'min_gap', 'tag: vừa nhận tin trong 720 phút → min_gap');
-- Đang tạm dừng: claim trả paused, không giao việc.
SELECT pg_temp.due(1001);
CREATE TEMP TABLE c3 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
SELECT pg_temp.t(jsonb_array_length((SELECT r->'jobs' FROM c3)) = 0 AND (SELECT r->'paused'->0->>'code' FROM c3) = 'no_msg_id', 'claim: bot tự tạm dừng → paused, giữ việc chờ');
SELECT pg_temp.t((pg_temp.job(1001, '333', 'removed')).status = 'pending', 'claim khi tạm dừng không đóng việc');
UPDATE auto_event_bot_settings SET paused_until = NULL, pause_code = NULL WHERE account_id = 1001;
SELECT pg_temp.claim_desktop(ARRAY[1001]);
SELECT pg_temp.t((pg_temp.job(1001, '333', 'removed')).reason_code = 'tagged_again', 'claim (tạm dừng xong): gỡ rồi gắn lại → tagged_again');
UPDATE auto_event_bot_settings SET paused_until = NULL, pause_code = NULL WHERE account_id = 1001;
-- 120 → 24 giờ; 221 → 60 phút; mã khác không dừng; unknown.
SELECT pg_temp.tags('v13b', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152']);
SELECT pg_temp.due(1001);
CREATE TEMP TABLE c4 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
CREATE TEMP TABLE r4 AS SELECT pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c4), '{"status":"failed","zaloCode":"120","errorMessage":"Bạn không thể gửi tin cho người lạ"}') AS r;
SELECT pg_temp.t((SELECT r->>'pausedUntil' IS NOT NULL FROM r4)
  AND (SELECT paused_until > clock_timestamp() + interval '23 hours' AND pause_code = '120' FROM auto_event_bot_settings WHERE account_id = 1001), 'report: 120 → tạm dừng 24 giờ');
SELECT pg_temp.t((SELECT reason_code = 'account_restricted' AND zalo_error_code = '120' FROM auto_event_bot_jobs WHERE id = (SELECT (r->'jobs'->0->>'jobId')::bigint FROM c4)), 'report: lý do account_restricted');
UPDATE auto_event_bot_settings SET paused_until = NULL, pause_code = NULL WHERE account_id = 1001;
CREATE TEMP TABLE c5 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
CREATE TEMP TABLE r5 AS SELECT pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c5), '{"status":"failed","zaloCode":"221"}') AS r;
SELECT pg_temp.t((SELECT r->'jobs'->0 IS NOT NULL FROM c5) AND (SELECT r->>'status' FROM r5) = 'failed'
  AND (SELECT paused_until BETWEEN clock_timestamp() + interval '59 minutes' AND clock_timestamp() + interval '61 minutes' AND pause_code = '221' FROM auto_event_bot_settings WHERE account_id = 1001), 'report: 221 → tạm dừng 60 phút');
UPDATE auto_event_bot_settings SET paused_until = NULL, pause_code = NULL WHERE account_id = 1001;
-- Tạo thêm việc để kiểm mã khác / unknown.
SELECT pg_temp.tags('v14', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152', '1201', '1202']);
SELECT pg_temp.due(1001);
UPDATE auto_event_bot_jobs SET status = 'skipped', reason_code = 'test' WHERE account_id = 1001 AND status = 'pending' AND recipient_uid NOT IN ('1201', '1202');
CREATE TEMP TABLE c6 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
CREATE TEMP TABLE r6 AS SELECT pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c6), '{"status":"failed","zaloCode":"122"}') AS r;
SELECT pg_temp.t((SELECT r FROM r6) = '{"ok":true,"status":"failed","pausedUntil":null}'
  AND (SELECT reason_code FROM auto_event_bot_jobs WHERE id = (SELECT (r->'jobs'->0->>'jobId')::bigint FROM c6)) = 'recipient_error', 'report: mã người nhận → failed, không dừng');
CREATE TEMP TABLE c7 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c7), '{"status":"unknown","errorMessage":"socket hang up"}')->>'status' = 'unknown', 'report: unknown → unknown');
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c7), '{"status":"bad"}')->>'code' = 'invalid_result', 'report: kết quả lạ → invalid_result');
-- Gắn rồi gỡ ngay trước lượt gửi → no_longer_tagged.
SELECT pg_temp.tags('v15', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152', '1201', '1202', '1300']);
SELECT pg_temp.tags('v16', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152', '1201', '1202']);
SELECT pg_temp.due(1001);
UPDATE auto_event_bot_jobs SET status = 'skipped', reason_code = 'test' WHERE account_id = 1001 AND status = 'pending' AND recipient_uid <> '1300';
CREATE TEMP TABLE c8 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
SELECT pg_temp.t((pg_temp.job(1001, '1300', 'added')).reason_code = 'no_longer_tagged', 'claim: gắn rồi gỡ trước lượt gửi → no_longer_tagged');
SELECT pg_temp.t((SELECT r->'jobs'->0->>'recipientUid' FROM c8) = '1300' AND (SELECT r->'jobs'->0->>'direction' FROM c8) = 'removed', 'claim: việc gỡ tag vẫn giao');
SELECT pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c8), '{"status":"sent","msgId":"m9"}');
-- Quy tắc đổi sau lúc có sự kiện; hết hạn.
SELECT pg_temp.tags('v17', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152', '1201', '1202', '1401', '1402']);
UPDATE auto_event_bot_rules SET revision = revision + 1 WHERE account_id = 1001 AND name = 'Gắn tag 3';
UPDATE auto_event_bot_jobs SET expires_at = clock_timestamp() - interval '1 second' WHERE recipient_uid = '1402';
SELECT pg_temp.due(1001);
SELECT pg_temp.claim_desktop(ARRAY[1001]);
SELECT pg_temp.t((pg_temp.job(1001, '1401', 'added')).reason_code = 'rule_changed', 'claim: quy tắc đổi → rule_changed');
SELECT pg_temp.t((pg_temp.job(1001, '1402', 'added')).status = 'expired', 'claim: quá hạn → expired');
UPDATE auto_event_bot_rules SET revision = revision - 1 WHERE account_id = 1001 AND name = 'Gắn tag 3';
-- Desktop không giữ tài khoản của người khác / Server.
SELECT pg_temp.t(pg_temp.claim_desktop(ARRAY[1101, 1002])->'jobs' = '[]', 'claim desktop: tài khoản người khác / Server không nhận');

-- ---------------------------------------------------------------------------------------------------------------------
-- Job dọn
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.tags('v18', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152', '1201', '1202', '1401', '1402', '1501', '1502']);
SELECT pg_temp.due(1001);
CREATE TEMP TABLE c9 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
UPDATE auto_event_bot_jobs SET claimed_at = clock_timestamp() - interval '6 minutes' WHERE id = (SELECT (r->'jobs'->0->>'jobId')::bigint FROM c9);
UPDATE auto_event_bot_jobs SET expires_at = clock_timestamp() - interval '1 minute' WHERE account_id = 1001 AND status = 'pending';
INSERT INTO auto_event_bot_jobs (account_id, organization_id, staff_id, event_type, direction, recipient_uid, dedupe_key, status, created_at)
  VALUES (1001, 10, 100, 'birthday', 'birthday', 'old', 'old:1', 'sent', clock_timestamp() - interval '91 days'),
         (1001, 10, 100, 'birthday', 'birthday', 'old2', 'old:2', 'sent', clock_timestamp() - interval '89 days');
CREATE TEMP TABLE m1 AS SELECT private.aka_agent_event_bot_maintenance() AS r;
SELECT pg_temp.t((SELECT (r->>'expired')::int >= 1 AND (r->>'runnerLost')::int = 1 AND (r->>'deleted')::int = 1 FROM m1), 'maintenance: hết hạn, sending > 5 phút, dọn > 90 ngày');
SELECT pg_temp.t((SELECT status = 'unknown' AND reason_code = 'runner_lost' FROM auto_event_bot_jobs WHERE id = (SELECT (r->'jobs'->0->>'jobId')::bigint FROM c9))
  AND EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE dedupe_key = 'old:2') AND NOT EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE dedupe_key = 'old:1'), 'maintenance: runner_lost, giữ việc 89 ngày');
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM c9), '{"status":"sent","msgId":"late"}')->>'status' = 'sent', 'report muộn sau runner_lost vẫn nhận kết quả thật');
SELECT pg_temp.t(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-event-bot-maintenance' AND schedule = '* * * * *'), 'cron: job mỗi phút đã đăng ký');

-- ---------------------------------------------------------------------------------------------------------------------
-- Nhóm điều kiện (vào / ra)
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO auto_account_contact_group_members (id, group_id, contact_id) VALUES (8001, 500, 801), (8002, 500, 802), (8003, 500, 803), (8004, 500, 804);
-- Không qua job lọc động (không giữ khoá) → không tạo việc.
INSERT INTO auto_account_contact_group_member_origins (id, membership_id, kind, dynamic_filter_id, is_current) VALUES (9001, 8001, 'dynamic_filter', 50, true);
SELECT pg_temp.t(NOT EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE event_type = 'condition_group'), 'nhóm: ghi ngoài job lọc động → không tạo việc');
DELETE FROM auto_account_contact_group_member_origins WHERE id = 9001;
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('data-group-dynamic-filter:100', 0));
INSERT INTO auto_account_contact_group_member_origins (id, membership_id, kind, dynamic_filter_id, is_current) VALUES
  (9001, 8001, 'dynamic_filter', 50, true), (9002, 8002, 'dynamic_filter', 50, true), (9003, 8003, 'dynamic_filter', 50, true);
INSERT INTO auto_account_contact_group_member_origins (id, membership_id, kind, is_current) VALUES (9010, 8004, 'manual', true);
COMMIT;
SELECT pg_temp.t((pg_temp.job(1001, '801', 'enter')).status = 'pending' AND (pg_temp.job(1001, '801', 'enter')).message_template = 'Chào VIP'
  AND (pg_temp.job(1001, '801', 'enter')).source_ref = '9001' AND (pg_temp.job(1001, '801', 'enter')).contact_id = 801, 'nhóm: vào nhóm → việc "khi vào"');
SELECT pg_temp.t((SELECT reason_code FROM auto_event_bot_jobs WHERE contact_id = 802) = 'no_uid', 'nhóm: liên hệ không UID → no_uid');
SELECT pg_temp.t(NOT EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE contact_id IN (803, 804)), 'nhóm: liên hệ tài khoản khác / nguồn không phải bộ lọc → không việc');
SELECT pg_temp.t((pg_temp.job(1001, '801', 'enter')).dedupe_key ~ '^group:[0-9]+:801:enter:[0-9]+$', 'nhóm: khoá chống trùng đúng khuôn');
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('data-group-dynamic-filter:100', 0));
UPDATE auto_account_contact_group_member_origins SET is_current = true, updated_at = clock_timestamp() WHERE id = 9001; -- true → true
COMMIT;
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_jobs WHERE contact_id = 801) = 1, 'nhóm: true → true không tạo việc');
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('data-group-dynamic-filter:100', 0));
UPDATE auto_account_contact_group_member_origins SET is_current = false, updated_at = clock_timestamp() WHERE id = 9001;
COMMIT;
SELECT pg_temp.t((pg_temp.job(1001, '801', 'leave')).status = 'pending' AND (pg_temp.job(1001, '801', 'leave')).message_template = 'Hẹn gặp lại', 'nhóm: ra nhóm → việc "khi ra"');
SELECT pg_temp.due(1001);
UPDATE auto_event_bot_jobs SET send_after = clock_timestamp() + interval '1 hour' WHERE account_id = 1001 AND status = 'pending' AND event_type <> 'condition_group';
CREATE TEMP TABLE g1 AS SELECT pg_temp.claim_desktop(ARRAY[1001]) AS r;
SELECT pg_temp.t((pg_temp.job(1001, '801', 'enter')).reason_code = 'left_group', 'claim: vào rồi ra trước lượt gửi → left_group');
SELECT pg_temp.t((SELECT r->'jobs'->0->>'direction' FROM g1) = 'leave', 'claim: việc "khi ra" được giao');
SELECT pg_temp.report_desktop((SELECT r->'jobs'->0 FROM g1), '{"status":"sent","msgId":"g1"}');
-- Vào lại: việc mới (khoá khác theo updated_at).
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('data-group-dynamic-filter:100', 0));
UPDATE auto_account_contact_group_member_origins SET is_current = true, updated_at = clock_timestamp() WHERE id = 9001;
COMMIT;
SELECT pg_temp.t((SELECT count(*) FROM auto_event_bot_jobs WHERE contact_id = 801 AND direction = 'enter') = 2, 'nhóm: vào lại → việc mới');
-- Khoảng cách tối thiểu theo chiều với nhóm.
UPDATE auto_event_bot_rules SET min_gap_minutes = 60 WHERE event_type = 'condition_group';
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('data-group-dynamic-filter:100', 0));
UPDATE auto_account_contact_group_member_origins SET is_current = false, updated_at = clock_timestamp() + interval '1 second' WHERE id = 9001;
COMMIT;
SELECT pg_temp.t((pg_temp.job(1001, '801', 'leave')).reason_code = 'min_gap', 'nhóm: vừa nhận tin "khi ra" → min_gap (riêng chiều)');
UPDATE auto_event_bot_rules SET min_gap_minutes = 0 WHERE event_type = 'condition_group';

-- ---------------------------------------------------------------------------------------------------------------------
-- Sinh nhật + App Server
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1002, 'revision', 0, 'enabled', true,
  'rules', '[{"eventType":"birthday","name":"SN","enabled":true,"position":0,"config":{"sendTime":"00:00","message":"Chúc mừng sinh nhật"}}]'::jsonb))->>'ok' = 'true', 'save: Zalo Server bật sinh nhật');
CREATE TEMP TABLE s1 AS SELECT public.aka_agent_event_bot_sync_v1('server') AS r;
SELECT pg_temp.t((SELECT r->'accounts' = '[{"staffId":100,"birthday":{"enabled":true,"sendTime":"00:00","scanToday":true},"accountId":1002}]' AND (r->>'enabled')::boolean FROM s1), 'sync server: chỉ tài khoản Server, cần đọc sinh nhật hôm nay');
SELECT pg_temp.t(public.aka_agent_event_bot_sync_v1('desktop')->>'code' = 'invalid_source', 'sync service: source desktop bị từ chối');
SELECT set_config('test.staff', '100', false);
SELECT pg_temp.t((SELECT jsonb_agg(x->>'accountId') FROM jsonb_array_elements(public.aka_agent_desktop_event_bot_sync_v1()->'accounts') x) = '["1001"]', 'sync desktop: chỉ tài khoản Desktop của nhân viên');
CREATE TEMP TABLE b1 AS SELECT public.aka_agent_event_bot_birthdays_v1('server', 1002, '[{"uid":"2001","name":"Anh Một"},{"uid":"2002"},{"uid":"2001"},{"uid":"g5"},{"uid":"bad"}]') AS r;
SELECT pg_temp.t((SELECT r->>'created' = '2' AND r->>'skipped' = '1' FROM b1), 'birthdays: 2 việc + 1 bỏ qua (nhóm), bỏ trùng / sai');
SELECT pg_temp.t((pg_temp.job(1002, '2001', 'birthday')).dedupe_key = 'birthday:1002:2001:' || extract(year FROM timezone('Asia/Ho_Chi_Minh', now()))::int
  AND (pg_temp.job(1002, '2001', 'birthday')).expires_at = ((timezone('Asia/Ho_Chi_Minh', now())::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '1 second'
  AND (pg_temp.job(1002, '2001', 'birthday')).recipient_name = 'Anh Một', 'birthdays: khoá năm VN, hạn 23:59:59 giờ VN');
SELECT pg_temp.t(public.aka_agent_event_bot_birthdays_v1('server', 1002, '[{"uid":"2001"}]')->>'duplicates' = '1', 'birthdays: gọi lại không tạo trùng');
SELECT pg_temp.t((public.aka_agent_event_bot_sync_v1('server')->'accounts'->0->'birthday'->>'scanToday') = 'false', 'sync: đã đọc hôm nay → scanToday false');
SELECT pg_temp.t(public.aka_agent_event_bot_birthdays_v1('server', 1001, '[]')->>'code' = 'account_not_eligible', 'birthdays server: tài khoản Desktop bị từ chối');
CREATE TEMP TABLE sv1 AS SELECT public.aka_agent_event_bot_claim_v1('server', 'vps-1', ARRAY[1002, 1001], 5) AS r;
SELECT pg_temp.t((SELECT jsonb_array_length(r->'jobs') = 1 AND r->'jobs'->0->>'eventType' = 'birthday' AND r->'jobs'->0->>'accountId' = '1002' FROM sv1), 'claim server: giao việc sinh nhật, không nhận tài khoản Desktop');
SELECT pg_temp.t(public.aka_agent_event_bot_report_v1('server', (SELECT (r->'jobs'->0->>'jobId')::bigint FROM sv1), (SELECT (r->'jobs'->0->>'claimToken')::uuid FROM sv1), '{"status":"sent","msgId":"s1"}')->>'status' = 'sent', 'report server: sent');
SELECT pg_temp.t(pg_temp.report_desktop((SELECT r->'jobs'->0 FROM sv1), '{"status":"sent","msgId":"x"}')->>'code' IN ('claim_lost', 'job_not_found'), 'report desktop cho việc của Server → từ chối');

-- ---------------------------------------------------------------------------------------------------------------------
-- Trang: log / log_detail / report / stop / exclusions
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.t(jsonb_array_length(pg_temp.ctl(100, 10, 'log', '{"accountId":1001,"limit":5}')->'data'->'items') = 5
  AND pg_temp.ctl(100, 10, 'log', '{"accountId":1001,"limit":5}')->'data'->>'nextBefore' IS NOT NULL, 'log: trang 5 dòng, có nextBefore');
SELECT pg_temp.t((SELECT bool_and(x->>'status' = 'sent') FROM jsonb_array_elements(pg_temp.ctl(100, 10, 'log', '{"accountId":1001,"status":"sent"}')->'data'->'items') x), 'log: lọc theo trạng thái');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'log_detail', jsonb_build_object('accountId', 1001, 'jobId', (pg_temp.job(1001, '333', 'added')).id))->'data'->>'messageTemplate' IS NOT NULL, 'log_detail: có mẫu tin');
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'log_detail', jsonb_build_object('accountId', 1001, 'jobId', (pg_temp.job(1002, '2001', 'birthday')).id))->>'code' = 'job_not_found', 'log_detail: việc của tài khoản khác → job_not_found');
CREATE TEMP TABLE rp AS SELECT pg_temp.ctl(100, 10, 'report', '{"accountId":1001,"days":30}')->'data' AS r;
SELECT pg_temp.t((SELECT (r->'totals'->>'matched')::int = (SELECT count(*) FROM auto_event_bot_jobs WHERE account_id = 1001 AND created_at > now() - interval '30 days')
  AND (r->'totals'->>'sent')::int = (SELECT count(*) FROM auto_event_bot_jobs WHERE account_id = 1001 AND status = 'sent' AND created_at > now() - interval '30 days')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(r->'byReason') x WHERE x->>'code' = 'bulk_tag' AND (x->>'count')::int = (SELECT count(*) FROM auto_event_bot_jobs WHERE reason_code = 'bulk_tag'))
  AND jsonb_array_length(r->'byDay') >= 1 AND jsonb_array_length(r->'byRule') >= 3 FROM rp), 'report: tổng, theo lý do, theo ngày, theo quy tắc');
SELECT pg_temp.t((SELECT (x->>'sent7d')::int >= 1 FROM jsonb_each(pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data'->'stats') e(k, x)), 'get: stats của quy tắc nhóm');
-- Sửa nội dung quy tắc → việc chờ của quy tắc đó đóng rule_changed; tắt quy tắc → rule_off.
SELECT pg_temp.tags('v19', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152', '1201', '1202', '1401', '1402', '1501', '1502', '1601']);
CREATE TEMP TABLE cur AS SELECT pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data' AS d;
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', (SELECT (d->'settings'->>'revision')::int FROM cur), 'enabled', true,
  'blocklistIds', '[600]'::jsonb, 'rules', (SELECT jsonb_agg(CASE WHEN x->>'name' = 'Gắn tag 3' THEN jsonb_set(x, '{config,message}', '"Chào khách mới (sửa)"') ELSE x END)
   FROM jsonb_array_elements((SELECT d->'rules' FROM cur)) x)))->'data'->>'closedJobs' = '1', 'save: sửa nội dung → đóng việc chờ của quy tắc');
SELECT pg_temp.t((pg_temp.job(1001, '1601', 'added')).reason_code = 'rule_changed', 'save: việc chờ thành rule_changed');
SELECT pg_temp.t((SELECT revision FROM auto_event_bot_rules WHERE name = 'Gắn tag 3') = 2 AND (SELECT revision FROM auto_event_bot_rules WHERE name = 'Gỡ tag') = 1, 'save: chỉ quy tắc đổi nội dung tăng revision');
-- Bỏ quy tắc khỏi danh sách → xoá mềm.
DROP TABLE cur;
CREATE TEMP TABLE cur AS SELECT pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data' AS d;
SELECT pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', (SELECT (d->'settings'->>'revision')::int FROM cur), 'enabled', true,
  'blocklistIds', '[600]'::jsonb, 'rules', (SELECT jsonb_agg(x) FROM jsonb_array_elements((SELECT d->'rules' FROM cur)) x WHERE x->>'name' <> 'Gắn tag 3 (thứ hai)')));
SELECT pg_temp.t((SELECT is_delete AND NOT enabled FROM auto_event_bot_rules WHERE name = 'Gắn tag 3 (thứ hai)'), 'save: quy tắc không gửi lên → xoá mềm');
-- stop
SELECT pg_temp.tags('v20', ARRAY['111', 'g999', '44400000', '555', '904', '666', '667', '668', '222', '333', '1151', '1152', '1201', '1202', '1401', '1402', '1501', '1502', '1601', '1701']);
CREATE TEMP TABLE st1 AS SELECT pg_temp.ctl(100, 10, 'stop', '{"accountId":1001}') AS r;
SELECT pg_temp.t((SELECT (r->'data'->>'closedJobs')::int >= 1 FROM st1) AND (pg_temp.job(1001, '1701', 'added')).reason_code = 'bot_off'
  AND NOT (SELECT enabled FROM auto_event_bot_settings WHERE account_id = 1001), 'stop: tắt bot, việc chờ → bot_off');
SELECT pg_temp.t(public.aka_agent_desktop_zalo_tag_sync_accounts()->'accountIds' = '[]', 'stop: không còn hỏi tag cho tài khoản');
-- exclusions
SELECT pg_temp.t((pg_temp.ctl(100, 10, 'exclusion_remove', jsonb_build_object('accountId', 1001, 'ids', (SELECT jsonb_agg(id) FROM auto_event_bot_exclusions WHERE kind = 'uid')))->'data'->>'removed')::int = 1, 'exclusion_remove');
INSERT INTO auto_event_bot_exclusions (account_id, kind, value) SELECT 1001, 'uid', (10000000 + i)::text FROM generate_series(1, 4999) i;
SELECT pg_temp.t(pg_temp.ctl(100, 10, 'exclusion_add', '{"accountId":1001,"items":[{"kind":"uid","value":"99999999"}]}')->>'code' = 'exclusion_limit', 'exclusion_add: trần 5.000');

-- ---------------------------------------------------------------------------------------------------------------------
-- Dấu đặt lại mốc sổ tag khi bật / tắt quy tắc tag
-- ---------------------------------------------------------------------------------------------------------------------
DELETE FROM auto_zalo_tag_sync_resets;
DROP TABLE cur;
CREATE TEMP TABLE cur AS SELECT pg_temp.ctl(100, 10, 'get', '{"accountId":1001}')->'data' AS d;
SELECT pg_temp.ctl(100, 10, 'save', jsonb_build_object('accountId', 1001, 'revision', (SELECT (d->'settings'->>'revision')::int FROM cur), 'enabled', true,
  'blocklistIds', '[600]'::jsonb, 'rules', (SELECT d->'rules' FROM cur)));
SELECT pg_temp.t(EXISTS (SELECT 1 FROM auto_zalo_tag_sync_resets WHERE account_id = 1001), 'save: bật lại bot có quy tắc tag → ghi dấu đặt lại mốc sổ tag');

-- ---------------------------------------------------------------------------------------------------------------------
-- Độc lập với chiến dịch, quyền
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.t((SELECT a = (SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM auto_account_action_status t)
  AND d = (SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM auto_campaign_details t)
  AND l = (SELECT md5(string_agg(t::text, ',' ORDER BY account_id)) FROM auto_engine_leases t)
  AND c = (SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM auto_campaigns t) FROM indep_before),
  'độc lập: không đụng auto_account_action_status / auto_campaign_details / auto_engine_leases / auto_campaigns');
SELECT pg_temp.t(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname LIKE '%event_bot%'
  AND (p.prosrc ~* 'auto_account_action_status|auto_campaign_details|auto_engine_leases' OR p.prosrc ~* '(update|insert into|delete from)\s+public\.auto_campaigns')), 'độc lập: không hàm nào của bot ghi bảng chiến dịch');
SELECT pg_temp.t(NOT has_function_privilege('anon', 'public.aka_agent_control_event_bot(bigint,bigint,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.aka_agent_desktop_event_bot_claim_v1(text,bigint[],integer)', 'EXECUTE')
  AND NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_event_bot_claim_v1(text,text,bigint[],integer)', 'EXECUTE')
  AND NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_control_event_bot(bigint,bigint,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('aka_agent_chat_api', 'public.aka_agent_event_bot_claim_v1(text,text,bigint[],integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.aka_agent_event_bot_tag_trigger()', 'EXECUTE')
  AND NOT has_function_privilege('aka_agent_desktop', 'private.aka_agent_event_bot_claim_core(text,bigint,text,bigint[],integer)', 'EXECUTE')
  AND NOT has_table_privilege('service_role', 'public.auto_event_bot_rules', 'SELECT')
  AND NOT has_table_privilege('aka_agent_desktop', 'public.auto_event_bot_jobs', 'SELECT'), 'quyền: chỉ đúng vai trò gọi được');
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('test.staff', '100', true);
  SET LOCAL ROLE aka_agent_desktop;
  v := public.aka_agent_desktop_event_bot_sync_v1();
  IF v->>'ok' = 'true' AND jsonb_typeof(v->'accounts') = 'array' THEN RAISE NOTICE 'PASS: vai aka_agent_desktop gọi được bản Desktop';
  ELSE RAISE EXCEPTION 'FAIL: vai desktop: %', v; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM set_config('test.staff', '', true);
  SET LOCAL ROLE aka_agent_desktop;
  PERFORM public.aka_agent_desktop_event_bot_claim_v1('x', ARRAY[1001], 1);
  RAISE EXCEPTION 'FAIL: không có phiên mà vẫn gọi được';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: bản Desktop không có phiên → 42501';
END $$;
RESET ROLE;
DO $$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.aka_agent_control_event_bot(100, 10, 'accounts', '{}');
  IF v->>'ok' = 'true' THEN RAISE NOTICE 'PASS: vai service_role gọi được RPC trang';
  ELSE RAISE EXCEPTION 'FAIL: service_role: %', v; END IF;
  v := public.aka_agent_event_bot_sync_v1('server');
  IF v->>'ok' = 'true' THEN RAISE NOTICE 'PASS: vai service_role gọi được RPC nơi chạy';
  ELSE RAISE EXCEPTION 'FAIL: service_role sync: %', v; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE aka_agent_desktop;
    PERFORM public.aka_agent_event_bot_claim_v1('server', 'x', ARRAY[1002], 1);
    RAISE EXCEPTION 'FAIL: desktop gọi được hàm service';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: desktop gọi hàm service bị từ chối (42501)';
  END;
END $$;
RESET ROLE;
SELECT pg_temp.t(NOT EXISTS (SELECT 1 FROM auto_event_bot_jobs WHERE status = 'sending' GROUP BY account_id HAVING count(*) > 1), 'bất biến: mỗi tài khoản tối đa 1 việc sending');
-- Sổ tag V660 vẫn hỏi tài khoản có chiến dịch tự thêm (nhánh cũ của watched).
INSERT INTO auto_campaigns (id, name, action_id, account_id, staff_id, organization_id, status, extra_settings) VALUES
  (2, 'Tự thêm', 'zalo_message_friend', 1101, 101, 10, 'chờ xử lý',
   '{"zaloFriendTargetMode":"tagged_friends","zaloFriendTagAutoAddEnabled":true,"zaloFriendSourceTagIds":["5"]}');
SELECT set_config('test.staff', '101', false);
SELECT pg_temp.t(public.aka_agent_desktop_zalo_tag_sync_accounts()->'accountIds' = '[1101]', 'watched: nhánh chiến dịch tự thêm (V660) giữ nguyên');
SELECT pg_temp.t((SELECT jsonb_agg(account_id ORDER BY account_id) FROM private.aka_agent_zalo_tag_sync_watched(private.aka_agent_zalo_tag_sync_config(), 'desktop', NULL, NULL))
  = '[1001, 1101]', 'watched: hợp hai nhánh, không trùng');
SELECT pg_temp.cfg('{"audience":"off"}');
SELECT pg_temp.t(public.aka_agent_event_bot_claim_v1('server', 'vps', ARRAY[1002], 5) @> '{"ok":true,"enabled":false}' AND (public.aka_agent_event_bot_sync_v1('server')->>'enabled') = 'false', 'bot off: claim / sync trả enabled=false');
\echo ALL PASS
