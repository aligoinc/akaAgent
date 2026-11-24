-- migration_v645_ai_revert_non_filter_models: trả các mã AI ngoài bộ lọc bài / comment Facebook về như trước V644 (anh 24/11/2026:
-- "Bạn hiểu nhầm tôi rồi. Tôi chỉ muốn thay đổi model ai cho bộ lọc post và comment fb thôi"), trừ hai nút trong form anh chốt giữ luna
-- ("Nút viết lại trong form, nút tạo nhiều phiên bản nội dung: dùng luna"). Chỉ dữ liệu, không DDL.
-- 1. 15 mã về gpt-5-nano (ai_model 1): đặt tên chiến dịch, đọc ảnh nhập data, chẩn đoán ảnh lỗi, duyệt newsfeed like / comment, 10 mã viết lại
--    nội dung lúc chạy chiến dịch. request_options của app_ai_generate_campaign_name về khuôn Responses cũ. Lời dặn 1 về đúng chữ cũ.
-- 2. Giữ gpt-6-luna (ai_model openai_luna_chat): app_ai_rewrite_content (nút "Viết lại" trong form; mã này cũng là viết lại email mỗi lần gửi)
--    và app_ai_write_multi_other_content (nút tạo nhiều phiên bản). Luna cần câu "không dùng markdown" (thử 60 tin thật: 27/60 có ** khi thiếu, 0/60 khi có):
--    nút "Viết lại" dùng lời dặn riêng `akabiz_rewrite_content_luna` (lời dặn 1 dùng chung với 9 mã về nano nên không sửa ở đó);
--    lời dặn 2 chỉ nút nhiều phiên bản dùng nên giữ bản V644.
-- 3. Giữ: 5 mã lọc bài / comment `_v2` dùng Haiku 5.5 (cổng chat của Anthropic); lỗi thì block V641 sang fb_ai_content_filter_fallback (gpt-6-luna).
-- 4. Tắt ai.model_fallbacks (is_active = false; chỉ để cho code dự phòng chung, không cần nữa). Không dùng lệnh xoá dòng: công cụ apply hỏi xác nhận với
--    lệnh xoá và hộp xác nhận không hiện được bên phía anh (hết hạn 3 lần ngày 24/11).
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
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE code = 'openai_luna_chat' AND model = 'gpt-6-luna' AND is_active) THEN
    RAISE EXCEPTION 'V645: không thấy ai_model openai_luna_chat đang bật';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_prompt WHERE code = 'akabiz_rewrite_content_luna') THEN
    RAISE EXCEPTION 'V645: ai_prompt akabiz_rewrite_content_luna đã có';
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
  IF NOT EXISTS (SELECT 1 FROM public.ai_using WHERE code = 'app_ai_rewrite_content' AND prompt_id = 1)
     OR (SELECT string_agg(code, ',') FROM public.ai_using WHERE prompt_id = 2) IS DISTINCT FROM 'app_ai_write_multi_other_content' THEN
    RAISE EXCEPTION 'V645: lời dặn của hai nút trong form khác bản đọc 24/11';
  END IF;
END $pre$;

UPDATE public.ai_using SET model_id = 1
WHERE code IN ('app_ai_generate_campaign_name', 'app_campaign_import_image_to_data', 'campaign_error_screenshot_diagnosis',
               'fb_newsfeed_check_comment', 'fb_newsfeed_check_like',
               'fb_comment_at_position_rewrite', 'fb_comment_current_post_rewrite', 'fb_page_post_api_rewrite',
               'fb_post_current_identity_ui_rewrite', 'fb_post_reels_rewrite', 'fb_send_message_rewrite',
               'fb_send_page_inbox_message_rewrite', 'fb_share_post_rewrite', 'fb_type_post_content_rewrite',
               'fb_rewrite_source_content_ai');

UPDATE public.ai_using SET request_options = '{"text":{"verbosity":"low"},"reasoning":{"effort":"minimal"},"max_output_tokens":128}'::jsonb
WHERE code = 'app_ai_generate_campaign_name';

-- Nút "Viết lại" (luna) dùng lời dặn riêng = chữ V644 của lời dặn 1; lời dặn 1 về chữ cũ cho 9 mã chạy gpt-5-nano.
INSERT INTO public.ai_prompt (code, name, prompt_system, prompt_user, is_system, is_active)
SELECT 'akabiz_rewrite_content_luna', 'AkaBiz - Rewrite content (gpt-6-luna)', prompt_system, prompt_user, true, true
FROM public.ai_prompt WHERE id = 1;

UPDATE public.ai_using SET prompt_id = (SELECT id FROM public.ai_prompt WHERE code = 'akabiz_rewrite_content_luna')
WHERE code = 'app_ai_rewrite_content';

UPDATE public.ai_prompt SET prompt_user = E'Viết lại nội dung dưới đây, chỉ trả về kết quả và không giải thích gì thêm:\r\n[content]' WHERE id = 1;

UPDATE public.auto_system_settings SET is_active = false WHERE key = 'ai.model_fallbacks';

DO $post$
DECLARE v_luna bigint; v_haiku bigint;
BEGIN
  SELECT id INTO v_luna FROM public.ai_model WHERE code = 'openai_luna_chat';
  SELECT id INTO v_haiku FROM public.ai_model WHERE code = 'anthropic_haiku_5_5_chat_compat';
  IF (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 1) IS DISTINCT FROM '587ca6f3a4e1c94bd9073922bbbac480' THEN
    RAISE EXCEPTION 'V645: lời dặn 1 không về đúng bản cũ';
  END IF;
  IF (SELECT md5(prompt_user) FROM public.ai_prompt WHERE code = 'akabiz_rewrite_content_luna') IS DISTINCT FROM 'ef7c3e20fee46ef5f25ef4e51f4cca51'
     OR (SELECT md5(prompt_user) FROM public.ai_prompt WHERE id = 2) IS DISTINCT FROM '6933cbed6ece1318859a25227ac6eb95' THEN
    RAISE EXCEPTION 'V645: lời dặn của hai nút dùng luna không đúng';
  END IF;
  IF (SELECT string_agg(code, ',' ORDER BY code) FROM public.ai_using WHERE model_id = v_luna)
     IS DISTINCT FROM 'app_ai_rewrite_content,app_ai_write_multi_other_content' THEN
    RAISE EXCEPTION 'V645: luna cổng chat phải còn đúng hai nút trong form';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_using u JOIN public.ai_prompt p ON p.id = u.prompt_id
                 WHERE u.code = 'app_ai_rewrite_content' AND p.code = 'akabiz_rewrite_content_luna' AND p.is_active) THEN
    RAISE EXCEPTION 'V645: nút Viết lại chưa dùng lời dặn riêng';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'ai.model_fallbacks' AND is_active) THEN
    RAISE EXCEPTION 'V645: ai.model_fallbacks còn bật';
  END IF;
  IF (SELECT count(*) FROM public.ai_using WHERE model_id = v_haiku) <> 5
     OR EXISTS (SELECT 1 FROM public.ai_using WHERE model_id = v_haiku AND code NOT LIKE '%\_ai\_filter\_v2') THEN
    RAISE EXCEPTION 'V645: Haiku phải còn đúng 5 mã lọc bài / comment _v2';
  END IF;
END $post$;

COMMIT;