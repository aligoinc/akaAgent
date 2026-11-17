-- V557 phần 2b: tra lượt theo (chiến dịch, mốc lịch) để claim không nhận lại mốc đã chạy. Chạy RIÊNG lệnh này (CONCURRENTLY không chạy
-- trong giao dịch), sau phần 1. Lỗi giữa chừng để lại chỉ mục INVALID: DROP INDEX CONCURRENTLY rồi chạy lại.
CREATE INDEX CONCURRENTLY auto_engine_target_runs_slot_v557
  ON public.auto_engine_target_runs (campaign_id, slot_at) WHERE slot_at IS NOT NULL;
