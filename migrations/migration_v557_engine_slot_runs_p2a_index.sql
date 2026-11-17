-- V557 phần 2a: mỗi chiến dịch tối đa một lượt theo lịch đang mở. Chạy RIÊNG lệnh này (CONCURRENTLY không chạy trong giao dịch), sau
-- phần 1. Chỉ mục một phần: lúc dựng chưa có dòng nào khớp (slot_at chỉ có từ V558), không khoá ghi của engine Zalo.
-- Lỗi giữa chừng để lại chỉ mục INVALID: DROP INDEX CONCURRENTLY rồi chạy lại.
CREATE UNIQUE INDEX CONCURRENTLY auto_engine_target_runs_slot_open_v557
  ON public.auto_engine_target_runs (campaign_id) WHERE slot_at IS NOT NULL AND completed_at IS NULL;
