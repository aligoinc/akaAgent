-- Gỡ V582: trả câu lỗi cũ "Không tìm thấy user access token…" cho block 2636, 2669, 2878 cùng md5 đã duyệt của danh mục bước 18 và sổ chép
-- block 2878. Chỉ chạy khi cả ba block đang đúng bản V582 (đã ai sửa sau V582 thì dừng, không ghi đè). SINH TỪ scripts/build-v582-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2636 AND name = $v582$fb_scan_pages_graph$v582$ AND md5(code) = '51a8e18d7952df3a22820267799beb73') THEN
    RAISE EXCEPTION 'Gỡ V582: block 2636 khác bản đã đọc (md5 51a8e18d7952df3a22820267799beb73), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2669 AND name = $v582$fb_page_post_api$v582$ AND md5(code) = 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'Gỡ V582: block 2669 khác bản đã đọc (md5 e8e2097457b5ca0fe6c6a21ab25c8c87), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2878 AND name = $v582$[engine] fb_page_post_api$v582$ AND md5(code) = 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'Gỡ V582: block 2878 khác bản đã đọc (md5 e8e2097457b5ca0fe6c6a21ab25c8c87), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2878 AND source_block_id = 2669
                   AND source_md5_at_copy = 'e8e2097457b5ca0fe6c6a21ab25c8c87' AND engine_md5_at_copy = 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'Gỡ V582: sổ chép block 2878 khác bản đã đọc';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2878;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V582: block 2878 có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 18 AND block_id = 2878
                   AND reviewed_code_md5 = 'e8e2097457b5ca0fe6c6a21ab25c8c87') THEN
    RAISE EXCEPTION 'Gỡ V582: dòng danh mục bước 18 của block 2878 khác bản đã đọc';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = replace(code, $v582$Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi tải page lại.$v582$, $v582$Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử tải page.$v582$), updated_at = now()
 WHERE id = 2636 AND md5(code) = '51a8e18d7952df3a22820267799beb73';
UPDATE public.auto_blocks SET code = replace(code, $v582$Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi chạy lại chiến dịch.$v582$, $v582$Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.$v582$), updated_at = now()
 WHERE id = 2669 AND md5(code) = 'e8e2097457b5ca0fe6c6a21ab25c8c87';
UPDATE public.auto_blocks SET code = replace(code, $v582$Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi chạy lại chiến dịch.$v582$, $v582$Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.$v582$), updated_at = now()
 WHERE id = 2878 AND md5(code) = 'e8e2097457b5ca0fe6c6a21ab25c8c87';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '21136df214634903530caa9d40c3eefb', updated_at = now()
 WHERE id = 18 AND block_id = 2878 AND reviewed_code_md5 = 'e8e2097457b5ca0fe6c6a21ab25c8c87';
UPDATE public.auto_engine_block_copies SET source_md5_at_copy = '21136df214634903530caa9d40c3eefb', engine_md5_at_copy = '21136df214634903530caa9d40c3eefb'
 WHERE engine_block_id = 2878 AND source_block_id = 2669;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2636 AND md5(code) = '1377132a1e0baa4ae0ac7d6d681b931e') THEN
    RAISE EXCEPTION 'Gỡ V582 postflight: code block 2636 không ra đúng bản mong đợi (md5 1377132a1e0baa4ae0ac7d6d681b931e)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2669 AND md5(code) = '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'Gỡ V582 postflight: code block 2669 không ra đúng bản mong đợi (md5 21136df214634903530caa9d40c3eefb)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2878 AND md5(code) = '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'Gỡ V582 postflight: code block 2878 không ra đúng bản mong đợi (md5 21136df214634903530caa9d40c3eefb)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2878 AND reviewed_code_md5 IS DISTINCT FROM '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'Gỡ V582 postflight: danh mục bước của block 2878 chưa ghi md5 mong đợi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2878
                   AND source_md5_at_copy = '21136df214634903530caa9d40c3eefb' AND engine_md5_at_copy = '21136df214634903530caa9d40c3eefb') THEN
    RAISE EXCEPTION 'Gỡ V582 postflight: sổ chép block 2878 chưa ghi md5 mong đợi';
  END IF;
END $post$;

COMMIT;
