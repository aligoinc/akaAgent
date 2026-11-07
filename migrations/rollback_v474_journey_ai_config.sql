-- Rollback V474: chỉ xóa đúng cấu hình trợ lý Quy trình (không đụng cấu hình AI khác).
DELETE FROM public.ai_form_configs WHERE code = 'app_journey_draft' AND web_section_id = 'journey.draft';
