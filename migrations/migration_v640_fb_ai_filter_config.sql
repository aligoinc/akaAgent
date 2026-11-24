-- migration_v640_fb_ai_filter_config: cấu hình AI lọc bài / comment mới cho Comment seeding, Tìm data trong group, Tìm data bằng search (chỉ dữ liệu, không DDL,
-- không nạp lại schema PostgREST). Chưa ai dùng cho tới V641 (10 block gọi mã mới). Phương án: docs/FB_AI_FILTER_PLAN.md.
--   * ai_prompt find_data_meaning_check_v2: nhận nguyên văn mô tả, tự tách phần cần tìm / loại bỏ (prompt 6 cũ giữ nguyên).
--   * 5 ai_using `<mã cũ>_v2` dùng deepseek-flash (ai_model 2), 1 ai_using fb_ai_content_filter_fallback dùng gpt-6-luna (ai_model 16).
--   * auto_error err_fb_ai_filter_unavailable (FB53) + chính sách engine: tạm dừng chiến dịch, data về hàng đợi, không ghi lịch sử, không tính lượt,
--     không cộng chuỗi data lỗi; dấu hiệu "message" ở facebook.error_signs nhận câu lỗi của block "[engine]".
-- Sinh bằng scripts/fb-ai-filter/build-v640-sql.cjs, không sửa tay. Gỡ: rollback_v640_fb_ai_filter_config.sql (gỡ V641 trước).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v640_%') THEN
      RAISE EXCEPTION 'V640: sổ migration đã có migration_v640_%%, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_prompt WHERE code = 'find_data_meaning_check_v2') THEN RAISE EXCEPTION 'V640: đã có ai_prompt find_data_meaning_check_v2'; END IF;
  IF EXISTS (SELECT 1 FROM public.ai_using WHERE code IN ('fb_prepare_seeding_iterations_ai_filter_v2', 'fb_extract_data_from_group_posts_ai_filter_v2', 'fb_collect_group_comments_ai_filter_v2', 'fb_extract_data_from_search_posts_ai_filter_v2', 'fb_collect_search_post_comments_ai_filter_v2', 'fb_ai_content_filter_fallback')) THEN RAISE EXCEPTION 'V640: đã có mã ai_using mới'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_ai_filter_unavailable' OR public_code = 'FB53') THEN RAISE EXCEPTION 'V640: đã có mã lỗi FB53'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_fb_ai_filter_unavailable') THEN RAISE EXCEPTION 'V640: đã có chính sách FB53'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 2 AND code = 'deepseek_default' AND model = 'deepseek-flash' AND is_active AND organization_id IS NULL) THEN RAISE EXCEPTION 'V640: ai_model 2 khác bản đã đọc'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 16 AND code = 'openai_luna' AND model = 'gpt-6-luna' AND is_active AND organization_id IS NULL) THEN RAISE EXCEPTION 'V640: ai_model 16 khác bản đã đọc'; END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM 'a8eb20650fc32f7541c6622b7f51caee' THEN RAISE EXCEPTION 'V640: dòng facebook.error_signs đã đổi'; END IF;
END $pre$;

