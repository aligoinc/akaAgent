-- Gỡ V595 (DOM cả trang kèm ảnh lỗi engine Facebook). Xoá luôn mọi DOM máy khách đã gửi. Desktop bản mới gặp DB không có hàm gửi DOM thì chỉ
-- gửi ảnh như trước V595. Dòng sổ migration của V595 giữ nguyên (không apply lại V595 sau khi gỡ; muốn bật lại thì viết migration mới).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DROP FUNCTION IF EXISTS public.aka_agent_desktop_diagnostic_doms_v1(bigint);
DROP FUNCTION IF EXISTS public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text);
DROP TABLE IF EXISTS public.auto_desktop_diagnostic_doms;
COMMIT;
