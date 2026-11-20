-- migration_v591_engine_facebook_page_inbox_signs: tách FB46 (hộp thư Page không thấy ô nhập tin) theo chữ Facebook ghi ở chỗ ô nhập tin. Anh chốt 20/11/2026
-- (docs/ENGINE_V2_FACEBOOK_PAGE_INBOX_V591.md). Sinh bằng scripts/build-v591-sql.cjs (nguồn kiểm scripts/fixtures/engine-v2-facebook/
-- v591-live-20261120.json), không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST).
--   * Hai element mới ở auto_elements (FbPageInboxCannotSendNotice, FbPageInboxIdentityRequiredNotice), sửa XPath ở màn Element khi Facebook đổi chữ.
--   * Bản "[engine]" của block gửi tin hộp thư Page (2885; bộ cũ 2679 không đổi): không thấy ô nhập tin thì dò hai câu đó, thấy thì báo câu riêng.
--   * Hai dấu hiệu "message" ở facebook.error_signs đổi câu đó ra FB47 / FB26 (thay err_undefined như FB46).
--   * FB26 (mã có sẵn, chưa chỗ nào phát): câu cho khách "Page không gửi được tin cho người này nữa"; chính sách hộp thư Page: đóng data, ghi thất bại, không tính lượt,
--     không cộng chuỗi, chạy tiếp.
--   * FB47 mới "Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin" (Vui lòng kiểm tra hộp thư page): dừng chiến dịch ngay, đóng data, không tính lượt.
-- Không thấy hai câu thì vẫn FB46 như V575. Gỡ: rollback_v591_engine_facebook_page_inbox_signs.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v591_%') THEN
      RAISE EXCEPTION 'V591: sổ migration đã có migration_v591_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2885 AND name = '[engine] fb_send_page_inbox_message' AND md5(code) = '86217720edd3c1c04495c7c061d26bea') THEN
    RAISE EXCEPTION 'V591: block 2885 khác bản đã đọc (md5 86217720edd3c1c04495c7c061d26bea), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2885 AND source_block_id = 2679) THEN
    RAISE EXCEPTION 'V591: thiếu sổ chép block 2885';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2885;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V591: block 2885 có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 20 AND block_id = 2885 AND commit_level = 1
                   AND send_ops = '[]'::jsonb AND reviewed_code_md5 = '86217720edd3c1c04495c7c061d26bea') THEN
    RAISE EXCEPTION 'V591: dòng danh mục bước 20 khác bản đã đọc';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '797af9742857b712e1144f5d230b2137' THEN
    RAISE EXCEPTION 'V591: dòng facebook.error_signs đã đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('FbPageInboxCannotSendNotice', 'FbPageInboxIdentityRequiredNotice')) THEN
    RAISE EXCEPTION 'V591: đã có element mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_page_inbox_cannot_reply_blocked_by_user' AND public_code = 'FB26' AND is_active AND NOT is_delete
                   AND customer_title = 'Khách không nhận tin nhắn từ Page' AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V591: mã FB26 khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_page_inbox_message_box_not_found' AND public_code = 'FB46' AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V591: thiếu mã FB46';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_page_inbox_identity_required' OR public_code = 'FB47') THEN
    RAISE EXCEPTION 'V591: đã có mã FB47';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v591')
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_fb_page_inbox_cannot_reply_blocked_by_user' AND action_code = 'fb_message_page_inbox_customer' AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V591: đã có chính sách FB26 ở hộp thư Page hoặc dòng nguồn v591';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE id = 21 AND code = 'campaign_detail_failed' AND status_value = 'thất bại') THEN
    RAISE EXCEPTION 'V591: trạng thái 21 không phải "thất bại"';
  END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
  ('FbPageInboxCannotSendNotice', '//text()[normalize-space(.)=''Bạn không thể gửi tin nhắn cho người này nữa.'']/..', 'V591: chữ Facebook ghi thay ô nhập tin khi Page không gửi được tin cho người này nữa (FB26). Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL),
  ('FbPageInboxIdentityRequiredNotice', '//text()[starts-with(normalize-space(.), ''Hãy xác nhận danh tính để gửi tin nhắn'')]/..', 'V591: chữ Facebook ghi thay ô nhập tin khi đòi xác nhận danh tính mới cho Page gửi tin (FB47). Thêm bản tiếng Anh bằng | khi có mẫu.', 'facebook', true, NULL, NULL);

UPDATE public.auto_blocks SET code = replace(code, $v591$const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')
$v591$, $v591$const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')
const cannotSendNoticeXpath = await helpers.element('FbPageInboxCannotSendNotice')
const identityRequiredNoticeXpath = await helpers.element('FbPageInboxIdentityRequiredNotice')
$v591$), updated_at = now()
 WHERE id = 2885 AND strpos(code, $v591$const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')
const cannotSendNoticeXpath = await helpers.element('FbPageInboxCannotSendNotice')
const identityRequiredNoticeXpath = await helpers.element('FbPageInboxIdentityRequiredNotice')
$v591$) = 0;
UPDATE public.auto_blocks SET code = replace(code, $v591$  if (!typed || typed.found !== true) {
    throw new Error('Không tìm thấy ô để nhập tin nhắn')
  }
$v591$, $v591$  if (!typed || typed.found !== true) {
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
$v591$), updated_at = now()
 WHERE id = 2885 AND strpos(code, $v591$  if (!typed || typed.found !== true) {
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
$v591$) = 0;
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = 'd7657b8e27bd1ea4fa2671a99c08101d', updated_at = now()
 WHERE id = 20 AND block_id = 2885 AND reviewed_code_md5 = '86217720edd3c1c04495c7c061d26bea';

UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_identity_required","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"]},{"code":"err_fb_page_inbox_cannot_reply_blocked_by_user","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Page không gửi được tin cho người này nữa"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '797af9742857b712e1144f5d230b2137';

-- FB26: chỉ câu cho khách của engine (bộ cũ đọc noti_*, giữ nguyên).
UPDATE public.auto_error SET customer_title = 'Page không gửi được tin cho người này nữa', updated_at = now()
 WHERE error_code = 'err_fb_page_inbox_cannot_reply_blocked_by_user' AND customer_title = 'Khách không nhận tin nhắn từ Page';

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_fb_page_inbox_identity_required', 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin', 'V591 (engine v2): Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin', NULL, NULL, '{}', false, false, 'fixed_minutes',
  '{}', '{}', true, false, 'FB47', 'account_restricted', 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin', 'Vui lòng kiểm tra hộp thư page');

INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode, campaign_effect, account_effect, login_effect, description, source) VALUES
  ('err_fb_page_inbox_cannot_reply_blocked_by_user', 'fb_message_page_inbox_customer', NULL, 21, 'write', 'Page không gửi được tin cho người này nữa', 'Page không gửi được tin cho người này nữa (FB26).', 'no_count', 'ignore', NULL, 'complete', 'skip', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', '[anh chốt 20/11] FB26 hộp thư Page: Facebook ghi không gửi được tin cho người này nữa; đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp.', 'v591'),
  ('err_fb_page_inbox_identity_required', 'fb_message_page_inbox_customer', NULL, 21, 'write', 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin', 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin (FB47). Vui lòng kiểm tra hộp thư page', 'no_count', 'ignore', NULL, 'complete', 'skip', ARRAY[]::text[], 'fixed_minutes', 'end_unit', 'none', 'pause', 'none', 'none', '[anh chốt 20/11] FB47 hộp thư Page: Facebook đòi xác nhận danh tính; dừng chiến dịch ngay, đóng data (không trả về hàng đợi được vì không rõ đã gửi), không tính lượt.', 'v591');

DO $post$
DECLARE v_p jsonb; v_text text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2885 AND md5(code) = 'd7657b8e27bd1ea4fa2671a99c08101d') THEN
    RAISE EXCEPTION 'V591 postflight: code block 2885 không ra đúng bản mong đợi (md5 d7657b8e27bd1ea4fa2671a99c08101d)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2885 AND reviewed_code_md5 IS DISTINCT FROM 'd7657b8e27bd1ea4fa2671a99c08101d') THEN
    RAISE EXCEPTION 'V591 postflight: danh mục bước của block 2885 chưa ghi md5 mới';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'aa197aea7d2dc397545a8f8e5a8a5a5c' THEN
    RAISE EXCEPTION 'V591 postflight: dòng facebook.error_signs';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (('FbPageInboxCannotSendNotice', '//text()[normalize-space(.)=''Bạn không thể gửi tin nhắn cho người này nữa.'']/..'), ('FbPageInboxIdentityRequiredNotice', '//text()[starts-with(normalize-space(.), ''Hãy xác nhận danh tính để gửi tin nhắn'')]/..'));
  IF v_n <> 2 THEN RAISE EXCEPTION 'V591 postflight: % element mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = 'v591' AND is_active AND NOT is_delete;
  IF v_n <> 2 THEN RAISE EXCEPTION 'V591 postflight: % dòng chính sách mới', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_page_inbox_cannot_reply_blocked_by_user' AND customer_title = 'Page không gửi được tin cho người này nữa' AND customer_help IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_page_inbox_identity_required' AND public_code = 'FB47' AND is_active
                      AND customer_title = 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin' AND customer_help = 'Vui lòng kiểm tra hộp thư page') THEN
    RAISE EXCEPTION 'V591 postflight: câu FB26 / FB47';
  END IF;

  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_cannot_reply_blocked_by_user', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Page không gửi được tin cho người này nữa'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_cannot_reply_blocked_by_user', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_cannot_reply_blocked_by_user', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Page không gửi được tin cho người này nữa'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_cannot_reply_blocked_by_user', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_cannot_reply_blocked_by_user', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'log_template' IS DISTINCT FROM 'Page không gửi được tin cho người này nữa'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_cannot_reply_blocked_by_user', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_identity_required', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin (FB47). Vui lòng kiểm tra hộp thư page'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_identity_required', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_identity_required', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin (FB47). Vui lòng kiểm tra hộp thư page'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_identity_required', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_identity_required', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '21'
     OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'log_template' IS DISTINCT FROM 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin (FB47). Vui lòng kiểm tra hộp thư page'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_identity_required', 'after_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_message_box_not_found', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '22'
     OR v_p->>'streak_threshold' IS DISTINCT FROM '8' THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_message_box_not_found', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_message_box_not_found', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'in_flight');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '22'
     OR v_p->>'streak_threshold' IS DISTINCT FROM '8' THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_message_box_not_found', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_message_box_not_found', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'after_send');
  IF v_p->>'target_effect' IS DISTINCT FROM 'complete'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'increment'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'pause'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '22'
     OR v_p->>'streak_threshold' IS DISTINCT FROM '8' THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', 'err_fb_page_inbox_message_box_not_found', 'after_send', v_p;
  END IF;

  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_page_inbox_customer', 'in_flight',
    '{"kind":"block","code":"err_fb_page_inbox_cannot_reply_blocked_by_user","errorCode":"err_fb_page_inbox_cannot_reply_blocked_by_user","message":"Lỗi nhắn tin khách inbox page đến A: Page không gửi được tin cho người này nữa"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_page_inbox_cannot_reply_blocked_by_user' THEN RAISE EXCEPTION 'V591 postflight: tín hiệu % ra %', 'err_fb_page_inbox_cannot_reply_blocked_by_user', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_page_inbox_customer', 'in_flight',
    '{"kind":"block","code":"err_fb_page_inbox_identity_required","errorCode":"err_fb_page_inbox_identity_required","message":"Lỗi nhắn tin khách inbox page đến A: Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_page_inbox_identity_required' THEN RAISE EXCEPTION 'V591 postflight: tín hiệu % ra %', 'err_fb_page_inbox_identity_required', v_text; END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_page_inbox_customer', 'in_flight',
    '{"kind":"block","code":"err_fb_page_inbox_message_box_not_found","errorCode":"err_fb_page_inbox_message_box_not_found","message":"Lỗi nhắn tin khách inbox page đến A: Không tìm thấy ô để nhập tin nhắn"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_page_inbox_message_box_not_found' THEN RAISE EXCEPTION 'V591 postflight: tín hiệu % ra %', 'err_fb_page_inbox_message_box_not_found', v_text; END IF;
END $post$;

COMMIT;
