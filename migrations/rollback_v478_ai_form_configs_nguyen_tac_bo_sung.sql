-- Rollback V478 (Nguyên tắc bổ sung). Hai mức, chạy riêng từng khối khi cần.
--
-- Mức 1 — tắt nhanh, không DDL (khuyến nghị): xoá nội dung nguyên tắc của mọi phần. API Web không thêm gì vào prompt,
-- AI chạy như trước V478. Trigger ai_form_configs_validate đặt lại updated_at các dòng bị xoá nội dung.
-- Trước khi chạy, chép nội dung đang có ra biên nhận để khôi phục được:
--   SELECT id, code, nguyen_tac_bo_sung FROM public.ai_form_configs WHERE nguyen_tac_bo_sung IS NOT NULL ORDER BY id;
BEGIN;
SET LOCAL lock_timeout = '3s';
UPDATE public.ai_form_configs SET nguyen_tac_bo_sung = NULL WHERE nguyen_tac_bo_sung IS NOT NULL;
COMMIT;

-- Mức 2 — bỏ hẳn cột (DDL, PostgREST nạp lại schema; apply ngoài giờ cao điểm). Chỉ chạy khi đã chép nội dung ra
-- biên nhận và người dùng yêu cầu rõ. API Web chịu được thiếu cột: AI form không thêm nguyên tắc, trang admin báo
-- "Chưa sẵn sàng". Desktop không đọc cột này.
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- ALTER TABLE public.ai_form_configs DROP COLUMN nguyen_tac_bo_sung;
-- COMMIT;
