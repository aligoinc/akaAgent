-- Rollback V531: thu lại quyền INSERT cột content_rotation_indexes của aka_agent_desktop.
-- Dòng data đã ghi chỉ số vẫn giữ nguyên (RPC V350 vẫn đọc). Desktop có bản sửa gặp 42501 thì tự chèn lại không có cột,
-- tức quay về cách chọn câu cũ (con trỏ của từng chiến dịch up tin).
BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE INSERT (content_rotation_indexes) ON public.auto_campaign_input_data FROM aka_agent_desktop;

DO $postflight$
BEGIN
  IF has_column_privilege('aka_agent_desktop', 'public.auto_campaign_input_data', 'content_rotation_indexes', 'INSERT') THEN
    RAISE EXCEPTION 'rollback_v531_desktop_still_can_insert_rotation';
  END IF;
  IF NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaign_input_data', 'uid', 'INSERT') THEN
    RAISE EXCEPTION 'rollback_v531_desktop_lost_other_insert_columns';
  END IF;
END
$postflight$;

COMMIT;
