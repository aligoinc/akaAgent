-- V582: đổi câu lỗi "Không tìm thấy user access token…" của ba block lấy token từ trang Facebook Business thành câu hướng dẫn khách
-- nhập mã xác minh qua mục menu chuột phải "Kiểm tra nhập mã xác minh Fanpage" của tài khoản: block 2636 fb_scan_pages_graph (quét danh sách Page),
-- 2669 fb_page_post_api và 2878 "[engine] fb_page_post_api" (đăng bài fanpage). Chỉ thay đúng một chuỗi trong code mỗi block, cách lấy
-- token và điều kiện báo lỗi giữ nguyên; kèm md5 đã duyệt của danh mục bước 18 và sổ chép block 2878. SINH TỪ scripts/build-v582-sql.cjs
-- (nguồn kiểm: scripts/fixtures/facebook-business-token/v582-live-20261119.json), không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại
-- schema PostgREST). Mọi bản app đọc code block từ DB mỗi lượt nên câu mới hiện ngay cho cả bản chưa có mục menu: chỉ apply sau khi
-- bản Desktop có mục menu đã phát hành. Gỡ: rollback_v582_facebook_business_token_message.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v582_%') THEN
      RAISE EXCEPTION 'V582 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2636 AND name = $v582$fb_scan_pages_graph$v582$ AND md5(code) = '1377132a1e0baa4ae0ac7d6d681b931e') THEN
    RAISE EXCEPTION 'V582: block 2636 khác bản đã đọc (md5 1377132a1e0baa4ae0ac7d6d681b931e), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2669 AND name = $v582$fb_page_post_api$v582$ AND md5(code) = '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'V582: block 2669 khác bản đã đọc (md5 21136df214634903530caa9d40c3eefb), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2878 AND name = $v582$[engine] fb_page_post_api$v582$ AND md5(code) = '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'V582: block 2878 khác bản đã đọc (md5 21136df214634903530caa9d40c3eefb), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2878 AND source_block_id = 2669
                   AND source_md5_at_copy = '21136df214634903530caa9d40c3eefb' AND engine_md5_at_copy = '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'V582: sổ chép block 2878 khác bản đã đọc';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2878;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V582: block 2878 có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 18 AND block_id = 2878
                   AND reviewed_code_md5 = '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'V582: dòng danh mục bước 18 của block 2878 khác bản đã đọc';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = replace(code, $v582$Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử tải page.$v582$, $v582$Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi tải page lại.$v582$), updated_at = now()
 WHERE id = 2636 AND md5(code) = '1377132a1e0baa4ae0ac7d6d681b931e';
UPDATE public.auto_blocks SET code = replace(code, $v582$Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.$v582$, $v582$Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi chạy lại chiến dịch.$v582$), updated_at = now()
 WHERE id = 2669 AND md5(code) = '21136df214634903530caa9d40c3eefb';
UPDATE public.auto_blocks SET code = replace(code, $v582$Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.$v582$, $v582$Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi chạy lại chiến dịch.$v582$), updated_at = now()
 WHERE id = 2878 AND md5(code) = '21136df214634903530caa9d40c3eefb';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = 'e8e2097457b5ca0fe6c6a21ab25c8c87', updated_at = now()
 WHERE id = 18 AND block_id = 2878 AND reviewed_code_md5 = '21136df214634903530caa9d40c3eefb';
UPDATE public.auto_engine_block_copies SET source_md5_at_copy = 'e8e2097457b5ca0fe6c6a21ab25c8c87', engine_md5_at_copy = 'e8e2097457b5ca0fe6c6a21ab25c8c87'
 WHERE engine_block_id = 2878 AND source_block_id = 2669;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2636 AND md5(code) = '51a8e18d7952df3a22820267799beb73') THEN
    RAISE EXCEPTION 'V582 postflight: code block 2636 không ra đúng bản mong đợi (md5 51a8e18d7952df3a22820267799beb73)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2669 AND md5(code) = 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'V582 postflight: code block 2669 không ra đúng bản mong đợi (md5 e8e2097457b5ca0fe6c6a21ab25c8c87)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2878 AND md5(code) = 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'V582 postflight: code block 2878 không ra đúng bản mong đợi (md5 e8e2097457b5ca0fe6c6a21ab25c8c87)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2878 AND reviewed_code_md5 IS DISTINCT FROM 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'V582 postflight: danh mục bước của block 2878 chưa ghi md5 mong đợi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2878
                   AND source_md5_at_copy = 'e8e2097457b5ca0fe6c6a21ab25c8c87' AND engine_md5_at_copy = 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'V582 postflight: sổ chép block 2878 chưa ghi md5 mong đợi';
  END IF;
END $post$;

COMMIT;
