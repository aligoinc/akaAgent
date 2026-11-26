-- Gỡ V669: trả hai dòng chính sách (120 / 802 × zalo_message_friend) của engine v2 về bản V500 (Q4) và tắt dòng auto_error của bộ
-- chạy cũ (không xoá: auto_campaign_details / bảng trạng thái lỗi có thể đã tham chiếu mã). Chỉ dữ liệu; lịch sử chính sách ghi lại.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.auto_outcome_policies
   WHERE error_code IN ('err_zalo_120_message_stranger', 'err_zalo_802_message_stranger') AND action_code = 'zalo_message_friend'
     AND status_id IS NULL AND error_class IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete
     AND target_effect = 'requeue_after' AND campaign_effect = 'none' AND run_effect = 'continue';
  IF n <> 2 THEN RAISE EXCEPTION 'Gỡ V669: chưa có V669 (thấy % dòng chính sách bản V669)', n; END IF;
END $pre$;

UPDATE public.auto_outcome_policies
   SET target_effect = 'requeue', requeue_after_minutes = NULL, target_streak_effect = 'increment', streak_threshold = 3,
       campaign_effect = 'pause', run_effect = NULL, log_template = NULL, campaign_note_template = NULL,
       description = CASE error_code WHEN 'err_zalo_120_message_stranger' THEN '[Q4] 120: hạn chế nhắn người lạ tới 09:45 hôm sau.'
                                     ELSE '[Q4] 802: như 120, khoá 2 ngày.' END
 WHERE error_code IN ('err_zalo_120_message_stranger', 'err_zalo_802_message_stranger') AND action_code = 'zalo_message_friend'
   AND status_id IS NULL AND error_class IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;

UPDATE public.auto_error SET is_active = false, updated_at = now()
 WHERE error_code = 'err_zalo_message_friend_stranger_restricted';

COMMIT;
