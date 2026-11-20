-- Gỡ migration_v597_engine_facebook_group_post_signs: trả block 2871, danh mục bước 4 và dòng facebook.error_signs về bản trước V597; tắt ba mã FB48 / FB49 / FB50 và ba
-- dòng chính sách nguồn v597 (không xoá: auto_engine_outcomes có thể đã giữ mã); xoá ba element mới sau khi block không còn đọc. Chỉ chạy khi
-- block đang đúng bản V597 (đã ai sửa sau V597 thì dừng, không ghi đè). Sinh bằng scripts/build-v597-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND md5(code) = 'f981cac703a91dc6c9f8a49176a61bba') THEN
    RAISE EXCEPTION 'Gỡ V597: block 2871 khác bản V597 (md5 f981cac703a91dc6c9f8a49176a61bba)';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'dc7fd786e225a7ca05c4a3cfa49852d7' THEN
    RAISE EXCEPTION 'Gỡ V597: dòng facebook.error_signs khác bản V597';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = replace(code, $v597$  // V597: Facebook ghi lý do bằng chữ đỏ trong hộp Tạo bài viết. Nhận theo chữ có mặt (element ở auto_elements), không thấy thì như cũ.
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
$v597$, $v597$  message = 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây';
}
$v597$), updated_at = now()
 WHERE id = 2871;
UPDATE public.auto_blocks SET code = replace(code, $v597$const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
const requestFailedNotice = await helpers.element('GroupPostRequestFailedNotice');
const uploadFailedNotice = await helpers.element('GroupPostUploadFailedNotice');
const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');
$v597$, $v597$const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
$v597$), updated_at = now()
 WHERE id = 2871;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = 'e433ac1a58ac08535c53010fdc5e9ba7', updated_at = now()
 WHERE id = 4 AND block_id = 2871 AND reviewed_code_md5 = 'f981cac703a91dc6c9f8a49176a61bba';
UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_identity_required","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"]},{"code":"err_fb_page_inbox_cannot_reply_blocked_by_user","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Page không gửi được tin cho người này nữa"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = 'dc7fd786e225a7ca05c4a3cfa49852d7';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = 'v597' AND is_active;
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code IN ('err_fb_group_post_request_failed', 'err_fb_group_post_upload_failed', 'err_fb_account_access_limited');
DELETE FROM public.auto_elements WHERE name IN ('GroupPostRequestFailedNotice', 'GroupPostUploadFailedNotice', 'GroupPostAccountAccessLimitedNotice');

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2871 AND md5(code) = 'e433ac1a58ac08535c53010fdc5e9ba7')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2871 AND reviewed_code_md5 IS DISTINCT FROM 'e433ac1a58ac08535c53010fdc5e9ba7')
     OR (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'aa197aea7d2dc397545a8f8e5a8a5a5c'
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v597' AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN ('err_fb_group_post_request_failed', 'err_fb_group_post_upload_failed', 'err_fb_account_access_limited') AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('GroupPostRequestFailedNotice', 'GroupPostUploadFailedNotice', 'GroupPostAccountAccessLimitedNotice')) THEN
    RAISE EXCEPTION 'Gỡ V597: dữ liệu chưa về bản trước V597';
  END IF;
END $post$;

COMMIT;
