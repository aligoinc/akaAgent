-- migration_v575_engine_specific_codes_wait_note: engine v2 phát mã cụ thể thay câu thô, NET01 cho lỗi mạng khi mở trang Facebook, hai mã lỗi tệp theo nguyên nhân, câu chờ
-- hạn mức ngày chỉ ghi ngày. Anh chốt 18/11/2026 (docs/ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md). Sinh bằng scripts/build-v575-sql.cjs, không sửa tay.
--   * FB41 (comment không thấy ô bình luận): dấu hiệu "waitForSelector timeout" ở dòng comment (Desktop gắn mã); như FB42 hôm nay ở đăng
--     nhóm, comment seeding, trang cá nhân, newsfeed. Up tin tự phát FB41 từ block (V472) nên giữ dòng 339 như bộ cũ.
--   * FB46 mới (hộp thư Page không thấy ô nhập tin) thay err_undefined block tự báo; như SYS99 hôm nay ở hộp thư Page.
--   * Lỗi tệp: CFG20 mới "tệp không còn trên máy", CFG01 đổi câu thành "không tải được"; cả hai dừng chiến dịch ngay, data giữ lại (cách
--     của CFG01 trên Zalo). Facebook: luật theo câu lỗi trong block (trước đây SYS99). Zalo: Desktop gửi CFG20 từ bản app sau, tới lúc đó
--     Zalo vẫn CFG01 cho cả hai nguyên nhân.
--   * ERR_NETWORK_IO_SUSPENDED / ERR_INTERNET_DISCONNECTED / ERR_NETWORK_CHANGED khi mở trang Facebook trước lúc gửi: NET01 (data về hàng
--     đợi, không cộng chuỗi; trước đây FB44).
--   * aka_agent_engine_wait_note: chờ tới 00:00 ghi "chạy tiếp vào ngày DD/MM" (LIM01 và mọi mã chờ qua ngày, Zalo lẫn Facebook).
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v575_%') THEN
    RAISE EXCEPTION 'V575: sổ migration đã có migration_v575_%%, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN ('err_fb_page_inbox_message_box_not_found', 'err_media_local_file_missing') OR public_code IN ('FB46', 'CFG20')) THEN
    RAISE EXCEPTION 'V575: đã có mã FB46 / CFG20';
  END IF;
  IF (SELECT count(*) FROM public.auto_error WHERE is_active AND NOT is_delete AND (error_code, public_code) IN
      (('err_fb_comment_box_not_found', 'FB41'), ('err_network_offline', 'NET01'), ('error_limit_in_day', 'LIM01'), ('err_engine_fb_action_failed', 'FB42'),
       ('err_undefined', 'SYS99'))) <> 5 THEN
    RAISE EXCEPTION 'V575: thiếu mã FB41 / NET01 / LIM01 / FB42 / SYS99';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_media_file_missing' AND public_code = 'CFG01' AND is_active AND NOT is_delete
                   AND customer_title = 'Không dùng được tệp media của chiến dịch' AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V575: câu của CFG01 đã đổi';
  END IF;
  IF (SELECT count(*) FROM public.auto_outcome_policies WHERE error_code = 'err_media_file_missing' AND is_active AND NOT is_delete) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_media_file_missing' AND is_active AND NOT is_delete
                      AND action_code IS NULL AND status_id IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL AND error_class IS NULL
                      AND log_template = 'Không dùng được tệp media của chiến dịch' AND campaign_note_template = 'Không dùng được tệp media của chiến dịch') THEN
    RAISE EXCEPTION 'V575: chính sách CFG01 khác bản đọc 18/11';
  END IF;
  SELECT md5(value) INTO v_md5 FROM public.auto_system_settings WHERE key = 'facebook.error_signs';
  IF v_md5 IS DISTINCT FROM '7e25dd65faab148bcf55b93654852a16' THEN RAISE EXCEPTION 'V575: dòng facebook.error_signs đã đổi (md5 %)', v_md5; END IF;
  SELECT md5(pg_get_functiondef('public.aka_agent_engine_wait_note(text, timestamp with time zone)'::regprocedure)) INTO v_md5;
  IF v_md5 IS DISTINCT FROM 'a288740dc85596850d80d0f44d60f7c9' THEN RAISE EXCEPTION 'V575: aka_agent_engine_wait_note đã đổi (md5 %)', v_md5; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v575')
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v575') THEN
    RAISE EXCEPTION 'V575: đã có dòng nguồn v575';
  END IF;
