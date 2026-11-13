-- Ở akaAgent file này là migrations/rollback_v526_zalo_message_status_statuses.sql (giống nhau từng byte).
-- Gỡ đúng những gì catalog_zalo_message_status_statuses.sql đã làm trong các bảng quản lý trạng thái, không hơn:
--   1. Xoá bốn quy tắc do bước đó thêm: zalo.delivered, zalo.seen, zalo.reaction, zalo.reply áp dụng cho mọi hành động
--      (action_code NULL), kể cả khi về sau chúng đã được sửa. Quy tắc 'zalo.*' do nơi khác thêm (riêng cho một hành động, hay
--      zalo.friend) KHÔNG bị xoá: tính năng vẫn ghi cột trạng thái theo các quy tắc đó, và file này báo ra còn bao nhiêu.
--   2. Tắt lại hai trạng thái campaign_detail_reacted và campaign_detail_replied, nhưng chỉ dòng mang câu đánh dấu của bước đó
--      (tức do bước đó bật) và không còn quy tắc đang bật nào trỏ tới. Chỉ TẮT, không xoá: kết quả chiến dịch có thể đang trỏ
--      tới chúng qua sub_status_id. Câu mô tả được trả về "Chưa bật: ...". "Đã nhận" và "Đã xem" không bị đụng tới.
-- Trạng thái phụ đã ghi vào kết quả giữ nguyên.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DELETE FROM public.auto_status_event_rules
WHERE event_kind IN ('zalo.delivered', 'zalo.seen', 'zalo.reaction', 'zalo.reply') AND action_code IS NULL;

UPDATE public.auto_status s
SET is_active = false,
    description = replace(s.description, 'Do đồng bộ trạng thái tin nhắn Zalo ghi (quy tắc zalo.* trong auto_status_event_rules).',
                          'Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).'),
    updated_at = now()
WHERE s.code IN ('campaign_detail_reacted', 'campaign_detail_replied') AND s.component_type = 'campaign_detail' AND s.is_active
  AND s.description LIKE '%Do đồng bộ trạng thái tin nhắn Zalo ghi (quy tắc zalo.* trong auto_status_event_rules).%'
  AND NOT EXISTS (SELECT 1 FROM public.auto_status_event_rules r WHERE r.status_id = s.id AND r.is_active);

DO $report$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(r.event_kind || COALESCE(' (' || r.action_code || ')', ''), ', ' ORDER BY r.event_kind, r.action_code) INTO v_left
  FROM public.auto_status_event_rules r WHERE r.event_kind LIKE 'zalo.%' AND r.is_active;
  IF v_left IS NOT NULL THEN
    RAISE NOTICE 'Còn quy tắc zalo.* đang bật do nơi khác thêm, tính năng vẫn ghi cột trạng thái theo chúng: %', v_left;
  END IF;
END
$report$;

COMMIT;
