-- V674 p3: chỉ mục một phần cho job quét "Đặt ngày kết thúc". SINH TỪ scripts/build-v674-sql.cjs, không sửa tay.
-- MỘT lệnh, chạy riêng NGOÀI giao dịch (CREATE INDEX CONCURRENTLY không chạy được trong BEGIN … COMMIT, apply_migration hay file nhiều
-- lệnh). Chỉ chứa chiến dịch bật schedule_end_strict nên rất nhỏ. Không có chỉ mục này job vẫn đúng, chỉ là quét cả bảng mỗi phút.
-- Xong kiểm: SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_auto_campaigns_schedule_end_strict'::regclass;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auto_campaigns_schedule_end_strict ON public.auto_campaigns (schedule_end_date) WHERE schedule_end_strict;