END $pre$;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
  ('engine v2', 'err_fb_page_inbox_message_box_not_found', 'Không thấy ô nhập tin nhắn trong hộp thư Page', 'V575 (engine v2): Không thấy ô nhập tin nhắn trong hộp thư Page', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'FB46', 'ui_changed', 'Không thấy ô nhập tin nhắn trong hộp thư Page', 'Mở tab trình duyệt của tài khoản để kiểm tra.'),
  ('engine v2', 'err_media_local_file_missing', 'Ảnh, video hoặc tệp của chiến dịch không còn trên máy', 'V575 (engine v2): Ảnh, video hoặc tệp của chiến dịch không còn trên máy', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'CFG20', 'content_config', 'Ảnh, video hoặc tệp của chiến dịch không còn trên máy', 'Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch.');

-- CFG01: chỉ câu cho khách của engine (bộ cũ đọc noti_running_process / noti_campaign, giữ nguyên).
UPDATE public.auto_error SET customer_title = 'Không tải được ảnh, video hoặc tệp của chiến dịch', customer_help = 'Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch.', updated_at = now()
 WHERE error_code = 'err_media_file_missing' AND customer_title = 'Không dùng được tệp media của chiến dịch';

INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode, campaign_effect, account_effect, login_effect, description, source) VALUES
  ('err_fb_comment_box_not_found', 'fb_comment', 'facebook_group_post', NULL, NULL, '{message}', NULL, 'count', NULL, NULL, NULL, NULL, ARRAY[]::text[], 'fixed_minutes', NULL, NULL, NULL, NULL, NULL, '[anh chốt 18/11] FB41 khi comment (dấu hiệu, trước đây FB42): giữ cách xử lý như FB42 hôm nay (tính lượt), câu {message}.', 'v575'),
  ('err_fb_comment_box_not_found', 'fb_comment', 'facebook_comment_seeding', NULL, NULL, '{message}', NULL, 'count', NULL, NULL, NULL, NULL, ARRAY[]::text[], 'fixed_minutes', NULL, NULL, NULL, NULL, NULL, '[anh chốt 18/11] FB41 khi comment (dấu hiệu, trước đây FB42): giữ cách xử lý như FB42 hôm nay (tính lượt), câu {message}.', 'v575'),
  ('err_fb_comment_box_not_found', 'fb_comment', 'facebook_timeline_post', NULL, NULL, '{message}', NULL, 'count', NULL, NULL, NULL, NULL, ARRAY[]::text[], 'fixed_minutes', NULL, NULL, NULL, NULL, NULL, '[anh chốt 18/11] FB41 khi comment (dấu hiệu, trước đây FB42): giữ cách xử lý như FB42 hôm nay (tính lượt), câu {message}.', 'v575'),
  ('err_fb_comment_box_not_found', 'fb_comment', 'facebook_newsfeed_interaction', NULL, NULL, '{message}', NULL, 'count', NULL, NULL, NULL, NULL, ARRAY[]::text[], 'fixed_minutes', NULL, NULL, NULL, NULL, NULL, '[anh chốt 18/11] FB41 khi comment (dấu hiệu, trước đây FB42): giữ cách xử lý như FB42 hôm nay (tính lượt), câu {message}.', 'v575'),
  ('err_fb_page_inbox_message_box_not_found', 'fb_message_page_inbox_customer', NULL, 22, 'write', 'Không thấy ô nhập tin nhắn trong hộp thư Page', 'Không thấy ô nhập tin nhắn trong hộp thư Page (FB46). Mở tab trình duyệt của tài khoản để kiểm tra.', 'no_count', 'increment', 8, 'complete', 'skip', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'pause', 'none', 'none', '[anh chốt 18/11] FB46: giữ cách xử lý như SYS99 hôm nay ở hộp thư Page, chỉ đổi câu.', 'v575'),
  ('err_media_local_file_missing', NULL, NULL, NULL, 'suppress', 'Ảnh, video hoặc tệp của chiến dịch không còn trên máy', 'Ảnh, video hoặc tệp của chiến dịch không còn trên máy (CFG20). Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch.', 'no_count', 'ignore', NULL, 'requeue', 'continue', ARRAY[]::text[], 'fixed_minutes', 'end_unit', 'full', 'pause', 'none', 'none', '[anh chốt 18/11] CFG20 tệp chỉ có trên máy mà không còn: cách xử lý như CFG01 (dừng ngay, data giữ lại).', 'v575');

