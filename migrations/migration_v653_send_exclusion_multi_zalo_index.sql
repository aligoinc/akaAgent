-- V653 chỉ mục: tra Zalo ID riêng của một khách ở một Zalo từ Zalo ID chung (global_id), dùng cho loại trừ gửi theo
-- nhiều Zalo (khối của Zalo khác, danh sách bạn bè/Zalo ID của Zalo khác, Nhóm data Zalo UID, chiến dịch đã gửi).
-- zalo_users ~5,7 triệu dòng (25/11/2026); chỉ mục (account_id, zalo_uid) hiện có 392 MB, chỉ mục này ước ~400 MB.
-- CHỈ một lệnh, ngoài giao dịch (CONCURRENTLY không chạy được trong BEGIN/COMMIT, cũng không chạy qua apply_migration).
-- Chạy riêng bằng `supabase db query --linked -f <file>` hoặc SQL Editor, ngoài giờ cao điểm. Không làm PostgREST nạp lại schema.
-- Lệnh bị ngắt giữa chừng để lại chỉ mục INVALID: DROP INDEX CONCURRENTLY public.idx_zalo_users_account_global_id rồi chạy lại.
-- Gỡ: DROP INDEX CONCURRENTLY public.idx_zalo_users_account_global_id;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_zalo_users_account_global_id ON public.zalo_users (account_id, global_id)
  WHERE global_id IS NOT NULL AND global_id <> '';
