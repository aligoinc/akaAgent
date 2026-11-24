-- migration_v644_ai_haiku_luna_switch: đổi mô hình các mã AI (ai_using) đang chạy gpt-5-nano / deepseek theo yêu cầu anh 24/11/2026:
-- "Dùng hết bằng haiku, nếu lỗi sang luna", rồi chọn "Viết lại dùng luna" (thử thật: Haiku từ chối 7/60 tin Zalo cần viết lại, câu từ chối sẽ bị gửi cho người nhận).
-- Chỉ dữ liệu, không DDL.
-- 1. ai_model `anthropic_haiku_5_5_chat_compat`: claude-haiku-5-5 qua cổng tương thích OpenAI của Anthropic (/v1/chat/completions, khoá Bearer,
--    trả khuôn choices[0].message.content). Desktop (cả bản cũ, qua API chuyển tiếp), App Server, Web và ChatApi đều dựng sẵn yêu cầu kiểu chat
--    cho nhà cung cấp không phải OpenAI Responses nên không cần sửa app. Cổng này không nhận temperature và response_format json_object.
-- 2. ai_model `openai_luna_chat`: gpt-6-luna qua /v1/chat/completions (cùng khuôn yêu cầu với Haiku ở trên, nên lỗi Haiku thì đổi sang được ngay).
-- 3. 10 mã sang Haiku: đặt tên chiến dịch, đọc ảnh nhập data, chẩn đoán ảnh lỗi, duyệt newsfeed (like / comment), 5 mã lọc bài _v2 (V640).
--    Lọc bài lỗi thì block V641 tự sang mã dự phòng fb_ai_content_filter_fallback (gpt-6-luna). Các mã khác chưa có bước tự sang luna:
--    cần code ở API chuyển tiếp / Web / ChatApi đọc `ai.model_fallbacks` (thêm ở dưới).
-- 4. 12 mã viết lại nội dung sang gpt-6-luna (openai_luna_chat); lời dặn 1 và 2 thêm câu không dùng markdown (thử 60 tin Zalo thật: luna 27/60 có **,
--    thêm câu dặn thì 0/60, 0 từ chối).
-- 5. auto_system_settings `ai.model_fallbacks`: mô hình lỗi thì gọi mô hình nào (theo ai_model.code), cho code dùng sau.
-- Gỡ: rollback_v644_ai_haiku_luna_switch.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v644_%') THEN
    RAISE EXCEPTION 'V644: sổ migration đã có migration_v644_%%, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model WHERE code IN ('anthropic_haiku_5_5_chat_compat', 'openai_luna_chat')) THEN
    RAISE EXCEPTION 'V644: dòng ai_model đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'ai.model_fallbacks') THEN
    RAISE EXCEPTION 'V644: auto_system_settings ai.model_fallbacks đã có';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 24 AND model = 'claude-haiku-5-5' AND provider = 'claude' AND organization_id IS NULL AND coalesce(api_key, '') <> '') THEN
    RAISE EXCEPTION 'V644: ai_model 24 không còn là Claude Haiku 5.5 dùng chung';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 16 AND model = 'gpt-6-luna' AND provider = 'openai' AND is_active AND coalesce(api_key, '') <> '') THEN
    RAISE EXCEPTION 'V644: ai_model 16 không còn là gpt-6-luna';
  END IF;
  -- Mỗi mã phải đúng mô hình đọc 24/11 (gpt-5-nano = 1, deepseek-flash = 2) và chỉ có một dòng.
  SELECT string_agg(e.code || '=' || coalesce(u.model_id::text, 'thiếu'), ', ') INTO v_bad
  FROM (VALUES ('app_ai_generate_campaign_name', 1), ('app_campaign_import_image_to_data', 1), ('campaign_error_screenshot_diagnosis', 1),
               ('fb_newsfeed_check_comment', 1), ('fb_newsfeed_check_like', 1),
               ('fb_prepare_seeding_iterations_ai_filter_v2', 2), ('fb_extract_data_from_group_posts_ai_filter_v2', 2),
               ('fb_collect_group_comments_ai_filter_v2', 2), ('fb_extract_data_from_search_posts_ai_filter_v2', 2),
               ('fb_collect_search_post_comments_ai_filter_v2', 2),
               ('app_ai_rewrite_content', 1), ('app_ai_write_multi_other_content', 1), ('fb_comment_at_position_rewrite', 1),
               ('fb_comment_current_post_rewrite', 1), ('fb_page_post_api_rewrite', 1), ('fb_post_current_identity_ui_rewrite', 1),
               ('fb_post_reels_rewrite', 1), ('fb_send_message_rewrite', 1), ('fb_send_page_inbox_message_rewrite', 1),
               ('fb_share_post_rewrite', 1), ('fb_type_post_content_rewrite', 1), ('fb_rewrite_source_content_ai', 1)) e(code, model_id)
  LEFT JOIN public.ai_using u ON u.code = e.code
  WHERE u.model_id IS DISTINCT FROM e.model_id OR (SELECT count(*) FROM public.ai_using x WHERE x.code = e.code) <> 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V644: ai_using khác bản đọc 24/11: %', v_bad; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_using WHERE code = 'app_ai_generate_campaign_name'
                 AND request_options = '{"text":{"verbosity":"low"},"reasoning":{"effort":"minimal"},"max_output_tokens":128}'::jsonb) THEN
    RAISE EXCEPTION 'V644: request_options của app_ai_generate_campaign_name khác bản đọc 24/11';
  END IF;
  IF (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 1) IS DISTINCT FROM '587ca6f3a4e1c94bd9073922bbbac480'
     OR (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 2) IS DISTINCT FROM '3991be2d1ea3c7553f5c5b13fb82e8f7' THEN
    RAISE EXCEPTION 'V644: lời dặn 1 / 2 khác bản đọc 24/11';
  END IF;
  -- Lời dặn 1 và 2 chỉ dùng cho mã viết lại.
  SELECT string_agg(code, ', ') INTO v_bad FROM public.ai_using WHERE prompt_id IN (1, 2) AND code NOT IN
    ('app_ai_rewrite_content', 'app_ai_write_multi_other_content', 'fb_comment_at_position_rewrite', 'fb_comment_current_post_rewrite',
     'fb_page_post_api_rewrite', 'fb_post_current_identity_ui_rewrite', 'fb_post_reels_rewrite', 'fb_send_message_rewrite',
     'fb_send_page_inbox_message_rewrite', 'fb_share_post_rewrite', 'fb_type_post_content_rewrite');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V644: lời dặn 1 / 2 còn dùng cho mã khác: %', v_bad; END IF;
