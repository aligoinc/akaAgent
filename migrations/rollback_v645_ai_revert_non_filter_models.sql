-- Gỡ V645: đưa lại trạng thái sau V644 (17 mã ngoài bộ lọc sang Haiku / luna cổng chat, lời dặn 1 / 2 có câu không dùng markdown, ai.model_fallbacks).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE code = 'openai_luna_chat' AND NOT is_active)
     OR NOT EXISTS (SELECT 1 FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat' AND is_active) THEN
    RAISE EXCEPTION 'Gỡ V645: không thấy trạng thái sau V645, dừng';
  END IF;
END $pre$;

UPDATE public.ai_model SET is_active = true WHERE code = 'openai_luna_chat';

UPDATE public.ai_using SET model_id = (SELECT id FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat')
WHERE code IN ('app_ai_generate_campaign_name', 'app_campaign_import_image_to_data', 'campaign_error_screenshot_diagnosis',
               'fb_newsfeed_check_comment', 'fb_newsfeed_check_like') AND model_id = 1;
UPDATE public.ai_using SET request_options = '{"max_completion_tokens":2048}'::jsonb WHERE code = 'app_ai_generate_campaign_name';

UPDATE public.ai_using SET model_id = (SELECT id FROM public.ai_model WHERE code = 'openai_luna_chat')
WHERE code IN ('app_ai_rewrite_content', 'app_ai_write_multi_other_content', 'fb_comment_at_position_rewrite',
               'fb_comment_current_post_rewrite', 'fb_page_post_api_rewrite', 'fb_post_current_identity_ui_rewrite',
               'fb_post_reels_rewrite', 'fb_send_message_rewrite', 'fb_send_page_inbox_message_rewrite',
               'fb_share_post_rewrite', 'fb_type_post_content_rewrite', 'fb_rewrite_source_content_ai') AND model_id = 1;

UPDATE public.ai_prompt
SET prompt_user = E'Viết lại nội dung dưới đây, giữ nguyên ý, ngôn ngữ và cách trình bày (xuống dòng, emoji, chữ in hoa). Không dùng markdown: không **, không #. Chỉ trả về kết quả và không giải thích gì thêm:\r\n[content]'
WHERE id = 1;
UPDATE public.ai_prompt
SET prompt_user = E'Tạo ra [count] phiên bản nội dung khác nhau cho nội dung dưới đây, mỗi nội dung phân tách nhau bởi dấu "|", vui lòng chỉ trả lời và không giải thích gì thêm. Không dùng markdown (không **, không #), không đánh số hay ghi "Phiên bản" trước mỗi nội dung. Nội dung là:\r\n\r\n[content]'
WHERE id = 2;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'ai.model_fallbacks', '{"anthropic_haiku_5_5_chat_compat":"openai_luna_chat"}',
       'V644: gọi ai_model (theo code) lỗi thì gọi lại bằng ai_model này, cùng khuôn yêu cầu.', false, true
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'ai.model_fallbacks');

COMMIT;