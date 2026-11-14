-- Gỡ "Lọc bạn bè Zalo / tạo nhóm khách hàng bằng Agent" (migration_data_group_friend_filter.sql): bỏ năm RPC và các hàm
-- private. GIỮ bảng public.auto_data_group_friend_filters: nhóm đã tạo vẫn là nhóm khách hàng bình thường, bộ lọc đã lưu
-- còn nguyên để áp lại sau. Không xoá hay sửa dữ liệu nào.
-- Sau khi gỡ: API trả 503 friend_filter_unavailable cho các route lọc bạn bè; trang Nhóm khách hàng vẫn chạy như cũ.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text);
DROP FUNCTION IF EXISTS public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint);
DROP FUNCTION IF EXISTS public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_get_data_group_friend_filter_v1(bigint,bigint,text,text,bigint);
DROP FUNCTION IF EXISTS private.zalo_friend_filter_rows_v1(bigint,bigint,jsonb,timestamp with time zone,boolean);
DROP FUNCTION IF EXISTS private.zalo_friend_filter_scope_v1(bigint,bigint,jsonb);
DROP FUNCTION IF EXISTS private.zalo_friend_filter_check_v1(jsonb,date);
DROP FUNCTION IF EXISTS private.zalo_friend_birthday_soon_v1(integer,date,integer);
DROP FUNCTION IF EXISTS private.zalo_friend_send_cutoff_v1(bigint,timestamp with time zone,timestamp with time zone,integer);
DROP FUNCTION IF EXISTS private.zalo_friend_tracking_since_v1(bigint,bigint,bigint);
DROP FUNCTION IF EXISTS private.zalo_friend_birthday_v1(text,bigint);
DROP FUNCTION IF EXISTS private.zalo_friend_period_v1(jsonb,date);
DROP FUNCTION IF EXISTS private.zalo_friend_json_date_v1(jsonb);
DROP FUNCTION IF EXISTS private.zalo_friend_json_int_v1(jsonb,bigint,bigint);
DROP FUNCTION IF EXISTS private.zalo_friend_json_keys_v1(jsonb,text[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