END $pre$;

INSERT INTO public.ai_model (code, model, endpoint, provider, is_active, is_system, default_body, organization_id, api_key)
SELECT 'anthropic_haiku_5_5_chat_compat', 'claude-haiku-5-5', 'https://api.anthropic.com/v1/chat/completions', 'claude', true, true,
       '{"max_completion_tokens":8192}'::jsonb, NULL, api_key
FROM public.ai_model WHERE id = 24;

INSERT INTO public.ai_model (code, model, endpoint, provider, is_active, is_system, default_body, organization_id, api_key)
SELECT 'openai_luna_chat', 'gpt-6-luna', 'https://api.openai.com/v1/chat/completions', 'openai', true, true,
       '{"max_completion_tokens":8192}'::jsonb, NULL, api_key
FROM public.ai_model WHERE id = 16;

UPDATE public.ai_using
SET model_id = (SELECT id FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat')
WHERE code IN ('app_ai_generate_campaign_name', 'app_campaign_import_image_to_data', 'campaign_error_screenshot_diagnosis',
               'fb_newsfeed_check_comment', 'fb_newsfeed_check_like',
               'fb_prepare_seeding_iterations_ai_filter_v2', 'fb_extract_data_from_group_posts_ai_filter_v2',
               'fb_collect_group_comments_ai_filter_v2', 'fb_extract_data_from_search_posts_ai_filter_v2',
               'fb_collect_search_post_comments_ai_filter_v2');

-- Khuôn cũ là của OpenAI Responses (text / reasoning / max_output_tokens), cổng chat không nhận.
UPDATE public.ai_using SET request_options = '{"max_completion_tokens":2048}'::jsonb WHERE code = 'app_ai_generate_campaign_name';

UPDATE public.ai_using
SET model_id = (SELECT id FROM public.ai_model WHERE code = 'openai_luna_chat')
WHERE code IN ('app_ai_rewrite_content', 'app_ai_write_multi_other_content', 'fb_comment_at_position_rewrite',
               'fb_comment_current_post_rewrite', 'fb_page_post_api_rewrite', 'fb_post_current_identity_ui_rewrite',
               'fb_post_reels_rewrite', 'fb_send_message_rewrite', 'fb_send_page_inbox_message_rewrite',
               'fb_share_post_rewrite', 'fb_type_post_content_rewrite', 'fb_rewrite_source_content_ai');

UPDATE public.ai_prompt
SET prompt_user = E'Viết lại nội dung dưới đây, giữ nguyên ý, ngôn ngữ và cách trình bày (xuống dòng, emoji, chữ in hoa). Không dùng markdown: không **, không #. Chỉ trả về kết quả và không giải thích gì thêm:\r\n[content]'
WHERE id = 1;

UPDATE public.ai_prompt
SET prompt_user = E'Tạo ra [count] phiên bản nội dung khác nhau cho nội dung dưới đây, mỗi nội dung phân tách nhau bởi dấu "|", vui lòng chỉ trả lời và không giải thích gì thêm. Không dùng markdown (không **, không #), không đánh số hay ghi "Phiên bản" trước mỗi nội dung. Nội dung là:\r\n\r\n[content]'
WHERE id = 2;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('ai.model_fallbacks', '{"anthropic_haiku_5_5_chat_compat":"openai_luna_chat"}',
        'V644: gọi ai_model (theo code) lỗi thì gọi lại bằng ai_model này, cùng khuôn yêu cầu. Code đọc khoá này chưa phát hành tại thời điểm V644.',
        false, true);

DO $post$
DECLARE v_haiku bigint; v_luna bigint;
BEGIN
  SELECT id INTO v_haiku FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat';
  SELECT id INTO v_luna FROM public.ai_model WHERE code = 'openai_luna_chat';
  IF (SELECT count(*) FROM public.ai_using WHERE model_id = v_haiku) <> 10 THEN RAISE EXCEPTION 'V644: số mã dùng Haiku khác 10'; END IF;
  IF (SELECT count(*) FROM public.ai_using WHERE model_id = v_luna) <> 12 THEN RAISE EXCEPTION 'V644: số mã dùng luna chat khác 12'; END IF;
  IF (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 1) IS DISTINCT FROM 'ef7c3e20fee46ef5f25ef4e51f4cca51'
     OR (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 2) IS DISTINCT FROM '6933cbed6ece1318859a25227ac6eb95' THEN
    RAISE EXCEPTION 'V644: lời dặn 1 / 2 sau khi đổi không đúng';
  END IF;
  IF (SELECT api_key FROM public.ai_model WHERE id = v_haiku) IS DISTINCT FROM (SELECT api_key FROM public.ai_model WHERE id = 24)
     OR (SELECT api_key FROM public.ai_model WHERE id = v_luna) IS DISTINCT FROM (SELECT api_key FROM public.ai_model WHERE id = 16) THEN
    RAISE EXCEPTION 'V644: khoá của dòng ai_model mới không khớp dòng có sẵn';
  END IF;
END $post$;

COMMIT;