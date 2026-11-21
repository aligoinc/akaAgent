-- V615: người nhận từ chối lời mời kết bạn (loại sự kiện 'friend_rejected', cột rejected_at).
-- Chạy sau V615 bằng scripts/run-zalo-engagement-v615-smoke.cjs. Mọi thứ trong một giao dịch, cuối cùng ROLLBACK.
BEGIN;
INSERT INTO org_staff VALUES(1,1,true,'owner','password');
INSERT INTO zalo_accounts VALUES(1,'sender');
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id) VALUES(1,1,1,1);
INSERT INTO auto_campaigns VALUES(1,1,1);
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
CREATE TEMP TABLE test_revision AS SELECT updated_at::text r FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled';
GRANT SELECT ON test_revision TO anon,service_role;
-- 1, 2: lời mời kết bạn tới r1, r2; 3: tin nhắn người lạ tới r1 (không được nhận mốc từ chối).
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
SELECT i,1,1,CASE WHEN i=3 THEN 'zalo_message_stranger' ELSE 'zalo_add_friend' END,'Gửi','thành công',
  jsonb_build_object('zaloEngagementSource',jsonb_build_object('version',1,'revision',r,'accountZaloUid','sender',
    'targetZaloUid',CASE WHEN i=2 THEN 'r2' ELSE 'r1' END,'actionType',CASE WHEN i=3 THEN 'message' ELSE 'friend_request' END,
    'sentAt','2026-01-01T00:00:00Z','messageIds',CASE WHEN i=3 THEN '["m3"]'::jsonb ELSE '[]'::jsonb END))
FROM test_revision CROSS JOIN generate_series(1,3) i;
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"detailId":"1"},{"detailId":"2"},{"detailId":"3"}]','owner','password');
DO $$ BEGIN
 IF (SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE rejected_at IS NULL)<>3 THEN RAISE EXCEPTION 'new watches start without rejected_at'; END IF;
END $$;

-- Từ chối r1 lúc 01:00 (ghi mốc cho lời mời 1), một sự kiện lạ và một sự kiện quá hạn theo dõi (r2, 5 ngày sau) bị bỏ qua.
DO $$ DECLARE v jsonb; BEGIN
 v := aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),
   '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"r1","kind":"friend_rejected","occurredAt":"2026-01-01T01:00:00Z","messageIds":[]},
     {"accountId":"1","accountZaloUid":"sender","targetZaloUid":"r1","kind":"bogus","occurredAt":"2026-01-01T01:00:00Z","messageIds":[]},
     {"accountId":"1","accountZaloUid":"sender","targetZaloUid":"r2","kind":"friend_rejected","occurredAt":"2026-01-06T00:00:00Z","messageIds":[]}]',
   'owner','password');
 IF (v->>'updated')::int<>1 THEN RAISE EXCEPTION 'rejection updated % rows, expected 1', v->>'updated'; END IF;
 IF (SELECT rejected_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=1) IS DISTINCT FROM '2026-01-01T01:00:00Z'::timestamptz THEN RAISE EXCEPTION 'rejected_at not recorded'; END IF;
 IF (SELECT rejected_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=3) IS NOT NULL THEN RAISE EXCEPTION 'message watch got rejected_at'; END IF;
 IF (SELECT rejected_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=2) IS NOT NULL THEN RAISE EXCEPTION 'rejection outside tracking window recorded'; END IF;
 IF EXISTS (SELECT 1 FROM auto_campaign_detail_zalo_engagement WHERE friended_at IS NOT NULL OR seen_at IS NOT NULL OR responded_at IS NOT NULL OR reacted_at IS NOT NULL) THEN
   RAISE EXCEPTION 'rejection touched other marks'; END IF;
END $$;

-- Mốc sớm nhất được giữ: lần báo sau với giờ muộn hơn không đổi gì, giờ sớm hơn thì thay.
DO $$ DECLARE v jsonb; BEGIN
 v := aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),
   '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"r1","kind":"friend_rejected","occurredAt":"2026-01-01T02:00:00Z","messageIds":[]}]','owner','password');
 IF (v->>'updated')::int<>0 THEN RAISE EXCEPTION 'later rejection rewrote the mark'; END IF;
 v := aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),
   '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"r1","kind":"friend_rejected","occurredAt":"2026-01-01T00:30:00Z","messageIds":[]}]','owner','password');
 IF (v->>'updated')::int<>1 OR (SELECT rejected_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=1) IS DISTINCT FROM '2026-01-01T00:30:00Z'::timestamptz THEN
   RAISE EXCEPTION 'earlier rejection must win'; END IF;
END $$;

-- "Đã kết bạn" vẫn ghi như trước (r2), không đụng mốc từ chối.
DO $$ DECLARE v jsonb; BEGIN
 v := aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),
   '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"r2","kind":"friend","occurredAt":"2026-01-01T03:00:00Z","messageIds":[]}]','owner','password');
 IF (v->>'updated')::int<>1 OR (SELECT friended_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=2) IS DISTINCT FROM '2026-01-01T03:00:00Z'::timestamptz
   OR (SELECT rejected_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=2) IS NOT NULL THEN RAISE EXCEPTION 'friend mark changed'; END IF;
END $$;

-- Danh sách kết quả trả trường mới trong zalo_engagement (to_jsonb), Web / Desktop đọc từ đây.
DO $$ DECLARE v jsonb; BEGIN
 v := aka_agent_list_campaign_details_page_v2(1,1,1,NULL,NULL,NULL,NULL,0,10,'created_desc','owner','password',NULL);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x
   WHERE (x->>'id')::bigint=1 AND x->'zalo_engagement'->>'rejected_at' IS NOT NULL) THEN RAISE EXCEPTION 'list page lacks rejected_at: %', v; END IF;
END $$;

-- Tổ chức có Chat: sự kiện từ chối đã lưu ở chat_zalo_runtime_event trước khi lượt gửi kịp đăng ký.
INSERT INTO chat_zalo_account VALUES(3,'chat-sender');
INSERT INTO auto_accounts(id,staff_id,organization_id) VALUES(3,1,1);
INSERT INTO chat_zalo_account_organization VALUES(3,3,1,3,true);
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
 SELECT 4,1,3,'zalo_add_friend','Kết bạn','thành công',jsonb_build_object('zaloEngagementSource',jsonb_build_object('version',1,'revision',r,
   'accountZaloUid','chat-sender','targetZaloUid','r3','actionType','friend_request','sentAt','2026-01-01T00:00:00Z','messageIds','[]'::jsonb))
 FROM test_revision;
INSERT INTO chat_zalo_runtime_event(id,organization_id,chat_zalo_account_organization_id,processed_at,engagement_state,engagement_revision,engagement_payload,engagement_occurred_at,engagement_target_uid,engagement_account_uid)
 SELECT 1,1,3,now(),'done',r,'{"staffId":"1","events":[{"kind":"friend_rejected","messageIds":[]}]}','2026-01-01T00:10:00Z','r3','chat-sender' FROM test_revision;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"detailId":"4"}]',NULL,NULL);
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN
 IF (SELECT rejected_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=4) IS DISTINCT FROM '2026-01-01T00:10:00Z'::timestamptz THEN
   RAISE EXCEPTION 'Chat early rejection reconciliation'; END IF;
 IF (SELECT friended_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=4) IS NOT NULL THEN RAISE EXCEPTION 'rejection reconciled as friend'; END IF;
END $$;
ROLLBACK;
