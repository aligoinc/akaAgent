-- Gỡ V645: đưa lại trạng thái sau V644 (15 mã ngoài bộ lọc sang Haiku / luna cổng chat, lời dặn 1 có câu không dùng markdown,
-- nút "Viết lại" về lời dặn 1, tắt lời dặn riêng của V645 (không xoá: ai_log có khoá ngoại), ai.model_fallbacks).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_using u JOIN public.ai_prompt p ON p.id = u.prompt_id
                 WHERE u.code = 'app_ai_rewrite_content' AND p.code = 'akabiz_rewrite_content_luna') THEN
    RAISE EXCEPTION 'Gỡ V645: không thấy trạng thái sau V645, dừng';
  END IF;
END $pre$;

UPDATE public.ai_using SET model_id = (SELECT id FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat')
WHERE code IN ('app_ai_generate_campaign_name', 'app_campaign_import_image_to_data', 'campaign_error_screenshot_diagnosis',
               'fb_newsfeed_check_comment', 'fb_newsfeed_check_like') AND model_id = 1;
UPDATE public.ai_using SET request_options = '{"max_completion_tokens":2048}'::jsonb WHERE code = 'app_ai_generate_campaign_name';

UPDATE public.ai_using SET model_id = (SELECT id FROM public.ai_model WHERE code = 'openai_luna_chat')
WHERE code IN ('fb_comment_at_position_rewrite', 'fb_comment_current_post_rewrite', 'fb_page_post_api_rewrite',
               'fb_post_current_identity_ui_rewrite', 'fb_post_reels_rewrite', 'fb_send_message_rewrite',
               'fb_send_page_inbox_message_rewrite', 'fb_share_post_rewrite', 'fb_type_post_content_rewrite',
               'fb_rewrite_source_content_ai') AND model_id = 1;

UPDATE public.ai_prompt
SET prompt_user = E'Viết lại nội dung dưới đây, giữ nguyên ý, ngôn ngữ và cách trình bày (xuống dòng, emoji, chữ in hoa). Không dùng markdown: không **, không #. Chỉ trả về kết quả và không giải thích gì thêm:\r\n[content]'
WHERE id = 1;
UPDATE public.ai_using SET prompt_id = 1 WHERE code = 'app_ai_rewrite_content';
UPDATE public.ai_prompt SET is_active = false WHERE code = 'akabiz_rewrite_content_luna';

UPDATE public.auto_system_settings SET is_active = true WHERE key = 'ai.model_fallbacks';
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'ai.model_fallbacks', '{"anthropic_haiku_5_5_chat_compat":"openai_luna_chat"}',
       'V644: gọi ai_model (theo code) lỗi thì gọi lại bằng ai_model này, cùng khuôn yêu cầu.', false, true
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'ai.model_fallbacks');

COMMIT;