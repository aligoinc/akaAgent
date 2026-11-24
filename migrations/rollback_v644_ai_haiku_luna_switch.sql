-- Gỡ V644: các mã về mô hình trước V644 (gpt-5-nano = ai_model 1, deepseek-flash = ai_model 2), lời dặn 1 / 2 về bản cũ,
-- request_options của app_ai_generate_campaign_name về bản cũ, tắt hai dòng ai_model của V644 (không xoá: ai_log có khoá ngoại),
-- xoá khoá ai.model_fallbacks. Chỉ dữ liệu.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat' AND is_active) THEN
    RAISE EXCEPTION 'Gỡ V644: không thấy dòng Haiku của V644 đang bật, dừng';
  END IF;
END $pre$;

UPDATE public.ai_using SET model_id = 1
WHERE code IN ('app_ai_generate_campaign_name', 'app_campaign_import_image_to_data', 'campaign_error_screenshot_diagnosis',
               'fb_newsfeed_check_comment', 'fb_newsfeed_check_like',
               'app_ai_rewrite_content', 'app_ai_write_multi_other_content', 'fb_comment_at_position_rewrite',
               'fb_comment_current_post_rewrite', 'fb_page_post_api_rewrite', 'fb_post_current_identity_ui_rewrite',
               'fb_post_reels_rewrite', 'fb_send_message_rewrite', 'fb_send_page_inbox_message_rewrite',
               'fb_share_post_rewrite', 'fb_type_post_content_rewrite', 'fb_rewrite_source_content_ai')
  AND model_id IN (SELECT id FROM public.ai_model WHERE code IN ('anthropic_haiku_5_5_chat_compat', 'openai_luna_chat'));

UPDATE public.ai_using SET model_id = 2
WHERE code IN ('fb_prepare_seeding_iterations_ai_filter_v2', 'fb_extract_data_from_group_posts_ai_filter_v2',
               'fb_collect_group_comments_ai_filter_v2', 'fb_extract_data_from_search_posts_ai_filter_v2',
               'fb_collect_search_post_comments_ai_filter_v2')
  AND model_id = (SELECT id FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat');

UPDATE public.ai_using SET request_options = '{"text":{"verbosity":"low"},"reasoning":{"effort":"minimal"},"max_output_tokens":128}'::jsonb
WHERE code = 'app_ai_generate_campaign_name';

UPDATE public.ai_prompt SET prompt_user = E'Viết lại nội dung dưới đây, chỉ trả về kết quả và không giải thích gì thêm:\r\n[content]' WHERE id = 1;
UPDATE public.ai_prompt SET prompt_user = E'Tạo ra [count] phiên bản nội dung khác nhau cho nội dung dưới đây, mỗi nội dung phân tách nhau bởi dấu "|", vui lòng chỉ trả lời và không giải thích gì thêm. Nội dung là:\r\n\r\n[content]' WHERE id = 2;

UPDATE public.ai_model SET is_active = false WHERE code IN ('anthropic_haiku_5_5_chat_compat', 'openai_luna_chat');
DELETE FROM public.auto_system_settings WHERE key = 'ai.model_fallbacks';

DO $post$
BEGIN
  IF (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 1) IS DISTINCT FROM '587ca6f3a4e1c94bd9073922bbbac480'
     OR (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 2) IS DISTINCT FROM '3991be2d1ea3c7553f5c5b13fb82e8f7' THEN
    RAISE EXCEPTION 'Gỡ V644: lời dặn 1 / 2 không về đúng bản cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_using u JOIN public.ai_model m ON m.id = u.model_id WHERE m.code IN ('anthropic_haiku_5_5_chat_compat', 'openai_luna_chat')) THEN
    RAISE EXCEPTION 'Gỡ V644: còn mã dùng dòng ai_model của V644';
  END IF;
END $post$;

COMMIT;