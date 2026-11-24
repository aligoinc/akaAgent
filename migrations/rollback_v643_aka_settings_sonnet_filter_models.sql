-- Gỡ V643: box "Điều kiện tìm kiếm bài post" về gpt-6.1-sol (ai_model 21) với khuôn cũ, lọc bài Comment seeding bản cũ về gpt-5-nano (ai_model 1),
-- tắt hai dòng ai_model V643 thêm (không xoá: ai_log có khoá ngoại tới ai_model). Chỉ dữ liệu.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs c JOIN public.ai_model m ON m.id = c.model_id
                 WHERE c.id = 17 AND m.code = 'campaign_form_aka_settings_sonnet_5_5') THEN
    RAISE EXCEPTION 'Gỡ V643: ai_form_configs 17 không còn dùng dòng Sonnet của V643, dừng';
  END IF;
END $pre$;

UPDATE public.ai_form_configs
SET model_id = 21,
    request_options = '{}'::jsonb,
    output_schema = jsonb_set(output_schema, '{properties,changes,properties,commentPostSort}',
                              '{"enum":["most_relevant","recent_activity","new_posts",null],"type":["string","null"]}'::jsonb)
WHERE id = 17;

UPDATE public.ai_using SET model_id = 1 WHERE code = 'fb_prepare_seeding_iterations_ai_filter' AND model_id = 16;

UPDATE public.ai_model SET is_active = false WHERE code IN ('campaign_form_aka_settings_sonnet_5_5', 'fb_ai_content_filter_haiku_5_5');

COMMIT;