DO $ins$
DECLARE v_prompt bigint;
BEGIN
  INSERT INTO public.ai_prompt (code, name, prompt_system, prompt_user, is_reasoning, organization_id, is_system, is_active, description, request_options)
  VALUES ('find_data_meaning_check_v2', 'Lọc bài / comment Facebook theo mô tả của khách (v2)', $v640$Bạn là bộ lọc nội dung Facebook cho phần mềm marketing. Bạn đọc mô tả của khách hàng rồi quyết định một bài viết hoặc bình luận có đúng loại khách cần hay không. Chỉ trả về một đối tượng JSON hợp lệ, không viết gì ngoài JSON.$v640$, $v640$Mô tả của khách hàng (nguyên văn):
<mo_ta>
[prompt]
</mo_ta>

Loại nội dung: [entity_type] (post là bài viết, comment là bình luận)

Nội dung cần xét (chỉ có chữ, không có hình ảnh):
<noi_dung>
[content]
</noi_dung>

Cách xét:
1. Đọc cả mô tả như lời dặn của một người. Không coi mỗi dòng là một điều kiện riêng mà chỉ cần khớp một dòng.
2. Tách mô tả thành hai phần: điều khách cần tìm, và điều khách muốn loại bỏ (các câu như "Loại bỏ", "KHÔNG", "không lấy", "trừ", "ngoại trừ", "điều kiện loại trừ"). Các câu hướng dẫn chung như "ưu tiên", "phân tích cả hình ảnh" không phải điều kiện riêng.
3. Xét ý định thật của người viết nội dung, không chỉ xem có trùng chữ. Mô tả người cần mua hoặc cần thuê thì nội dung của người bán, người cho thuê hoặc môi giới là không đúng, trừ khi mô tả nói muốn lấy cả những người đó.
4. Mô tả chỉ là danh sách từ khoá hoặc chủ đề thì chọn nội dung nói về chủ đề đó.
5. Chọn khi nội dung thuộc điều khách cần tìm và không dính điều khách muốn loại bỏ.
6. Nội dung trống, chỉ có tên nhóm, ngày giờ, hoặc không đủ chữ để biết thì không chọn. Không đoán nội dung của hình ảnh.

Trả về đúng khuôn:
{"matched": true hoặc false, "excluded": true hoặc false, "reason": "lý do ngắn bằng tiếng Việt, tối đa 25 từ"}$v640$, true, NULL, true, true, 'V640: nhận nguyên văn mô tả ([prompt]), tự tách phần cần tìm và phần loại bỏ, trả JSON {matched, excluded, reason}. Thay prompt 6 (tách mỗi dòng thành một tính chất, khớp một là chọn).', '{}'::jsonb)
  RETURNING id INTO v_prompt;
  INSERT INTO public.ai_using (code, name, description, prompt_id, model_id, organization_id, is_system, is_active, timeout_ms, response_parser, request_options) VALUES
    ('fb_prepare_seeding_iterations_ai_filter_v2', 'Block fb_prepare_seeding_iterations - AI filter v2', 'Lọc bài viết trước khi comment seeding group/page/profile (lời dặn v2).', v_prompt, 2, NULL, true, true, 45000, 'auto', '{}'::jsonb),
    ('fb_extract_data_from_group_posts_ai_filter_v2', 'Block fb_extract_data_from_group_posts - AI filter v2', 'Lọc bài viết trong group khi tìm data (lời dặn v2).', v_prompt, 2, NULL, true, true, 45000, 'auto', '{}'::jsonb),
    ('fb_collect_group_comments_ai_filter_v2', 'Block fb_collect_group_comments - AI filter v2', 'Lọc comment trong group khi tìm data (lời dặn v2).', v_prompt, 2, NULL, true, true, 45000, 'auto', '{}'::jsonb),
    ('fb_extract_data_from_search_posts_ai_filter_v2', 'Block fb_extract_data_from_search_posts - AI filter v2', 'Lọc bài viết từ Facebook search khi tìm data (lời dặn v2).', v_prompt, 2, NULL, true, true, 45000, 'auto', '{}'::jsonb),
    ('fb_collect_search_post_comments_ai_filter_v2', 'Block fb_collect_search_post_comments - AI filter v2', 'Lọc comment từ Facebook search khi tìm data (lời dặn v2).', v_prompt, 2, NULL, true, true, 45000, 'auto', '{}'::jsonb),
    ('fb_ai_content_filter_fallback', 'AI lọc bài / comment Facebook - mô hình dự phòng', 'Dùng chung cho 5 chỗ lọc khi mô hình chính lỗi 3 lần hoặc lỗi không thử lại được (V641).', v_prompt, 16, NULL, true, true, 60000, 'auto', '{}'::jsonb);
END $ins$;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_fb_ai_filter_unavailable', 'AI lọc bài tạm thời không dùng được', 'V640 (engine v2): block lọc bài / comment bằng AI gọi mô hình chính 3 lần và mô hình dự phòng 2 lần đều lỗi.', NULL, NULL, '{}',
  false, false, 'fixed_minutes', '{}', '{}', true, false, 'FB53', 'transient', 'AI lọc bài tạm thời không dùng được', NULL);

INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template,
  quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode,
  campaign_effect, account_effect, login_effect, streak_after_delivery, description, source)
VALUES ('err_fb_ai_filter_unavailable', NULL, NULL, NULL, 'suppress', 'AI lọc bài tạm thời không dùng được', 'AI lọc bài tạm thời không dùng được (FB53). Bấm Tiếp tục chiến dịch sau ít phút.',
  'no_count', 'ignore', NULL, 'requeue', 'continue', ARRAY[]::text[], 'fixed_minutes', 'end_unit', 'full',
  'pause', 'none', 'none', 'ignore', '[V640] FB53: AI lọc bài lỗi cả mô hình chính lẫn dự phòng; tạm dừng chiến dịch, data về hàng đợi, không ghi lịch sử, không tính lượt, không cộng chuỗi (như CFG01).', 'v640');

