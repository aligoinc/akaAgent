-- Gỡ migration_v575_engine_specific_codes_wait_note (chỉ tắt dòng mới, không xoá: auto_engine_outcomes có thể đã giữ mã FB46 / CFG20).
-- Desktop bản có CFG20 (cổng Zalo, đường đăng nhóm) gửi mã thẳng: sau khi gỡ, mã tắt thì DB phân loại theo luật như trước V575.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.aka_agent_engine_wait_note(p_error_code text, p_until timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT '⏳ ' || coalesce(e.customer_title, e.error_name, 'Tạm chờ') ||
    CASE WHEN p_until IS NOT NULL THEN ', chạy tiếp lúc ' || public.aka_agent_engine_format_vn(p_until) ELSE '' END ||
    CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
  FROM (SELECT 1) one LEFT JOIN public.auto_error e ON e.error_code = p_error_code
$function$;
UPDATE public.auto_outcome_signal_rules SET is_active = false, updated_at = now() WHERE source = 'v575' AND is_active;
UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '797af9742857b712e1144f5d230b2137';
UPDATE public.auto_outcome_policies SET log_template = 'Không dùng được tệp media của chiến dịch', campaign_note_template = 'Không dùng được tệp media của chiến dịch'
 WHERE error_code = 'err_media_file_missing' AND is_active AND NOT is_delete AND action_code IS NULL AND status_id IS NULL AND campaign_action_id IS NULL
   AND runtime_target IS NULL AND error_class IS NULL AND log_template = 'Không tải được ảnh, video hoặc tệp của chiến dịch';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = 'v575' AND is_active;
UPDATE public.auto_error SET customer_title = 'Không dùng được tệp media của chiến dịch', customer_help = NULL, updated_at = now()
 WHERE error_code = 'err_media_file_missing' AND customer_title = 'Không tải được ảnh, video hoặc tệp của chiến dịch';
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code IN ('err_fb_page_inbox_message_box_not_found', 'err_media_local_file_missing');
DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_engine_wait_note(text, timestamp with time zone)'::regprocedure)) IS DISTINCT FROM 'a288740dc85596850d80d0f44d60f7c9' THEN
    RAISE EXCEPTION 'Gỡ V575: thân aka_agent_engine_wait_note chưa về bản cũ';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '7e25dd65faab148bcf55b93654852a16' THEN
    RAISE EXCEPTION 'Gỡ V575: dòng facebook.error_signs chưa về bản cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v575' AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v575' AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_media_file_missing' AND customer_title = 'Không dùng được tệp media của chiến dịch' AND customer_help IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_media_file_missing' AND is_active AND NOT is_delete
                      AND log_template = 'Không dùng được tệp media của chiến dịch' AND campaign_note_template = 'Không dùng được tệp media của chiến dịch') THEN
    RAISE EXCEPTION 'Gỡ V575: dữ liệu chưa về bản cũ';
  END IF;
END $post$;
COMMIT;
