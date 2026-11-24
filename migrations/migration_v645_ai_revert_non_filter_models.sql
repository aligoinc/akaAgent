-- migration_v645_ai_revert_non_filter_models: trả các mã AI ngoài bộ lọc bài / comment Facebook về như trước V644 (anh 24/11/2026:
-- "Bạn hiểu nhầm tôi rồi. Tôi chỉ muốn thay đổi model ai cho bộ lọc post và comment fb thôi"). Chỉ dữ liệu, không DDL.
-- 1. 17 mã (đặt tên chiến dịch, đọc ảnh nhập data, chẩn đoán ảnh lỗi, duyệt newsfeed like / comment, 12 mã viết lại nội dung) về gpt-5-nano (ai_model 1);
--    request_options của app_ai_generate_campaign_name về khuôn Responses cũ; lời dặn 1 / 2 về đúng chữ cũ.
-- 2. Giữ: 5 mã lọc bài / comment `_v2` dùng Haiku 5.5 (ai_model 41, cổng chat của Anthropic); lỗi thì block V641 sang fb_ai_content_filter_fallback (gpt-6-luna).
-- 3. Tắt ai_model 42 (openai_luna_chat, không còn mã nào dùng), xoá ai.model_fallbacks (chỉ để cho code dự phòng chung, không cần nữa).
-- Gỡ: rollback_v645_ai_revert_non_filter_models.sql (đưa lại trạng thái sau V644).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v645_%') THEN
    RAISE EXCEPTION 'V645: sổ migration đã có migration_v645_%%, không chạy lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 1 AND model = 'gpt-5-nano' AND is_active) THEN
    RAISE EXCEPTION 'V645: ai_model 1 không còn là gpt-5-nano đang bật';
  END IF;
  SELECT string_agg(e.code || '=' || coalesce(m.code, 'thiếu'), ', ') INTO v_bad
  FROM (VALUES ('app_ai_generate_campaign_name', 'anthropic_haiku_5_5_chat_compat'), ('app_campaign_import_image_to_data', 'anthropic_haiku_5_5_chat_compat'),
               ('campaign_error_screenshot_diagnosis', 'anthropic_haiku_5_5_chat_compat'), ('fb_newsfeed_check_comment', 'anthropic_haiku_5_5_chat_compat'),
               ('fb_newsfeed_check_like', 'anthropic_haiku_5_5_chat_compat'),
               ('app_ai_rewrite_content', 'openai_luna_chat'), ('app_ai_write_multi_other_content', 'openai_luna_chat'),
               ('fb_comment_at_position_rewrite', 'openai_luna_chat'), ('fb_comment_current_post_rewrite', 'openai_luna_chat'),
               ('fb_page_post_api_rewrite', 'openai_luna_chat'), ('fb_post_current_identity_ui_rewrite', 'openai_luna_chat'),
               ('fb_post_reels_rewrite', 'openai_luna_chat'), ('fb_send_message_rewrite', 'openai_luna_chat'),
               ('fb_send_page_inbox_message_rewrite', 'openai_luna_chat'), ('fb_share_post_rewrite', 'openai_luna_chat'),
               ('fb_type_post_content_rewrite', 'openai_luna_chat'), ('fb_rewrite_source_content_ai', 'openai_luna_chat')) e(code, model_code)
  LEFT JOIN public.ai_using u ON u.code = e.code LEFT JOIN public.ai_model m ON m.id = u.model_id
  WHERE m.code IS DISTINCT FROM e.model_code;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V645: ai_using khác trạng thái sau V644: %', v_bad; END IF;
  IF (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 1) IS DISTINCT FROM 'ef7c3e20fee46ef5f25ef4e51f4cca51'
     OR (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 2) IS DISTINCT FROM '6933cbed6ece1318859a25227ac6eb95' THEN
    RAISE EXCEPTION 'V645: lời dặn 1 / 2 khác bản V644';
  END IF;
END $pre$;

UPDATE public.ai_using SET model_id = 1
WHERE code IN ('app_ai_generate_campaign_name', 'app_campaign_import_image_to_data', 'campaign_error_screenshot_diagnosis',
               'fb_newsfeed_check_comment', 'fb_newsfeed_check_like',
               'app_ai_rewrite_content', 'app_ai_write_multi_other_content', 'fb_comment_at_position_rewrite',
               'fb_comment_current_post_rewrite', 'fb_page_post_api_rewrite', 'fb_post_current_identity_ui_rewrite',
               'fb_post_reels_rewrite', 'fb_send_message_rewrite', 'fb_send_page_inbox_message_rewrite',
               'fb_share_post_rewrite', 'fb_type_post_content_rewrite', 'fb_rewrite_source_content_ai');

UPDATE public.ai_using SET request_options = '{"text":{"verbosity":"low"},"reasoning":{"effort":"minimal"},"max_output_tokens":128}'::jsonb
WHERE code = 'app_ai_generate_campaign_name';

UPDATE public.ai_prompt SET prompt_user = E'Viết lại nội dung dưới đây, chỉ trả về kết quả và không giải thích gì thêm:\r\n[content]' WHERE id = 1;
UPDATE public.ai_prompt SET prompt_user = E'Tạo ra [count] phiên bản nội dung khác nhau cho nội dung dưới đây, mỗi nội dung phân tách nhau bởi dấu "|", vui lòng chỉ trả lời và không giải thích gì thêm. Nội dung là:\r\n\r\n[content]' WHERE id = 2;

UPDATE public.ai_model SET is_active = false WHERE code = 'openai_luna_chat';
DELETE FROM public.auto_system_settings WHERE key = 'ai.model_fallbacks';

DO $post$
BEGIN
  IF (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 1) IS DISTINCT FROM '587ca6f3a4e1c94bd9073922bbbac480'
     OR (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 2) IS DISTINCT FROM '3991be2d1ea3c7553f5c5b13fb82e8f7' THEN
    RAISE EXCEPTION 'V645: lời dặn 1 / 2 không về đúng bản cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_using u JOIN public.ai_model m ON m.id = u.model_id WHERE m.code = 'openai_luna_chat') THEN
    RAISE EXCEPTION 'V645: còn mã dùng openai_luna_chat';
  END IF;
  IF (SELECT count(*) FROM public.ai_using u JOIN public.ai_model m ON m.id = u.model_id WHERE m.code = 'anthropic_haiku_5_5_chat_compat') <> 5
     OR EXISTS (SELECT 1 FROM public.ai_using u JOIN public.ai_model m ON m.id = u.model_id
                WHERE m.code = 'anthropic_haiku_5_5_chat_compat' AND u.code NOT LIKE '%\_ai\_filter\_v2') THEN
    RAISE EXCEPTION 'V645: Haiku phải còn đúng 5 mã lọc bài / comment _v2';
  END IF;
END $post$;

COMMIT;