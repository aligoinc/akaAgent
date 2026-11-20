-- Gỡ migration_v603_engine_facebook_messenger_signs: trả block 2855, danh mục bước 15, 16, dòng facebook.error_signs và câu FB19 về bản trước V603; tắt mã
-- err_fb_messenger_recipient_cannot_access_chat và 4 dòng chính sách nguồn v603 (không xoá: auto_engine_outcomes có thể đã giữ mã); xoá hai element
-- mới sau khi block không còn đọc. Chỉ chạy khi block đang đúng bản V603 (đã ai sửa sau V603 thì dừng, không ghi đè). Sinh bằng scripts/build-v603-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2855 AND md5(code) = '9585b3ce37cbda917225069012c8f62c') THEN
    RAISE EXCEPTION 'Gỡ V603: block 2855 khác bản V603 (md5 9585b3ce37cbda917225069012c8f62c)';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'a8eb20650fc32f7541c6622b7f51caee' THEN
    RAISE EXCEPTION 'Gỡ V603: dòng facebook.error_signs khác bản V603';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = replace(code, $v603$    // V603 (anh chốt 20/11/2026): Facebook bỏ ô nhập tin và ghi lý do ở chỗ đó. Nhận ra bằng chữ trên trang (element ở auto_elements),
    // không đoán lý do; không thấy câu nào thì vẫn báo câu hết giờ như cũ.
    const facebookNotice = async name => {
      if (signal.aborted) return false
      const xpath = await Promise.resolve().then(() => helpers.element(name)).catch(() => null)
      if (!xpath) return false
      return await page.evaluate('return document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength > 0;',
        xpath).catch(() => false)
    }
    if (await facebookNotice('FbMessengerCannotAccessChatNotice')) throw new Error('Người này chưa đăng nhập Messenger nên chưa nhận được tin')
    if (await facebookNotice('FbMessengerFriendsOnlyNotice')) throw new Error('Facebook chỉ cho nhắn tin khi đã kết bạn với người này')
    throw textboxError
  }
$v603$, $v603$    throw textboxError
  }
$v603$), updated_at = now()
 WHERE id = 2855;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = 'fb11e928304d044f50f3a11a93821463', updated_at = now()
 WHERE id IN (15, 16) AND block_id = 2855 AND reviewed_code_md5 = '9585b3ce37cbda917225069012c8f62c';
UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_identity_required","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"]},{"code":"err_fb_page_inbox_cannot_reply_blocked_by_user","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Page không gửi được tin cho người này nữa"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]},{"code":"err_fb_group_post_request_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook báo gặp sự cố khi đăng bài"]},{"code":"err_fb_group_post_upload_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook không tải được ảnh hoặc video lên"]},{"code":"err_fb_account_access_limited","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook đang giới hạn quyền truy cập của tài khoản"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = 'a8eb20650fc32f7541c6622b7f51caee';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = 'v603' AND is_active;
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = 'err_fb_messenger_recipient_cannot_access_chat';
UPDATE public.auto_error SET customer_title = 'Người này không nhận tin nhắn từ tài khoản', updated_at = now()
 WHERE error_code = 'err_fb_messenger_unavailable_target_not_messageable' AND customer_title = 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này';
DELETE FROM public.auto_elements WHERE name IN ('FbMessengerCannotAccessChatNotice', 'FbMessengerFriendsOnlyNotice');

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2855 AND md5(code) = 'fb11e928304d044f50f3a11a93821463')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2855 AND reviewed_code_md5 IS DISTINCT FROM 'fb11e928304d044f50f3a11a93821463')
     OR (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'dc7fd786e225a7ca05c4a3cfa49852d7'
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v603' AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_messenger_recipient_cannot_access_chat' AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_messenger_unavailable_target_not_messageable' AND customer_title = 'Người này không nhận tin nhắn từ tài khoản')
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('FbMessengerCannotAccessChatNotice', 'FbMessengerFriendsOnlyNotice')) THEN
    RAISE EXCEPTION 'Gỡ V603: dữ liệu chưa về bản trước V603';
  END IF;
END $post$;

COMMIT;
