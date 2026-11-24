-- migration_v643_aka_settings_sonnet_filter_models: mô hình AI cho "aka Cài đặt" và lọc bài Facebook (docs/FB_AI_FILTER_PLAN.md, anh yêu cầu 24/11/2026:
-- "đổi nano thành luna 6", "aka cài đặt box này dùng sonnet 5.5", "dùng thêm haiku 5.5 để đánh giá, thêm dòng ai model tương ứng"). Chỉ dữ liệu, không DDL.
-- 1. ai_model mới `campaign_form_aka_settings_sonnet_5_5` (claude-sonnet-5-5) và `fb_ai_content_filter_haiku_5_5` (claude-haiku-5-5, dùng cho bộ mẫu lọc bài:
--    block lọc gọi AI qua ai_using, đường đó chưa gửi được yêu cầu kiểu Claude nên Haiku chưa chạy lọc thật). Khoá chép trong SQL từ dòng Claude có sẵn, không in ra.
-- 2. ai_form_configs 17 (box "Điều kiện tìm kiếm bài post" của Comment seeding) dùng Sonnet 5.5, effort medium. Claude không nhận `enum` đi cùng kiểu
--    ["string","null"] nên bỏ `enum` của commentPostSort (app không kiểm enum của khuôn trong DB, lựa chọn sai vẫn bị parseFacebookAiResponse từ chối).
--    Box 15 (Cấu hình tìm kiếm / Điều kiện của Tìm data) giữ gpt-6.1-sol: khuôn có 38 ô kiểu union, Claude chỉ nhận tối đa 16 (thử thật 24/11 trả 400).
-- 3. ai_using `fb_prepare_seeding_iterations_ai_filter` (lọc bài Comment seeding bản cũ, dùng tới khi V641 đổi block sang mã _v2) gpt-5-nano -> gpt-6-luna.
-- Gỡ: rollback_v643_aka_settings_sonnet_filter_models.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v643_%') THEN
    RAISE EXCEPTION 'V643: sổ migration đã có migration_v643_%%, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model WHERE code IN ('campaign_form_aka_settings_sonnet_5_5', 'fb_ai_content_filter_haiku_5_5')) THEN
    RAISE EXCEPTION 'V643: dòng ai_model đã có';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 27 AND model = 'claude-sonnet-5-5' AND provider = 'claude'
                 AND endpoint = 'https://api.anthropic.com/v1/messages' AND organization_id IS NULL AND coalesce(api_key, '') <> '') THEN
    RAISE EXCEPTION 'V643: ai_model 27 không còn là Claude Sonnet 5.5 dùng chung';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 24 AND model = 'claude-haiku-5-5' AND provider = 'claude'
                 AND endpoint = 'https://api.anthropic.com/v1/messages' AND organization_id IS NULL AND coalesce(api_key, '') <> '') THEN
    RAISE EXCEPTION 'V643: ai_model 24 không còn là Claude Haiku 5.5 dùng chung';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = 16 AND model = 'gpt-6-luna' AND is_active) THEN
    RAISE EXCEPTION 'V643: ai_model 16 không còn là gpt-6-luna';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs WHERE id = 17 AND desktop_section_id = 'campaign.facebook.post_search' AND model_id = 21
                 AND request_options = '{}'::jsonb
                 AND output_schema #> '{properties,changes,properties,commentPostSort}' = '{"enum":["most_relevant","recent_activity","new_posts",null],"type":["string","null"]}'::jsonb) THEN
    RAISE EXCEPTION 'V643: ai_form_configs 17 khác bản đã đọc 24/11';
  END IF;
END $pre$;

DO $pre2$
DECLARE v_enum_fields int;
BEGIN
  SELECT count(*) INTO v_enum_fields FROM public.ai_form_configs c, jsonb_each(c.output_schema #> '{properties,changes,properties}') e(k, v)
   WHERE c.id = 17 AND v ? 'enum';
  IF v_enum_fields <> 1 THEN RAISE EXCEPTION 'V643: ai_form_configs 17 có % ô enum, đọc 24/11 chỉ có 1', v_enum_fields; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_using WHERE code = 'fb_prepare_seeding_iterations_ai_filter' AND model_id = 1) THEN
    RAISE EXCEPTION 'V643: ai_using fb_prepare_seeding_iterations_ai_filter không còn dùng ai_model 1';
  END IF;
END $pre2$;

INSERT INTO public.ai_model (code, model, endpoint, provider, is_active, is_system, default_body, organization_id, api_key)
SELECT 'campaign_form_aka_settings_sonnet_5_5', 'claude-sonnet-5-5', endpoint, provider, true, true, '{"max_tokens":16384}'::jsonb, NULL, api_key
FROM public.ai_model WHERE id = 27;

INSERT INTO public.ai_model (code, model, endpoint, provider, is_active, is_system, default_body, organization_id, api_key)
SELECT 'fb_ai_content_filter_haiku_5_5', 'claude-haiku-5-5', endpoint, provider, true, true, '{"max_tokens":4096}'::jsonb, NULL, api_key
FROM public.ai_model WHERE id = 24;

UPDATE public.ai_form_configs
SET model_id = (SELECT id FROM public.ai_model WHERE code = 'campaign_form_aka_settings_sonnet_5_5'),
    request_options = '{"output_config":{"effort":"medium"}}'::jsonb,
    output_schema = jsonb_set(output_schema, '{properties,changes,properties,commentPostSort}',
                              (output_schema #> '{properties,changes,properties,commentPostSort}') - 'enum')
WHERE id = 17;

UPDATE public.ai_using SET model_id = 16 WHERE code = 'fb_prepare_seeding_iterations_ai_filter' AND model_id = 1;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs c JOIN public.ai_model m ON m.id = c.model_id
                 WHERE c.id = 17 AND m.code = 'campaign_form_aka_settings_sonnet_5_5' AND m.model = 'claude-sonnet-5-5'
                   AND c.output_schema #> '{properties,changes,properties,commentPostSort}' = '{"type":["string","null"]}'::jsonb
                   AND c.request_options = '{"output_config":{"effort":"medium"}}'::jsonb) THEN
    RAISE EXCEPTION 'V643: ai_form_configs 17 sau khi đổi không đúng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_using WHERE code = 'fb_prepare_seeding_iterations_ai_filter' AND model_id = 16) THEN
    RAISE EXCEPTION 'V643: ai_using lọc bài cũ chưa đổi sang gpt-6-luna';
  END IF;
  IF (SELECT count(*) FROM public.ai_model a
      WHERE a.code = 'campaign_form_aka_settings_sonnet_5_5' AND a.api_key = (SELECT api_key FROM public.ai_model WHERE id = 27)
         OR a.code = 'fb_ai_content_filter_haiku_5_5' AND a.api_key = (SELECT api_key FROM public.ai_model WHERE id = 24)) <> 2 THEN
    RAISE EXCEPTION 'V643: khoá của dòng ai_model mới không khớp dòng Claude có sẵn';
  END IF;
END $post$;

COMMIT;