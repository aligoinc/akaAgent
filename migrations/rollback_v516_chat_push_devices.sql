-- Gỡ V516: xoá hai hàm public.aka_agent_chat_push_devices(bigint[]) và public.aka_agent_chat_push_device_result(bigint, text).
-- Không có dữ liệu nào. Chat API đang chạy nhận ra hai hàm đã mất ở lần gọi kế tiếp (lỗi "hàm không tồn tại" được coi
-- như chưa có, không làm hỏng lượt đẩy tới trình duyệt) và thôi đẩy tin nhắn ra iPhone; thông báo trên trang akaChat,
-- đẩy tới trình duyệt và Trung tâm thông báo không đổi.
-- Lệnh sửa schema: apply ngoài giờ cao điểm. Không xoá dòng trong sổ migration.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.aka_agent_chat_push_devices(bigint[]);
DROP FUNCTION IF EXISTS public.aka_agent_chat_push_device_result(bigint, text);
DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_chat_push_devices(bigint[])') IS NOT NULL
     OR to_regprocedure('public.aka_agent_chat_push_device_result(bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback V516 postflight: hàm vẫn còn';
  END IF;
END $post$;
COMMIT;
