-- migration_v673_engine_facebook_group_post_frequency_early: đăng nhóm bị Facebook giới hạn tần suất thì block chờ form đóng báo FB02 ngay khi thấy chữ trong hộp Tạo bài viết,
-- không chờ hết 60 / 180 giây. Anh chốt 27/11/2026 (câu 9004 của hộp thư lỗi; docs/ENGINE_V2_FACEBOOK_GROUP_POST_FREQUENCY_EARLY_V673.md). Sinh
-- bằng scripts/build-v673-sql.cjs (nguồn kiểm scripts/fixtures/engine-v2-facebook/v673-live-20261127.json), không sửa tay. Chỉ dữ liệu, không
-- DDL (không nạp lại schema PostgREST).
--   * Element mới GroupPostFrequencyLimitNotice: chữ "giới hạn tần suất bạn đăng bài" trong hộp thoại / form, ngoài ô soạn.
--   * Bản "[engine]" của block chờ form đăng nhóm đóng (2871; bộ cũ 2624 không đổi): form còn mở mà thấy element đó 2 vòng
--     liền (vòng 500 ms) thì ném câu "Facebook báo giới hạn tần suất bạn đăng bài" như nhánh hết giờ (luật 116 → FB02, chính sách không đổi).
--   * Nhánh hết giờ giữ nguyên (element 1710 cả trang, ba chữ đỏ V597).
-- Gỡ: rollback_v673_engine_facebook_group_post_frequency_early.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v673_%') THEN
      RAISE EXCEPTION 'V673: sổ migration đã có migration_v673_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND name = '[engine] fb_verify_group_post_form_closed' AND md5(code) = 'f981cac703a91dc6c9f8a49176a61bba') THEN
    RAISE EXCEPTION 'V673: block 2871 khác bản đã đọc (md5 f981cac703a91dc6c9f8a49176a61bba), đọc lại và sinh lại';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2871;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V673: block 2871 có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 4 AND block_id = 2871 AND commit_level = 1
                   AND reviewed_code_md5 = 'f981cac703a91dc6c9f8a49176a61bba') THEN
    RAISE EXCEPTION 'V673: dòng danh mục bước 4 khác bản đã đọc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitNotice') THEN
    RAISE EXCEPTION 'V673: đã có element GroupPostFrequencyLimitNotice';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitError')
     OR NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostSubmitButtonAfterClick') THEN
    RAISE EXCEPTION 'V673: thiếu element block 2871 đang dùng';
  END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
  ('GroupPostFrequencyLimitNotice', '//*[@role=''dialog'' or self::form]//text()[contains(., ''giới hạn tần suất bạn đăng bài'')][not(ancestor::*[@contenteditable=''true''])]/..', 'V673: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi giới hạn tần suất đăng bài (FB02); block 2871 dò trong lúc chờ form đóng. Chỉ trong hộp, bỏ ô soạn; GroupPostFrequencyLimitError (cả trang) vẫn dùng khi hết giờ. Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL);

UPDATE public.auto_blocks SET code = replace(code, $v673$const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
$v673$, $v673$const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
const frequencyLimitNotice = await helpers.element('GroupPostFrequencyLimitNotice');
$v673$), updated_at = now()
 WHERE id = 2871 AND strpos(code, $v673$const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
const frequencyLimitNotice = await helpers.element('GroupPostFrequencyLimitNotice');
$v673$) = 0;
UPDATE public.auto_blocks SET code = replace(code, $v673$let message = '';
$v673$, $v673$let message = '';
let frequencyLimitSeen = 0;
$v673$), updated_at = now()
 WHERE id = 2871 AND strpos(code, $v673$let message = '';
let frequencyLimitSeen = 0;
$v673$) = 0;
UPDATE public.auto_blocks SET code = replace(code, $v673$    break;
  }
  const remainingMs = publishTimeoutMs - (Date.now() - publishStarted);
$v673$, $v673$    break;
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
$v673$), updated_at = now()
 WHERE id = 2871 AND strpos(code, $v673$    break;
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
$v673$) = 0;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '2ce23f2d9453593e9527065ba5a9b4c5', updated_at = now()
 WHERE id = 4 AND block_id = 2871 AND reviewed_code_md5 = 'f981cac703a91dc6c9f8a49176a61bba';

DO $post$
DECLARE v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND md5(code) = '2ce23f2d9453593e9527065ba5a9b4c5') THEN
    RAISE EXCEPTION 'V673 postflight: code block 2871 không ra đúng bản mong đợi (md5 2ce23f2d9453593e9527065ba5a9b4c5)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2624 AND md5(code) = 'e433ac1a58ac08535c53010fdc5e9ba7') THEN
    RAISE EXCEPTION 'V673 postflight: block bộ cũ 2624 bị đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2871 AND reviewed_code_md5 IS DISTINCT FROM '2ce23f2d9453593e9527065ba5a9b4c5') THEN
    RAISE EXCEPTION 'V673 postflight: danh mục bước của block 2871 chưa ghi md5 mới';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitNotice' AND xpath = '//*[@role=''dialog'' or self::form]//text()[contains(., ''giới hạn tần suất bạn đăng bài'')][not(ancestor::*[@contenteditable=''true''])]/..';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V673 postflight: % element mới', v_n; END IF;
END $post$;

COMMIT;
