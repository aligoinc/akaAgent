-- Gỡ migration_v591_engine_facebook_page_inbox_signs: trả block 2885, danh mục bước 20, dòng facebook.error_signs và câu FB26 về bản trước V591; tắt FB47 và hai dòng chính sách
-- nguồn v591 (không xoá: auto_engine_outcomes có thể đã giữ mã); xoá hai element mới sau khi block không còn đọc. Chỉ chạy khi block đang
-- đúng bản V591 (đã ai sửa sau V591 thì dừng, không ghi đè). Sinh bằng scripts/build-v591-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2885 AND md5(code) = 'd7657b8e27bd1ea4fa2671a99c08101d') THEN
    RAISE EXCEPTION 'Gỡ V591: block 2885 khác bản V591 (md5 d7657b8e27bd1ea4fa2671a99c08101d)';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'aa197aea7d2dc397545a8f8e5a8a5a5c' THEN
    RAISE EXCEPTION 'Gỡ V591: dòng facebook.error_signs khác bản V591';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = replace(code, $v591$  if (!typed || typed.found !== true) {
    // Facebook bỏ ô nhập tin và ghi lý do ở chỗ đó: nhận ra bằng chữ trên trang (element ở auto_elements), không đoán lý do.
    const identityNotice = await dom('exists', { selector: identityRequiredNoticeXpath }).catch(() => null)
    if (identityNotice && identityNotice.ok === true) {
      throw new Error('Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin')
    }
    const cannotSendNotice = await dom('exists', { selector: cannotSendNoticeXpath }).catch(() => null)
    if (cannotSendNotice && cannotSendNotice.ok === true) {
      throw new Error('Page không gửi được tin cho người này nữa')
    }
    throw new Error('Không tìm thấy ô để nhập tin nhắn')
  }
$v591$, $v591$  if (!typed || typed.found !== true) {
    throw new Error('Không tìm thấy ô để nhập tin nhắn')
  }
$v591$), updated_at = now()
 WHERE id = 2885;
UPDATE public.auto_blocks SET code = replace(code, $v591$const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')
const cannotSendNoticeXpath = await helpers.element('FbPageInboxCannotSendNotice')
const identityRequiredNoticeXpath = await helpers.element('FbPageInboxIdentityRequiredNotice')
$v591$, $v591$const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')
$v591$), updated_at = now()
 WHERE id = 2885;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '86217720edd3c1c04495c7c061d26bea', updated_at = now()
 WHERE id = 20 AND block_id = 2885 AND reviewed_code_md5 = 'd7657b8e27bd1ea4fa2671a99c08101d';
UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = 'aa197aea7d2dc397545a8f8e5a8a5a5c';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = 'v591' AND is_active;
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = 'err_fb_page_inbox_identity_required';
UPDATE public.auto_error SET customer_title = 'Khách không nhận tin nhắn từ Page', updated_at = now()
 WHERE error_code = 'err_fb_page_inbox_cannot_reply_blocked_by_user' AND customer_title = 'Page không gửi được tin cho người này nữa';
DELETE FROM public.auto_elements WHERE name IN ('FbPageInboxCannotSendNotice', 'FbPageInboxIdentityRequiredNotice');

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2885 AND md5(code) = '86217720edd3c1c04495c7c061d26bea')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2885 AND reviewed_code_md5 IS DISTINCT FROM '86217720edd3c1c04495c7c061d26bea')
     OR (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '797af9742857b712e1144f5d230b2137'
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v591' AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_page_inbox_identity_required' AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_page_inbox_cannot_reply_blocked_by_user' AND customer_title = 'Khách không nhận tin nhắn từ Page')
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('FbPageInboxCannotSendNotice', 'FbPageInboxIdentityRequiredNotice')) THEN
    RAISE EXCEPTION 'Gỡ V591: dữ liệu chưa về bản trước V591';
  END IF;
END $post$;

COMMIT;