UPDATE public.auto_system_settings SET value = $v640$[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn't available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_identity_required","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"]},{"code":"err_fb_page_inbox_cannot_reply_blocked_by_user","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Page không gửi được tin cho người này nữa"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]},{"code":"err_fb_group_post_request_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook báo gặp sự cố khi đăng bài"]},{"code":"err_fb_group_post_upload_failed","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook không tải được ảnh hoặc video lên"]},{"code":"err_fb_account_access_limited","source":"message","actions":["fb_post_group"],"phases":[],"replaces":[],"texts":["Facebook đang giới hạn quyền truy cập của tài khoản"]},{"code":"err_fb_messenger_recipient_cannot_access_chat","source":"message","actions":["fb_message_friend","fb_message_stranger"],"phases":[],"replaces":[],"texts":["Người này chưa đăng nhập Messenger nên chưa nhận được tin"]},{"code":"err_fb_messenger_unavailable_target_not_messageable","source":"message","actions":["fb_message_friend","fb_message_stranger"],"phases":[],"replaces":[],"texts":["Facebook chỉ cho nhắn tin khi đã kết bạn với người này"]},{"code":"err_fb_ai_filter_unavailable","source":"message","actions":[],"phases":[],"replaces":[],"texts":["AI lọc bài tạm thời không dùng được"]}]$v640$, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = 'a8eb20650fc32f7541c6622b7f51caee';

DO $post$
DECLARE v_p jsonb; v_n integer; v_code text;
BEGIN
  SELECT count(*) INTO v_n FROM public.ai_using u JOIN public.ai_prompt p ON p.id = u.prompt_id
   WHERE p.code = 'find_data_meaning_check_v2' AND md5(p.prompt_user) = 'a9b2b67c84c04b937ed4c35e4517eb74' AND md5(p.prompt_system) = '2316f818447f073c9bec6eba65e7c803' AND u.is_active AND u.is_system
     AND ((u.code IN ('fb_prepare_seeding_iterations_ai_filter_v2', 'fb_extract_data_from_group_posts_ai_filter_v2', 'fb_collect_group_comments_ai_filter_v2', 'fb_extract_data_from_search_posts_ai_filter_v2', 'fb_collect_search_post_comments_ai_filter_v2') AND u.model_id = 2) OR (u.code = 'fb_ai_content_filter_fallback' AND u.model_id = 16));
  IF v_n <> 6 THEN RAISE EXCEPTION 'V640 postflight: % mã ai_using mới', v_n; END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '3c9abdeca0782d4caf0f159637074d91' THEN RAISE EXCEPTION 'V640 postflight: dòng facebook.error_signs'; END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_ai_filter_unavailable', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'before_send');
  IF v_p->>'campaign_effect' IS DISTINCT FROM 'pause' OR v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'suppress' OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore' OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'AI lọc bài tạm thời không dùng được (FB53). Bấm Tiếp tục chiến dịch sau ít phút.' OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V640 postflight: chính sách FB53 ở facebook_comment_seeding ra %', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_ai_filter_unavailable', NULL, '', 'facebook_find_data_group', 'desktop', 'before_send');
  IF v_p->>'campaign_effect' IS DISTINCT FROM 'pause' OR v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'suppress' OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore' OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'AI lọc bài tạm thời không dùng được (FB53). Bấm Tiếp tục chiến dịch sau ít phút.' OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V640 postflight: chính sách FB53 ở facebook_find_data_group ra %', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_ai_filter_unavailable', NULL, '', 'facebook_find_data_search', 'desktop', 'before_send');
  IF v_p->>'campaign_effect' IS DISTINCT FROM 'pause' OR v_p->>'target_effect' IS DISTINCT FROM 'requeue'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'suppress' OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore' OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'
     OR v_p->>'campaign_note_template' IS DISTINCT FROM 'AI lọc bài tạm thời không dùng được (FB53). Bấm Tiếp tục chiến dịch sau ít phút.' OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'V640 postflight: chính sách FB53 ở facebook_find_data_search ra %', v_p;
  END IF;
  SELECT c.error_code INTO v_code FROM public.aka_agent_engine_classify_signal('facebook', 'fb_comment', 'before_send',
    jsonb_build_object('kind', 'block', 'code', 'err_fb_ai_filter_unavailable', 'errorCode', 'err_fb_ai_filter_unavailable', 'message', 'AI lọc bài tạm thời không dùng được (AI trả về lỗi 503)')) c;
  IF v_code IS DISTINCT FROM 'err_fb_ai_filter_unavailable' THEN RAISE EXCEPTION 'V640 postflight: tín hiệu ra %', v_code; END IF;
  IF EXISTS (SELECT 1 FROM public.aka_agent_engine_policy_lint WHERE subject::text LIKE '%err_fb_ai_filter_unavailable%') THEN RAISE EXCEPTION 'V640 postflight: policy lint báo err_fb_ai_filter_unavailable'; END IF;
END $post$;

COMMIT;
