-- BƯỚC RIÊNG, chạy sau migration_zalo_message_status_sync.sql. KHÔNG apply khi chưa được chủ hệ thống duyệt.
-- Ở akaAgent file này là migrations/migration_v523_zalo_message_status_statuses.sql (giống nhau từng byte).
--
-- Nối "Đồng bộ trạng thái tin nhắn Zalo" vào các bảng quản lý trạng thái của hệ thống, để bậc đã đạt của một lượt gửi được
-- đưa vào cột trạng thái (trạng thái phụ) của kết quả chiến dịch. Chưa chạy file này thì tính năng vẫn ghi đủ mốc thời gian ở
-- bảng riêng, nhưng KHÔNG đổi cột trạng thái nào, dù zalo.message_status_sync.update_result_status = 'true'.
--
-- Đối chiếu với DB thật ngày 13/11/2026: danh mục auto_status ĐÃ CÓ đủ bốn trạng thái, không cần thêm trạng thái nào:
--   campaign_detail_received  "Đã nhận"          đang bật (SMS đang dùng)
--   campaign_detail_viewed    "Đã xem"           đang bật (email đang dùng)
--   campaign_detail_reacted   "Đã thả cảm xúc"   CHƯA bật (akaAgent V494 thêm sẵn, chờ một bộ chạy ghi nó)
--   campaign_detail_replied   "Đã phản hồi"      CHƯA bật (như trên)
-- Thứ bậc progress_rank của danh mục (20 < 30 < 40 < 50) trùng với thứ bậc của tính năng.
--
-- File này làm hai việc, cả hai đều là thay đổi DỮ LIỆU trong bảng quản lý trạng thái:
--   1. Bật hai trạng thái còn tắt, và ghi vào phần mô tả của chúng một câu đánh dấu ("Do đồng bộ trạng thái tin nhắn Zalo
--      ghi ...") để file gỡ biết đúng những trạng thái do bước này bật. Trạng thái nào đã được nơi khác bật sẵn thì không bị
--      đụng tới. Sau khi bật, chúng xuất hiện ở mọi nơi liệt kê trạng thái đang dùng của kết quả.
--   2. Thêm bốn quy tắc vào auto_status_event_rules (bảng "sự kiện → trạng thái" của akaAgent V495, nơi email.open,
--      email.click và sms.received đang nằm): zalo.delivered, zalo.seen, zalo.reaction, zalo.reply; áp dụng cho mọi hành
--      động (action_code NULL). "Đồng ý kết bạn" (zalo.friend) không có quy tắc vì danh mục chưa có trạng thái tương ứng.
--
-- NGƯỜI DÙNG CHỐT NGÀY 13/11/2026: đồng ý bước này; riêng "Đã nhận" CHƯA đưa vào cột trạng thái. Vì vậy quy tắc
-- zalo.delivered được thêm sẵn nhưng ở trạng thái TẮT (is_active = false): gần như tin nào gửi thành công cũng được báo "đã
-- nhận", ghi bậc này làm lượng ghi vào bảng kết quả 36 GB tăng 20-30% thay vì khoảng 3%. "Đã nhận" vẫn được ghi mốc thời gian
-- và vẫn hiện ở cột "Tương tác Zalo". Khi quyết định đưa "Đã nhận" vào cột trạng thái (sau khi đã đo tải):
--   UPDATE public.auto_status_event_rules SET is_active = true, updated_at = now() WHERE event_kind = 'zalo.delivered' AND action_code IS NULL;
-- Bớt một bậc khác khỏi cột trạng thái: đặt is_active = false cho quy tắc của bậc đó. Dùng trạng thái khác cho một bậc: sửa
-- status_id của quy tắc. Việc ghi luôn theo quy tắc đang bật lúc ghi.
-- Gỡ: catalog_rollback_zalo_message_status_statuses.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_missing text;
  v_clash text;
  v_sequence text;
  v_next bigint;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ' ORDER BY need.tbl, need.col) INTO v_missing
  FROM (VALUES ('auto_status', 'id'), ('auto_status', 'code'), ('auto_status', 'component_type'), ('auto_status', 'description'),
               ('auto_status', 'is_active'), ('auto_status', 'is_delete'), ('auto_status', 'updated_at'),
               ('auto_status_event_rules', 'id'), ('auto_status_event_rules', 'event_kind'), ('auto_status_event_rules', 'action_code'),
               ('auto_status_event_rules', 'status_id'), ('auto_status_event_rules', 'description'),
               ('auto_status_event_rules', 'is_active')) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.' || need.tbl) AND a.attname = need.col AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'zalo_message_status_catalog_expected_column_missing: %', v_missing;
  END IF;
  -- Bốn trạng thái phải có sẵn trong danh mục (loại campaign_detail, chưa xoá). File này không tạo trạng thái.
  SELECT string_agg(need.code, ', ' ORDER BY need.code) INTO v_missing
  FROM (VALUES ('campaign_detail_received'), ('campaign_detail_viewed'), ('campaign_detail_reacted'), ('campaign_detail_replied')) AS need(code)
  WHERE NOT EXISTS (SELECT 1 FROM public.auto_status s
                    WHERE s.code = need.code AND s.component_type = 'campaign_detail' AND NOT s.is_delete);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'zalo_message_status_catalog_status_missing: %', v_missing;
  END IF;
  -- "Đã nhận" và "Đã xem" đang được SMS và email dùng: nếu ai đó đã tắt chúng thì đó là một quyết định cần hỏi lại, không tự bật.
  SELECT string_agg(s.code, ', ' ORDER BY s.code) INTO v_missing
  FROM public.auto_status s
  WHERE s.code IN ('campaign_detail_received', 'campaign_detail_viewed') AND s.component_type = 'campaign_detail' AND NOT s.is_active;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'zalo_message_status_catalog_status_inactive: %', v_missing;
  END IF;
  -- Không ghi đè quy tắc đã có (đang bật hay đang tắt) của bốn loại sự kiện này.
  SELECT string_agg(r.event_kind || COALESCE(' (' || r.action_code || ')', ''), ', ' ORDER BY r.event_kind) INTO v_clash
  FROM public.auto_status_event_rules r
  WHERE r.event_kind IN ('zalo.delivered', 'zalo.seen', 'zalo.reaction', 'zalo.reply');
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'zalo_message_status_catalog_rule_already_exists: %', v_clash;
  END IF;
  -- Mã id của quy tắc lấy từ sequence của cột: sequence tụt sau max(id) thì lệnh INSERT sẽ trùng khoá. Kiểm mà không tiêu số nào.
  v_sequence := pg_get_serial_sequence('public.auto_status_event_rules', 'id');
  IF v_sequence IS NOT NULL THEN
    EXECUTE format('SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM %s', v_sequence) INTO v_next;
    IF v_next <= (SELECT COALESCE(max(id), 0) FROM public.auto_status_event_rules) THEN
      RAISE EXCEPTION 'zalo_message_status_catalog_identity_sequence_behind_max_id';
    END IF;
  END IF;
END
$preflight$;

-- 1. Bật hai trạng thái còn tắt. Câu "Chưa bật: ..." trong phần mô tả (do V494 viết) được thay bằng câu đánh dấu; mô tả
--    không có câu đó thì câu đánh dấu được nối vào cuối. Chỉ dòng đang tắt mới bị sửa.
UPDATE public.auto_status s
SET is_active = true,
    description = CASE
      WHEN s.description LIKE '%Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).%'
        THEN replace(s.description, 'Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).',
                     'Do đồng bộ trạng thái tin nhắn Zalo ghi (quy tắc zalo.* trong auto_status_event_rules).')
      ELSE btrim(concat_ws(' ', NULLIF(btrim(s.description), ''),
                           'Do đồng bộ trạng thái tin nhắn Zalo ghi (quy tắc zalo.* trong auto_status_event_rules).'))
    END,
    updated_at = now()
WHERE s.code IN ('campaign_detail_reacted', 'campaign_detail_replied') AND s.component_type = 'campaign_detail'
  AND NOT s.is_delete AND NOT s.is_active;

-- 2. Quy tắc "sự kiện → trạng thái" cho bốn bậc. Quy tắc "đã nhận" được thêm ở trạng thái tắt (xem phần đầu file).
INSERT INTO public.auto_status_event_rules (event_kind, action_code, status_id, description, is_active)
SELECT v.event_kind, NULL, s.id, v.description, v.is_active
FROM (VALUES
  ('zalo.delivered', 'campaign_detail_received', 'Zalo: tin đã tới máy người nhận (đồng bộ trạng thái tin nhắn Zalo). Đang tắt theo quyết định 13/11/2026: chưa đưa "Đã nhận" vào cột trạng thái.', false, 1),
  ('zalo.seen', 'campaign_detail_viewed', 'Zalo: người nhận đã xem tin (đồng bộ trạng thái tin nhắn Zalo)', true, 2),
  ('zalo.reaction', 'campaign_detail_reacted', 'Zalo: người nhận thả cảm xúc vào tin (đồng bộ trạng thái tin nhắn Zalo)', true, 3),
  ('zalo.reply', 'campaign_detail_replied', 'Zalo: người nhận nhắn lại trong hạn tính phản hồi (đồng bộ trạng thái tin nhắn Zalo)', true, 4)
) AS v(event_kind, code, description, is_active, ord)
JOIN public.auto_status s ON s.code = v.code AND s.component_type = 'campaign_detail' AND NOT s.is_delete
ORDER BY v.ord;

COMMIT;
