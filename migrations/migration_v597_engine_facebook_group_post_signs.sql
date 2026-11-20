-- migration_v597_engine_facebook_group_post_signs: đăng nhóm hết giờ chờ mà hộp Tạo bài viết chưa đóng (FB42 "Form đăng bài chưa đóng") thì nhận ba trường hợp Facebook ghi lý do bằng
-- chữ đỏ trong hộp. Anh chốt 20/11/2026 (câu 585 của hộp thư lỗi; docs/ENGINE_V2_FACEBOOK_GROUP_POST_SIGNS_V597.md). Sinh bằng
-- scripts/build-v597-sql.cjs (nguồn kiểm scripts/fixtures/engine-v2-facebook/v597-live-20261120.json), không sửa tay. Chỉ dữ liệu, không DDL
-- (không nạp lại schema PostgREST).
--   * Ba element mới ở auto_elements (GroupPostRequestFailedNotice, GroupPostUploadFailedNotice, GroupPostAccountAccessLimitedNotice), sửa XPath ở màn Element khi Facebook đổi chữ.
--   * Bản "[engine]" của block chờ form đăng nhóm đóng (2871; bộ cũ 2624 không đổi): hết giờ thì dò ba chữ đó, thấy thì trả câu riêng.
--   * Ba dấu hiệu "message" ở facebook.error_signs đổi câu đó ra mã mới (dòng lịch sử đăng nhóm không mã).
--   * FB48 "Facebook báo gặp sự cố khi đăng bài": như FB42 hôm nay (ghi thất bại, tính lượt, cộng chuỗi, data đóng).
--   * FB49 "Facebook không tải được ảnh hoặc video lên": ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi.
--   * FB50 "Facebook đang giới hạn quyền truy cập của tài khoản": ghi thất bại, tạm dừng chiến dịch ngay, data về hàng đợi, không tính lượt, không cộng chuỗi.
-- Không thấy chữ nào thì vẫn FB42. Vòng quay "Đang đăng" chưa làm (anh chốt chờ DOM). Gỡ: rollback_v597_engine_facebook_group_post_signs.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v597_%') THEN
      RAISE EXCEPTION 'V597: sổ migration đã có migration_v597_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND name = '[engine] fb_verify_group_post_form_closed' AND md5(code) = 'e433ac1a58ac08535c53010fdc5e9ba7') THEN
    RAISE EXCEPTION 'V597: block 2871 khác bản đã đọc (md5 e433ac1a58ac08535c53010fdc5e9ba7), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2871 AND source_block_id = 2624) THEN
    RAISE EXCEPTION 'V597: thiếu sổ chép block 2871';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2871;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V597: block 2871 có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 4 AND block_id = 2871 AND commit_level = 1
                   AND send_ops = '[]'::jsonb AND reviewed_code_md5 = 'e433ac1a58ac08535c53010fdc5e9ba7') THEN
    RAISE EXCEPTION 'V597: dòng danh mục bước 4 khác bản đã đọc';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'aa197aea7d2dc397545a8f8e5a8a5a5c' THEN
    RAISE EXCEPTION 'V597: dòng facebook.error_signs đã đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('GroupPostRequestFailedNotice', 'GroupPostUploadFailedNotice', 'GroupPostAccountAccessLimitedNotice')) THEN
    RAISE EXCEPTION 'V597: đã có element mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitError')
     OR NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostSubmitButtonAfterClick') THEN
    RAISE EXCEPTION 'V597: thiếu element block 2871 đang dùng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_engine_fb_action_failed' AND public_code = 'FB42' AND is_active AND NOT is_delete
                   AND error_class = 'target_permanent') THEN
    RAISE EXCEPTION 'V597: mã FB42 khác bản đã đọc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN ('err_fb_group_post_request_failed', 'err_fb_group_post_upload_failed', 'err_fb_account_access_limited') OR public_code IN ('FB48', 'FB49', 'FB50')) THEN
    RAISE EXCEPTION 'V597: đã có mã FB48 / FB49 / FB50';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v597' OR error_code IN ('err_fb_group_post_request_failed', 'err_fb_group_post_upload_failed', 'err_fb_account_access_limited')) THEN
    RAISE EXCEPTION 'V597: đã có chính sách nguồn v597 hoặc của mã mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE id = 21 AND code = 'campaign_detail_failed' AND status_value = 'thất bại') THEN
    RAISE EXCEPTION 'V597: trạng thái 21 không phải "thất bại"';
  END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
  ('GroupPostRequestFailedNotice', '//*[@role=''dialog'' or self::form]//text()[contains(., ''gặp sự cố khi hoàn tất yêu cầu'')][not(ancestor::*[@contenteditable=''true''])]/..', 'V597: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi không hoàn tất được yêu cầu đăng bài (FB48). Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL),
  ('GroupPostUploadFailedNotice', '//*[@role=''dialog'' or self::form]//text()[contains(., ''Không thể tải file của bạn lên'')][not(ancestor::*[@contenteditable=''true''])]/..', 'V597: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi không tải được tệp của bài lên (FB49). Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL),
  ('GroupPostAccountAccessLimitedNotice', '//*[@role=''dialog'' or self::form]//text()[contains(., ''tài khoản của bạn đã giới hạn quyền truy cập'')][not(ancestor::*[@contenteditable=''true''])]/..', 'V597: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi tài khoản bị giới hạn quyền truy cập vì lý do bảo mật (FB50). Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL);

UPDATE public.auto_blocks SET code = replace(code, $v597$const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
$v597$, $v597$const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
const requestFailedNotice = await helpers.element('GroupPostRequestFailedNotice');
const uploadFailedNotice = await helpers.element('GroupPostUploadFailedNotice');
const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
$v597$), updated_at = now()
 WHERE id = 2871 AND strpos(code, $v597$const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
const requestFailedNotice = await helpers.element('GroupPostRequestFailedNotice');
const uploadFailedNotice = await helpers.element('GroupPostUploadFailedNotice');
const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
$v597$) = 0;
UPDATE public.auto_blocks SET code = replace(code, $v597$  message = 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây';
}
$v597$, $v597$  // V597: Facebook ghi lý do bằng chữ đỏ trong hộp Tạo bài viết. Nhận theo chữ có mặt (element ở auto_elements), không thấy thì như cũ.
  if (await hasVisibleElement(accountAccessLimitedNotice)) {
    message = 'Facebook đang giới hạn quyền truy cập của tài khoản';
  } else if (await hasVisibleElement(uploadFailedNotice)) {
    message = 'Facebook không tải được ảnh hoặc video lên';
  } else if (await hasVisibleElement(requestFailedNotice)) {
    message = 'Facebook báo gặp sự cố khi đăng bài';
  } else {
    message = 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây';
  }
}
$v597$), updated_at = now()
 WHERE id = 2871 AND strpos(code, $v597$  // V597: Facebook ghi lý do bằng chữ đỏ trong hộp Tạo bài viết. Nhận theo chữ có mặt (element ở auto_elements), không thấy thì như cũ.
  if (await hasVisibleElement(accountAccessLimitedNotice)) {
    message = 'Facebook đang giới hạn quyền truy cập của tài khoản';
  } else if (await hasVisibleElement(uploadFailedNotice)) {
    message = 'Facebook không tải được ảnh hoặc video lên';
  } else if (await hasVisibleElement(requestFailedNotice)) {
    message = 'Facebook báo gặp sự cố khi đăng bài';
  } else {
    message = 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây';
  }
}
$v597$) = 0;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = 'f981cac703a91dc6c9f8a49176a61bba', updated_at = now()
 WHERE id = 4 AND block_id = 2871 AND reviewed_code_md5 = 'e433ac1a58ac08535c53010fdc5e9ba7';

UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_identity_required","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"]},{"code":"err_fb_page_inbox_cannot_reply_blocked_by_user","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Page không gửi được tin cho người này nữa"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]},{"code":"err_fb_group_post_request_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook báo gặp sự cố khi đăng bài"]},{"code":"err_fb_group_post_upload_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook không tải được ảnh hoặc video lên"]},{"code":"err_fb_account_access_limited","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook đang giới hạn quyền truy cập của tài khoản"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = 'aa197aea7d2dc397545a8f8e5a8a5a5c';

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
  ('engine v2', 'err_fb_group_post_request_failed', 'Facebook báo gặp sự cố khi đăng bài', 'V597 (engine v2): Đăng nhóm: hộp Tạo bài viết chưa đóng và Facebook ghi "Chúng tôi gặp sự cố khi hoàn tất yêu cầu của bạn".', NULL, NULL, '{}', false, false, 'fixed_minutes',
   '{}', '{}', true, false, 'FB48', 'target_permanent', 'Facebook báo gặp sự cố khi đăng bài', NULL),
  ('engine v2', 'err_fb_group_post_upload_failed', 'Facebook không tải được ảnh hoặc video lên', 'V597 (engine v2): Đăng nhóm: hộp Tạo bài viết chưa đóng và Facebook ghi "Không thể tải file của bạn lên".', NULL, NULL, '{}', false, false, 'fixed_minutes',
   '{}', '{}', true, false, 'FB49', 'transient', 'Facebook không tải được ảnh hoặc video lên', NULL),
  ('engine v2', 'err_fb_account_access_limited', 'Facebook đang giới hạn quyền truy cập của tài khoản', 'V597 (engine v2): Đăng nhóm: hộp Tạo bài viết chưa đóng và Facebook ghi "Vì lý do bảo mật, tài khoản của bạn đã giới hạn quyền truy cập".', NULL, NULL, '{}', false, false, 'fixed_minutes',
   '{}', '{}', true, false, 'FB50', 'account_restricted', 'Facebook đang giới hạn quyền truy cập của tài khoản', NULL);

INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode, campaign_effect, account_effect, login_effect, description, source) VALUES
  ('err_fb_group_post_request_failed', 'fb_post_group', NULL, 21, 'inherit', '{message}', NULL, 'count', 'increment', NULL, 'complete', 'continue', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', '[anh chốt 20/11, câu 585] FB48 đăng nhóm: Facebook ghi gặp sự cố khi hoàn tất yêu cầu; xử lý như FB42 hôm nay (ghi thất bại, tính lượt, cộng chuỗi, data đóng).', 'v597'),
  ('err_fb_group_post_upload_failed', 'fb_post_group', NULL, 21, 'write', '{message}', NULL, 'no_count', 'increment', NULL, 'requeue', 'skip', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', '[anh chốt 20/11, câu 585] FB49 đăng nhóm: Facebook không tải được tệp lên (nút Đăng xám, bài chưa gửi); ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi.', 'v597'),
  ('err_fb_account_access_limited', 'fb_post_group', NULL, 21, 'write', '{message}', 'Facebook đang giới hạn quyền truy cập của tài khoản (FB50).', 'no_count', 'ignore', NULL, 'requeue', 'skip', ARRAY[]::text[], 'fixed_minutes', 'end_unit', 'none', 'pause', 'none', 'none', '[anh chốt 20/11, câu 585] FB50 đăng nhóm: Facebook giới hạn quyền truy cập của tài khoản; ghi thất bại, tạm dừng chiến dịch ngay, data về hàng đợi, không tính lượt, không cộng chuỗi.', 'v597');

DO $post$
DECLARE v_p jsonb; v_text text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND md5(code) = 'f981cac703a91dc6c9f8a49176a61bba') THEN
    RAISE EXCEPTION 'V597 postflight: code block 2871 không ra đúng bản mong đợi (md5 f981cac703a91dc6c9f8a49176a61bba)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2624 AND md5(code) = 'e433ac1a58ac08535c53010fdc5e9ba7') THEN
    RAISE EXCEPTION 'V597 postflight: block bộ cũ 2624 bị đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2871 AND reviewed_code_md5 IS DISTINCT FROM 'f981cac703a91dc6c9f8a49176a61bba') THEN
    RAISE EXCEPTION 'V597 postflight: danh mục bước của block 2871 chưa ghi md5 mới';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'dc7fd786e225a7ca05c4a3cfa49852d7' THEN
    RAISE EXCEPTION 'V597 postflight: dòng facebook.error_signs';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (('GroupPostRequestFailedNotice', '//*[@role=''dialog'' or self::form]//text()[contains(., ''gặp sự cố khi hoàn tất yêu cầu'')][not(ancestor::*[@contenteditable=''true''])]/..'), ('GroupPostUploadFailedNotice', '//*[@role=''dialog'' or self::form]//text()[contains(., ''Không thể tải file của bạn lên'')][not(ancestor::*[@contenteditable=''true''])]/..'), ('GroupPostAccountAccessLimitedNotice', '//*[@role=''dialog'' or self::form]//text()[contains(., ''tài khoản của bạn đã giới hạn quyền truy cập'')][not(ancestor::*[@contenteditable=''true''])]/..'));
  IF v_n <> 3 THEN RAISE EXCEPTION 'V597 postflight: % element mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = 'v597' AND is_active AND NOT is_delete;
  IF v_n <> 3 THEN RAISE EXCEPTION 'V597 postflight: % dòng chính sách mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_error WHERE is_active AND NOT is_delete AND (error_code, public_code, error_class, customer_title) IN (
    ('err_fb_group_post_request_failed', 'FB48', 'target_permanent', 'Facebook báo gặp sự cố khi đăng bài'),
    ('err_fb_group_post_upload_failed', 'FB49', 'transient', 'Facebook không tải được ảnh hoặc video lên'),
    ('err_fb_account_access_limited', 'FB50', 'account_restricted', 'Facebook đang giới hạn quyền truy cập của tài khoản')) AND customer_help IS NULL;
  IF v_n <> 3 THEN RAISE EXCEPTION 'V597 postflight: % mã mới đúng câu', v_n; END IF;

  IF (public.aka_agent_engine_resolve_policy('err_fb_group_post_request_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions') IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions') THEN
    RAISE EXCEPTION 'V597 postflight: chính sách FB48 (%) khác FB42: % / %', 'before_send', public.aka_agent_engine_resolve_policy('err_fb_group_post_request_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions', public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions';
  END IF;
  IF (public.aka_agent_engine_resolve_policy('err_fb_group_post_request_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions') IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions') THEN
    RAISE EXCEPTION 'V597 postflight: chính sách FB48 (%) khác FB42: % / %', 'in_flight', public.aka_agent_engine_resolve_policy('err_fb_group_post_request_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions', public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions';
  END IF;
  IF (public.aka_agent_engine_resolve_policy('err_fb_group_post_request_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions') IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions') THEN
    RAISE EXCEPTION 'V597 postflight: chính sách FB48 (%) khác FB42: % / %', 'after_send', public.aka_agent_engine_resolve_policy('err_fb_group_post_request_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions', public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions';
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'transient' THEN
    RAISE EXCEPTION 'V597 postflight: chính sách % (%) ra %', 'err_fb_group_post_upload_failed', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'transient' THEN
    RAISE EXCEPTION 'V597 postflight: chính sách % (%) ra %', 'err_fb_group_post_upload_failed', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'transient' THEN
    RAISE EXCEPTION 'V597 postflight: chính sách % (%) ra %', 'err_fb_group_post_upload_failed', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_account_access_limited', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook đang giới hạn quyền truy cập của tài khoản (FB50).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'account_restricted' THEN
    RAISE EXCEPTION 'V597 postflight: chính sách % (%) ra %', 'err_fb_account_access_limited', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_account_access_limited', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook đang giới hạn quyền truy cập của tài khoản (FB50).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'account_restricted' THEN
    RAISE EXCEPTION 'V597 postflight: chính sách % (%) ra %', 'err_fb_account_access_limited', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_account_access_limited', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook đang giới hạn quyền truy cập của tài khoản (FB50).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'account_restricted' THEN
    RAISE EXCEPTION 'V597 postflight: chính sách % (%) ra %', 'err_fb_account_access_limited', 'after_send', v_p;
  END IF;

  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'after_send', '{"kind":"block","code":"err_fb_group_post_request_failed","errorCode":"err_fb_group_post_request_failed","message":"Đăng bài thất bại vào Nhóm A: Facebook báo gặp sự cố khi đăng bài"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_group_post_request_failed' THEN RAISE EXCEPTION 'V597 postflight: tín hiệu % ra %', 'err_fb_group_post_request_failed', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'after_send', '{"kind":"block","code":"err_fb_group_post_upload_failed","errorCode":"err_fb_group_post_upload_failed","message":"Đăng bài thất bại vào Nhóm A: Facebook không tải được ảnh hoặc video lên"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_group_post_upload_failed' THEN RAISE EXCEPTION 'V597 postflight: tín hiệu % ra %', 'err_fb_group_post_upload_failed', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'after_send', '{"kind":"block","code":"err_fb_account_access_limited","errorCode":"err_fb_account_access_limited","message":"Đăng bài thất bại vào Nhóm A: Facebook đang giới hạn quyền truy cập của tài khoản"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_account_access_limited' THEN RAISE EXCEPTION 'V597 postflight: tín hiệu % ra %', 'err_fb_account_access_limited', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'after_send', '{"kind":"block","code":"status:campaign_detail_failed","message":"Đăng bài thất bại vào Nhóm A: Form đăng bài chưa đóng sau 60 giây"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_engine_fb_action_failed' THEN RAISE EXCEPTION 'V597 postflight: tín hiệu % ra %', 'err_engine_fb_action_failed', v_text; END IF;
END $post$;

COMMIT;