UPDATE public.auto_outcome_policies SET log_template = 'Không tải được ảnh, video hoặc tệp của chiến dịch', campaign_note_template = 'Không tải được ảnh, video hoặc tệp của chiến dịch (CFG01). Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch.'
 WHERE error_code = 'err_media_file_missing' AND is_active AND NOT is_delete AND action_code IS NULL AND status_id IS NULL AND campaign_action_id IS NULL
   AND runtime_target IS NULL AND error_class IS NULL AND log_template = 'Không dùng được tệp media của chiến dịch';

UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]},{"code":"err_fb_comment_box_not_found","source":"message","actions":["fb_comment"],"phases":[],"replaces":[],"texts":["waitForSelector timeout"]},{"code":"err_fb_page_inbox_message_box_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":["err_undefined"],"texts":["Không tìm thấy ô để nhập tin nhắn"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '7e25dd65faab148bcf55b93654852a16';

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, note, source, is_active) VALUES
  ('facebook', NULL, 'before_send', 'message_like', '%ERR_NETWORK_IO_SUSPENDED%', 20, 'err_network_offline', '[anh chốt 18/11] ERR_NETWORK_IO_SUSPENDED trước lúc gửi (mở trang): mạng trên máy gián đoạn → NET01, data về hàng đợi.', 'v575', true),
  ('facebook', NULL, 'before_send', 'message_like', '%ERR_INTERNET_DISCONNECTED%', 20, 'err_network_offline', '[anh chốt 18/11] ERR_INTERNET_DISCONNECTED trước lúc gửi (mở trang): mạng trên máy gián đoạn → NET01, data về hàng đợi.', 'v575', true),
  ('facebook', NULL, 'before_send', 'message_like', '%ERR_NETWORK_CHANGED%', 20, 'err_network_offline', '[anh chốt 18/11] ERR_NETWORK_CHANGED trước lúc gửi (mở trang): mạng trên máy gián đoạn → NET01, data về hàng đợi.', 'v575', true),
  ('facebook', NULL, NULL, 'message_like', '%Không dùng được media%local path không tồn tại và không có cloud URL%', 10, 'err_media_local_file_missing', '[anh chốt 18/11] Tệp chỉ có trên máy mà không còn → CFG20 (trước đây SYS99).', 'v575', true),
  ('facebook', NULL, NULL, 'message_like', '%Không dùng được media%', 20, 'err_media_file_missing', '[anh chốt 18/11] Tệp tải từ kho lưu trữ không được / không có nguồn → CFG01 như Zalo (trước đây SYS99).', 'v575', true);

CREATE OR REPLACE FUNCTION public.aka_agent_engine_wait_note(p_error_code text, p_until timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT '⏳ ' || coalesce(e.customer_title, e.error_name, 'Tạm chờ') ||
    CASE WHEN p_until IS NULL THEN ''
         -- Chờ tới 00:00 (hạn mức ngày): chiến dịch chạy lại theo giờ đã cài, nên chỉ ghi ngày (anh chốt 18/11/2026).
         WHEN to_char(p_until AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI') = '00:00'
           THEN ', chạy tiếp vào ngày ' || to_char(p_until AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM')
         ELSE ', chạy tiếp lúc ' || public.aka_agent_engine_format_vn(p_until) END ||
    CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
  FROM (SELECT 1) one LEFT JOIN public.auto_error e ON e.error_code = p_error_code
$function$;

DO $post$
DECLARE v_new jsonb; v_old jsonb; v_text text; v_n int;
BEGIN
  SELECT md5(value) INTO v_text FROM public.auto_system_settings WHERE key = 'facebook.error_signs';
  IF v_text IS DISTINCT FROM '797af9742857b712e1144f5d230b2137' THEN RAISE EXCEPTION 'V575 postflight: dòng facebook.error_signs (md5 %)', v_text; END IF;
  SELECT md5(pg_get_functiondef('public.aka_agent_engine_wait_note(text, timestamp with time zone)'::regprocedure)) INTO v_text;
  IF v_text IS DISTINCT FROM '17e1824c9f1bdf6adddb432e0a60d484' THEN RAISE EXCEPTION 'V575 postflight: thân câu chờ (md5 %)', v_text; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = 'v575' AND is_active AND NOT is_delete;
  IF v_n <> 6 THEN RAISE EXCEPTION 'V575 postflight: % dòng chính sách mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_signal_rules WHERE source = 'v575' AND is_active;
  IF v_n <> 5 THEN RAISE EXCEPTION 'V575 postflight: % luật mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code = 'err_media_file_missing' AND is_active AND NOT is_delete
    AND log_template = 'Không tải được ảnh, video hoặc tệp của chiến dịch' AND campaign_note_template = 'Không tải được ảnh, video hoặc tệp của chiến dịch (CFG01). Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch.';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V575 postflight: câu chính sách CFG01'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_error WHERE error_code = 'err_media_file_missing' AND customer_title = 'Không tải được ảnh, video hoặc tệp của chiến dịch' AND customer_help = 'Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch.';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V575 postflight: câu CFG01'; END IF;

  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_group_post', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_group_post', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_group_post', 'desktop', 'before_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_group_post', 'desktop', 'after_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_group_post', 'desktop', 'after_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_group_post', 'desktop', 'after_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_group_post', 'desktop', 'in_flight');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_group_post', 'desktop', 'in_flight');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_group_post', 'desktop', 'in_flight', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_comment_seeding', 'desktop', 'before_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'after_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'after_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_comment_seeding', 'desktop', 'after_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'in_flight');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'in_flight');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_comment_seeding', 'desktop', 'in_flight', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_timeline_post', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_timeline_post', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_timeline_post', 'desktop', 'before_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_timeline_post', 'desktop', 'after_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_timeline_post', 'desktop', 'after_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_timeline_post', 'desktop', 'after_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_timeline_post', 'desktop', 'in_flight');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_timeline_post', 'desktop', 'in_flight');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_timeline_post', 'desktop', 'in_flight', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'before_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'after_send');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'after_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'after_send', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'in_flight');
  v_old := public.aka_agent_engine_resolve_policy('err_engine_fb_action_failed', NULL, 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'in_flight');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_comment_box_not_found', 'fb_comment', 'facebook_newsfeed_interaction', 'desktop', 'in_flight', 'err_engine_fb_action_failed', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_message_box_not_found', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'in_flight');
  v_old := public.aka_agent_engine_resolve_policy('err_undefined', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'in_flight');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_page_inbox_message_box_not_found', 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'in_flight', 'err_undefined', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_message_box_not_found', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_undefined', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_page_inbox_message_box_not_found', 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send', 'err_undefined', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_fb_page_inbox_message_box_not_found', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'after_send');
  v_old := public.aka_agent_engine_resolve_policy('err_undefined', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'after_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_fb_page_inbox_message_box_not_found', 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'after_send', 'err_undefined', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'fb_post_timeline', 'facebook_timeline_post', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'fb_post_timeline', 'facebook_timeline_post', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'fb_post_timeline', 'facebook_timeline_post', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'fb_comment', 'facebook_comment_seeding', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'fb_comment', 'facebook_comment_seeding', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'fb_message', 'facebook_message_uid', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'fb_message', 'facebook_message_uid', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'fb_message', 'facebook_message_uid', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_message_stranger', 'zalo_message_phone', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_message_stranger', 'zalo_message_phone', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_message_stranger', 'zalo_message_phone', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_message_stranger', 'zalo_message_phone', 'fly', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_message_stranger', 'zalo_message_phone', 'fly', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_message_stranger', 'zalo_message_phone', 'fly', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_message_group', 'zalo_message_group', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_message_group', 'zalo_message_group', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_message_group', 'zalo_message_group', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_message_group', 'zalo_message_group', 'fly', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_message_group', 'zalo_message_group', 'fly', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_message_group', 'zalo_message_group', 'fly', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_message_friend', 'zalo_message_friend', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_message_friend', 'zalo_message_friend', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_message_friend', 'zalo_message_friend', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_message_friend', 'zalo_message_friend', 'fly', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_message_friend', 'zalo_message_friend', 'fly', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_message_friend', 'zalo_message_friend', 'fly', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_add_friend', 'zalo_message_phone', 'desktop', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_add_friend', 'zalo_message_phone', 'desktop', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_add_friend', 'zalo_message_phone', 'desktop', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;
  v_new := public.aka_agent_engine_resolve_policy('err_media_local_file_missing', NULL, 'zalo_add_friend', 'zalo_message_phone', 'fly', 'before_send');
  v_old := public.aka_agent_engine_resolve_policy('err_media_file_missing', NULL, 'zalo_add_friend', 'zalo_message_phone', 'fly', 'before_send');
  IF (v_new - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') IS DISTINCT FROM (v_old - 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes') OR v_new->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', 'err_media_local_file_missing', 'zalo_add_friend', 'zalo_message_phone', 'fly', 'before_send', 'err_media_file_missing', v_new, v_old;
  END IF;

  -- Up tin: FB41 do block tự phát (V472) giữ như bộ cũ (dòng 339: không tính lượt, câu đã duyệt).
  v_new := public.aka_agent_engine_resolve_policy('err_fb_comment_box_not_found', NULL, 'fb_comment', 'facebook_comment_seeding_post', 'desktop', 'after_send');
  IF v_new->>'quota_effect' IS DISTINCT FROM 'no_count' OR v_new->>'log_template' IS DISTINCT FROM 'Không thấy ô bình luận dưới bài' THEN
    RAISE EXCEPTION 'V575 postflight: FB41 của Up tin đổi: %', v_new;
  END IF;

  -- NET01 khi mở trang Facebook: data về hàng đợi (anh chốt), không cộng chuỗi.
  v_new := public.aka_agent_engine_resolve_policy('err_network_offline', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send');
  IF v_new->>'target_effect' IS DISTINCT FROM 'requeue' OR v_new->>'target_streak_effect' IS DISTINCT FROM 'ignore' THEN
    RAISE EXCEPTION 'V575 postflight: NET01 Facebook %', v_new;
  END IF;

  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'before_send', '{"kind":"block","code":"navigate:www.facebook.com/groups/1","message":"ERR_NETWORK_IO_SUSPENDED (-331) loading ''https://www.facebook.com/groups/1''"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_network_offline' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'ERR_NETWORK_IO_SUSPENDED (-331) loading ''https://www.facebook.com/groups/1''', 'before_send', v_text, 'err_network_offline';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'before_send', '{"kind":"block","code":"navigate:www.facebook.com/groups/1","message":"ERR_INTERNET_DISCONNECTED (-106) loading ''https://www.facebook.com/groups/1''"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_network_offline' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'ERR_INTERNET_DISCONNECTED (-106) loading ''https://www.facebook.com/groups/1''', 'before_send', v_text, 'err_network_offline';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_comment', 'before_send', '{"kind":"exception","message":"net::ERR_NETWORK_CHANGED"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_network_offline' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'net::ERR_NETWORK_CHANGED', 'before_send', v_text, 'err_network_offline';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'in_flight', '{"kind":"block","code":"navigate:www.facebook.com/groups/1","message":"ERR_NETWORK_IO_SUSPENDED (-331) loading ''https://www.facebook.com/groups/1''"}'::jsonb) c;
  IF v_text = 'err_network_offline' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'ERR_NETWORK_IO_SUSPENDED (-331) loading ''https://www.facebook.com/groups/1''', 'in_flight', v_text, 'khác NET01';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'before_send', '{"kind":"exception","message":"Không dùng được media \"a.jpg\": local path không tồn tại và không có cloud URL fallback"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_media_local_file_missing' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'Không dùng được media "a.jpg": local path không tồn tại và không có cloud URL fallback', 'before_send', v_text, 'err_media_local_file_missing';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'before_send', '{"kind":"exception","message":"Không dùng được media \"a.jpg\": local path không tồn tại và cloud URL không tải được (HTTP 404)"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_media_file_missing' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'Không dùng được media "a.jpg": local path không tồn tại và cloud URL không tải được (HTTP 404)', 'before_send', v_text, 'err_media_file_missing';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_page_inbox_customer', 'before_send', '{"kind":"exception","message":"Không dùng được media \"a.jpg\": không có local path và cloud URL không tải được (The operation was aborted due to timeout)"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_media_file_missing' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'Không dùng được media "a.jpg": không có local path và cloud URL không tải được (The operation was aborted due to timeout)', 'before_send', v_text, 'err_media_file_missing';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'before_send', '{"kind":"block","code":"wait:fb_post_button","message":"waitForSelector timeout: //div"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_engine_fb_ui_not_ready' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'waitForSelector timeout: //div', 'before_send', v_text, 'err_engine_fb_ui_not_ready';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_message_stranger', 'before_send', '{"kind":"engine","code":"media_unavailable","errorCode":"err_media_local_file_missing","message":"Không dùng được media \"a.jpg\": local path không tồn tại và không có cloud URL fallback"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_media_local_file_missing' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'Không dùng được media "a.jpg": local path không tồn tại và không có cloud URL fallback', 'before_send', v_text, 'err_media_local_file_missing';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_comment', 'after_send', '{"kind":"block","code":"status:campaign_detail_failed","errorCode":"err_fb_comment_box_not_found","message":"Không comment được bài thứ 2: không thấy ô bình luận"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_comment_box_not_found' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'Không comment được bài thứ 2: không thấy ô bình luận', 'after_send', v_text, 'err_fb_comment_box_not_found';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_message_page_inbox_customer', 'in_flight', '{"kind":"block","code":"err_fb_page_inbox_message_box_not_found","errorCode":"err_fb_page_inbox_message_box_not_found","message":"Lỗi nhắn tin khách inbox page đến A: Không tìm thấy ô để nhập tin nhắn"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_page_inbox_message_box_not_found' THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', 'Lỗi nhắn tin khách inbox page đến A: Không tìm thấy ô để nhập tin nhắn', 'in_flight', v_text, 'err_fb_page_inbox_message_box_not_found';
  END IF;

  v_text := public.aka_agent_engine_wait_note('error_limit_in_day', timestamptz '2026-11-19 00:00:00+07');
  IF v_text IS DISTINCT FROM '⏳ Đạt giới hạn trong ngày, chạy tiếp vào ngày 19/11 (LIM01)' THEN RAISE EXCEPTION 'V575 postflight: câu chờ ngày: %', v_text; END IF;
  v_text := public.aka_agent_engine_wait_note('error_limit_in_hour', timestamptz '2026-11-18 15:34:00+07');
  IF v_text IS DISTINCT FROM '⏳ Đạt giới hạn trong giờ, chạy tiếp lúc 15:34 18/11 (LIM02)' THEN RAISE EXCEPTION 'V575 postflight: câu chờ giờ: %', v_text; END IF;
  v_text := public.aka_agent_engine_wait_note(NULL, NULL);
  IF v_text IS DISTINCT FROM '⏳ Tạm chờ' THEN RAISE EXCEPTION 'V575 postflight: câu chờ không mã: %', v_text; END IF;
END $post$;

COMMIT;
