-- migration_v603_engine_facebook_messenger_signs: nhắn tin bạn bè / theo UID không thấy ô nhập tin Messenger mà Facebook ghi lý do ở chỗ đó → FB19. Câu 570 của hộp thư lỗi,
-- anh chốt 20/11/2026 (docs/ENGINE_V2_FACEBOOK_MESSENGER_SIGNS_V603.md). Sinh bằng scripts/build-v603-sql.cjs (nguồn kiểm
-- scripts/fixtures/engine-v2-facebook/v603-live-20261120.json), không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST).
--   * Hai element mới ở auto_elements (FbMessengerCannotAccessChatNotice, FbMessengerFriendsOnlyNotice), sửa XPath ở màn Element khi Facebook đổi chữ.
--   * Bản "[engine]" của block gửi tin Messenger (2855; bộ cũ 38 không đổi): hết giờ chờ ô nhập tin thì dò hai câu đó, thấy thì báo câu riêng.
--     Danh mục bước 15, 16 (nhắn tin bạn bè, theo UID) ghi md5 mới.
--   * Hai dấu hiệu "message" ở facebook.error_signs đổi câu đó ra FB19 cho nhắn tin bạn bè và theo UID.
--   * FB19 có hai mã nội bộ: err_fb_messenger_unavailable_target_not_messageable (mã có sẵn, chưa chỗ nào phát) "Facebook chỉ cho nhắn tin khi đã kết bạn với người này";
--     err_fb_messenger_recipient_cannot_access_chat mới "Người này chưa đăng nhập Messenger nên chưa nhận được tin".
--   * Chính sách hai thao tác: như FB26 hộp thư Page (đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp).
-- Không thấy hai câu (gồm đoạn chat cũ trước mã hoá đầu cuối có nút "Tiếp tục": anh chờ DOM) thì vẫn FB42 như hôm nay. Gỡ: rollback_v603_engine_facebook_messenger_signs.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v603_%') THEN
      RAISE EXCEPTION 'V603: sổ migration đã có migration_v603_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2855 AND name = '[engine] fb_send_message' AND md5(code) = 'fb11e928304d044f50f3a11a93821463') THEN
    RAISE EXCEPTION 'V603: block 2855 khác bản đã đọc (md5 fb11e928304d044f50f3a11a93821463), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2855 AND source_block_id = 38) THEN
    RAISE EXCEPTION 'V603: thiếu sổ chép block 2855';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2855;
  IF v_n <> 2 THEN RAISE EXCEPTION 'V603: block 2855 có % dòng danh mục bước, cần 2', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps
   WHERE block_id = 2855 AND (id, action_code) IN ((15, 'fb_message_friend'), (16, 'fb_message_stranger'))
     AND commit_level = 2 AND send_ops = '["press:Enter"]'::jsonb AND reviewed_code_md5 = 'fb11e928304d044f50f3a11a93821463';
  IF v_n <> 2 THEN RAISE EXCEPTION 'V603: dòng danh mục bước 15, 16 khác bản đã đọc'; END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'dc7fd786e225a7ca05c4a3cfa49852d7' THEN
    RAISE EXCEPTION 'V603: dòng facebook.error_signs đã đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('FbMessengerCannotAccessChatNotice', 'FbMessengerFriendsOnlyNotice')) THEN
    RAISE EXCEPTION 'V603: đã có element mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_messenger_unavailable_target_not_messageable' AND public_code = 'FB19' AND is_active AND NOT is_delete
                   AND customer_title = 'Người này không nhận tin nhắn từ tài khoản' AND customer_help IS NULL AND error_class = 'target_permanent') THEN
    RAISE EXCEPTION 'V603: mã FB19 khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_engine_fb_action_failed' AND public_code = 'FB42' AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V603: thiếu mã FB42';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_messenger_recipient_cannot_access_chat') THEN
    RAISE EXCEPTION 'V603: đã có mã err_fb_messenger_recipient_cannot_access_chat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v603')
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code IN ('err_fb_messenger_recipient_cannot_access_chat', 'err_fb_messenger_unavailable_target_not_messageable')
                  AND action_code IN ('fb_message_friend', 'fb_message_stranger') AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V603: đã có chính sách FB19 ở nhắn tin hoặc dòng nguồn v603';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE id = 21 AND code = 'campaign_detail_failed' AND status_value = 'thất bại') THEN
    RAISE EXCEPTION 'V603: trạng thái 21 không phải "thất bại"';
  END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
  ('FbMessengerCannotAccessChatNotice', '//text()[contains(normalize-space(.), ''chưa thể truy cập vào đoạn chat này'')]/..', 'V603: chữ Facebook ghi thay ô nhập tin Messenger khi người nhận chưa đăng nhập Messenger (FB19). Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL),
  ('FbMessengerFriendsOnlyNotice', '//text()[starts-with(normalize-space(.), ''Bạn không thể nhắn tin cho tài khoản này'')]/..', 'V603: chữ Facebook ghi thay ô nhập tin Messenger khi chỉ nhắn được cho bạn bè (FB19). Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL);

UPDATE public.auto_blocks SET code = replace(code, $v603$    throw textboxError
  }
$v603$, $v603$    // V603 (anh chốt 20/11/2026): Facebook bỏ ô nhập tin và ghi lý do ở chỗ đó. Nhận ra bằng chữ trên trang (element ở auto_elements),
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
$v603$), updated_at = now()
 WHERE id = 2855 AND strpos(code, $v603$    // V603 (anh chốt 20/11/2026): Facebook bỏ ô nhập tin và ghi lý do ở chỗ đó. Nhận ra bằng chữ trên trang (element ở auto_elements),
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
$v603$) = 0;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '9585b3ce37cbda917225069012c8f62c', updated_at = now()
 WHERE id IN (15, 16) AND block_id = 2855 AND reviewed_code_md5 = 'fb11e928304d044f50f3a11a93821463';

UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_identity_required","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"]},{"code":"err_fb_page_inbox_cannot_reply_blocked_by_user","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Page không gửi được tin cho người này nữa"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]},{"code":"err_fb_group_post_request_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook báo gặp sự cố khi đăng bài"]},{"code":"err_fb_group_post_upload_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook không tải được ảnh hoặc video lên"]},{"code":"err_fb_account_access_limited","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook đang giới hạn quyền truy cập của tài khoản"]},{"code":"err_fb_messenger_recipient_cannot_access_chat","source":"message","actions":["fb_message_friend","fb_message_stranger"],"phases":[],"replaces":[],"texts":["Người này chưa đăng nhập Messenger nên chưa nhận được tin"]},{"code":"err_fb_messenger_unavailable_target_not_messageable","source":"message","actions":["fb_message_friend","fb_message_stranger"],"phases":[],"replaces":[],"texts":["Facebook chỉ cho nhắn tin khi đã kết bạn với người này"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = 'dc7fd786e225a7ca05c4a3cfa49852d7';

-- FB19: chỉ câu cho khách của engine (bộ cũ đọc noti_*, giữ nguyên); mã nội bộ thứ hai cùng FB19 (như Z221 có nhiều mã nội bộ).
UPDATE public.auto_error SET customer_title = 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này', updated_at = now()
 WHERE error_code = 'err_fb_messenger_unavailable_target_not_messageable' AND customer_title = 'Người này không nhận tin nhắn từ tài khoản';

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_fb_messenger_recipient_cannot_access_chat', 'Người này chưa đăng nhập Messenger nên chưa nhận được tin', 'V603 (engine v2): Người này chưa đăng nhập Messenger nên chưa nhận được tin', NULL, NULL, '{}',
  false, false, 'fixed_minutes', '{}', '{}', true, false, 'FB19', 'target_permanent', 'Người này chưa đăng nhập Messenger nên chưa nhận được tin', NULL);

INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode, campaign_effect, account_effect, login_effect, description, source) VALUES
  ('err_fb_messenger_recipient_cannot_access_chat', 'fb_message_friend', NULL, 21, 'write', 'Người này chưa đăng nhập Messenger nên chưa nhận được tin', 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).', 'no_count', 'ignore', NULL, 'complete', 'continue', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', '[anh chốt 20/11] FB19 nhắn tin bạn bè: Facebook ghi "chưa thể truy cập vào đoạn chat này"; như FB26 hộp thư Page: đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp.', 'v603'),
  ('err_fb_messenger_recipient_cannot_access_chat', 'fb_message_stranger', NULL, 21, 'write', 'Người này chưa đăng nhập Messenger nên chưa nhận được tin', 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).', 'no_count', 'ignore', NULL, 'complete', 'continue', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', '[anh chốt 20/11] FB19 nhắn tin theo UID: Facebook ghi "chưa thể truy cập vào đoạn chat này"; như FB26 hộp thư Page: đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp.', 'v603'),
  ('err_fb_messenger_unavailable_target_not_messageable', 'fb_message_friend', NULL, 21, 'write', 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này', 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).', 'no_count', 'ignore', NULL, 'complete', 'continue', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', '[anh chốt 20/11] FB19 nhắn tin bạn bè: Facebook ghi "Bạn không thể nhắn tin cho tài khoản này"; như FB26 hộp thư Page: đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp.', 'v603'),
  ('err_fb_messenger_unavailable_target_not_messageable', 'fb_message_stranger', NULL, 21, 'write', 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này', 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).', 'no_count', 'ignore', NULL, 'complete', 'continue', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', '[anh chốt 20/11] FB19 nhắn tin theo UID: Facebook ghi "Bạn không thể nhắn tin cho tài khoản này"; như FB26 hộp thư Page: đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp.', 'v603');

DO $post$
DECLARE v_p jsonb; v_text text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2855 AND md5(code) = '9585b3ce37cbda917225069012c8f62c') THEN
    RAISE EXCEPTION 'V603 postflight: code block 2855 không ra đúng bản mong đợi (md5 9585b3ce37cbda917225069012c8f62c)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2855 AND reviewed_code_md5 IS DISTINCT FROM '9585b3ce37cbda917225069012c8f62c') THEN
    RAISE EXCEPTION 'V603 postflight: danh mục bước của block 2855 chưa ghi md5 mới';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'a8eb20650fc32f7541c6622b7f51caee' THEN
    RAISE EXCEPTION 'V603 postflight: dòng facebook.error_signs';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (('FbMessengerCannotAccessChatNotice', '//text()[contains(normalize-space(.), ''chưa thể truy cập vào đoạn chat này'')]/..'), ('FbMessengerFriendsOnlyNotice', '//text()[starts-with(normalize-space(.), ''Bạn không thể nhắn tin cho tài khoản này'')]/..'));
  IF v_n <> 2 THEN RAISE EXCEPTION 'V603 postflight: % element mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = 'v603' AND is_active AND NOT is_delete;
  IF v_n <> 4 THEN RAISE EXCEPTION 'V603 postflight: % dòng chính sách mới', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_messenger_unavailable_target_not_messageable' AND customer_title = 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này' AND customer_help IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_messenger_recipient_cannot_access_chat' AND public_code = 'FB19' AND is_active
                      AND customer_title = 'Người này chưa đăng nhập Messenger nên chưa nhận được tin' AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V603 postflight: câu FB19';
  END IF;

  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_recipient_cannot_access_chat', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_friend', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_recipient_cannot_access_chat', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_friend', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_recipient_cannot_access_chat', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_friend', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_recipient_cannot_access_chat', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_stranger', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_recipient_cannot_access_chat', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_stranger', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_recipient_cannot_access_chat', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_stranger', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_unavailable_target_not_messageable', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_friend', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_unavailable_target_not_messageable', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_friend', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_unavailable_target_not_messageable', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_friend', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_unavailable_target_not_messageable', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_stranger', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_unavailable_target_not_messageable', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_stranger', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_messenger_unavailable_target_not_messageable', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19).'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_stranger', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}' THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_engine_fb_action_failed', 'fb_message_friend', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}' THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_engine_fb_action_failed', 'fb_message_friend', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_message_friend', 'facebook_message_friend', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}' THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_engine_fb_action_failed', 'fb_message_friend', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}' THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_engine_fb_action_failed', 'fb_message_stranger', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}' THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_engine_fb_action_failed', 'fb_message_stranger', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_message_stranger', 'facebook_message_uid', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'log_template' IS DISTINCT FROM '{message}' THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', 'err_engine_fb_action_failed', 'fb_message_stranger', 'after_send', v_p;
  END IF;

  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_friend', 'before_send',
    '{"kind":"block","code":"err_fb_messenger_recipient_cannot_access_chat","errorCode":"err_fb_messenger_recipient_cannot_access_chat","message":"Lỗi nhắn tin đến A: Người này chưa đăng nhập Messenger nên chưa nhận được tin"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_messenger_recipient_cannot_access_chat' THEN RAISE EXCEPTION 'V603 postflight: tín hiệu % ở % ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_friend', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_stranger', 'before_send',
    '{"kind":"block","code":"err_fb_messenger_recipient_cannot_access_chat","errorCode":"err_fb_messenger_recipient_cannot_access_chat","message":"Lỗi nhắn tin đến A: Người này chưa đăng nhập Messenger nên chưa nhận được tin"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_messenger_recipient_cannot_access_chat' THEN RAISE EXCEPTION 'V603 postflight: tín hiệu % ở % ra %', 'err_fb_messenger_recipient_cannot_access_chat', 'fb_message_stranger', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_friend', 'before_send',
    '{"kind":"block","code":"err_fb_messenger_unavailable_target_not_messageable","errorCode":"err_fb_messenger_unavailable_target_not_messageable","message":"Lỗi nhắn tin đến A: Facebook chỉ cho nhắn tin khi đã kết bạn với người này"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_messenger_unavailable_target_not_messageable' THEN RAISE EXCEPTION 'V603 postflight: tín hiệu % ở % ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_friend', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_stranger', 'before_send',
    '{"kind":"block","code":"err_fb_messenger_unavailable_target_not_messageable","errorCode":"err_fb_messenger_unavailable_target_not_messageable","message":"Lỗi nhắn tin đến A: Facebook chỉ cho nhắn tin khi đã kết bạn với người này"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_messenger_unavailable_target_not_messageable' THEN RAISE EXCEPTION 'V603 postflight: tín hiệu % ở % ra %', 'err_fb_messenger_unavailable_target_not_messageable', 'fb_message_stranger', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_friend', 'before_send',
    '{"kind":"block","code":"status:campaign_detail_failed","message":"Lỗi nhắn tin đến A: waitForSelector timeout: [role=\"textbox\"][contenteditable=\"true\"]"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_engine_fb_action_failed' THEN RAISE EXCEPTION 'V603 postflight: tín hiệu % ở % ra %', 'err_engine_fb_action_failed', 'fb_message_friend', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_stranger', 'before_send',
    '{"kind":"block","code":"status:campaign_detail_failed","message":"Lỗi nhắn tin đến A: waitForSelector timeout: [role=\"textbox\"][contenteditable=\"true\"]"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_engine_fb_action_failed' THEN RAISE EXCEPTION 'V603 postflight: tín hiệu % ở % ra %', 'err_engine_fb_action_failed', 'fb_message_stranger', v_text; END IF;
END $post$;

COMMIT;
