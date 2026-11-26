-- Gỡ migration_v673_engine_facebook_group_post_frequency_early: trả block 2871 và dòng danh mục bước 4 về bản trước V673 (bản V597), rồi xoá element GroupPostFrequencyLimitNotice (block không
-- còn đọc). Chỉ chạy khi block đang đúng bản V673 (đã ai sửa sau V673 thì dừng, không ghi đè). Sinh bằng scripts/build-v673-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND md5(code) = '2ce23f2d9453593e9527065ba5a9b4c5') THEN
    RAISE EXCEPTION 'Gỡ V673: block 2871 khác bản V673 (md5 2ce23f2d9453593e9527065ba5a9b4c5)';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = replace(code, $v673$    break;
  }
  // V673: chữ giới hạn tần suất trong hộp Tạo bài viết là Facebook đã từ chối bài (nút Đăng vẫn bấm được, không còn "Đang đăng"; ảnh + DOM
  // yêu cầu 44 / 45 ngày 27/11). Thấy 2 vòng liền thì báo ngay như khi hết giờ, không chờ đủ 60 / 180 giây.
  frequencyLimitSeen = await hasVisibleElement(frequencyLimitNotice) ? frequencyLimitSeen + 1 : 0;
  if (frequencyLimitSeen >= 2) {
    message = 'Facebook báo giới hạn tần suất bạn đăng bài';
    vars.groupPostSubmitted = false;
    vars.groupPostFrequencyLimitError = true;
    helpers.log(message);
    throw new Error(message);
  }
  const remainingMs = publishTimeoutMs - (Date.now() - publishStarted);
$v673$, $v673$    break;
  }
  const remainingMs = publishTimeoutMs - (Date.now() - publishStarted);
$v673$), updated_at = now()
 WHERE id = 2871;
UPDATE public.auto_blocks SET code = replace(code, $v673$let message = '';
let frequencyLimitSeen = 0;
$v673$, $v673$let message = '';
$v673$), updated_at = now()
 WHERE id = 2871;
UPDATE public.auto_blocks SET code = replace(code, $v673$const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
const frequencyLimitNotice = await helpers.element('GroupPostFrequencyLimitNotice');
$v673$, $v673$const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
$v673$), updated_at = now()
 WHERE id = 2871;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = 'f981cac703a91dc6c9f8a49176a61bba', updated_at = now()
 WHERE id = 4 AND block_id = 2871 AND reviewed_code_md5 = '2ce23f2d9453593e9527065ba5a9b4c5';
DELETE FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitNotice';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND md5(code) = 'f981cac703a91dc6c9f8a49176a61bba')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2871 AND reviewed_code_md5 IS DISTINCT FROM 'f981cac703a91dc6c9f8a49176a61bba')
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitNotice') THEN
    RAISE EXCEPTION 'Gỡ V673: dữ liệu chưa về bản trước V673';
  END IF;
END $post$;

COMMIT;
