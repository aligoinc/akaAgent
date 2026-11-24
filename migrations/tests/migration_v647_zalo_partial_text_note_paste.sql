-- V647 bản gọn (cùng kết quả với migrations/migration_v647_zalo_partial_text_note.sql; sinh bằng scripts/build-v647-sql.cjs).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v647_%') THEN
    RAISE EXCEPTION 'V647 đã có trong sổ migration, không chạy lại';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure) IS DISTINCT FROM 'ca458543bd12435a39def998ee0268d2' THEN
    RAISE EXCEPTION 'V647: thân aka_agent_engine_report_v1 khác bản đã đọc (md5 ca458543bd12435a39def998ee0268d2), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 61 AND error_code = 'err_zalo_127_message_stranger'
                   AND customer_title = $v647$Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 127)$v647$ AND customer_help IS NULL
                   AND noti_running_process = $v647$Tin nhắn bị trùng lặp hoặc gửi quá nhanh$v647$ AND noti_campaign = $v647$Nội dung bị trùng lặp hoặc gửi quá nhanh, tạm nghỉ gửi tin [x] phút$v647$) THEN
    RAISE EXCEPTION 'V647: auto_error 61 khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 92 AND error_code = 'err_zalo_127_message_stranger'
                   AND action_code IS NULL AND error_class IS NULL
                   AND log_template = $v647$Tin nhắn bị trùng lặp hoặc gửi quá nhanh$v647$ AND campaign_note_template = $v647$Nội dung bị trùng lặp hoặc gửi quá nhanh, tạm nghỉ gửi tin [x] phút$v647$) THEN
    RAISE EXCEPTION 'V647: chính sách 92 khác bản đã đọc';
  END IF;
END $pre$;

DO $fn$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, 'ELSE ''Đã gửi file nhưng gửi nội dung thất bại. '' END || v_log;', ''))) <> length('ELSE ''Đã gửi file nhưng gửi nội dung thất bại. '' END || v_log;') THEN
    RAISE EXCEPTION 'V647: tiền tố cũ không xuất hiện đúng một lần';
  END IF;
  v_new := replace(v_def, 'ELSE ''Đã gửi file nhưng gửi nội dung thất bại. '' END || v_log;', 'ELSE ''Người nhận đã nhận ảnh nhưng chưa nhận được chữ. '' END || v_log;');
  EXECUTE v_new;
END $fn$;

UPDATE public.auto_error
   SET customer_title = $v647$Zalo chặn tin nhắn người lạ vì gửi quá nhanh$v647$, customer_help = $v647$Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây.$v647$,
       noti_running_process = $v647$Zalo chặn tin chữ vì gửi quá nhanh. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây$v647$, noti_campaign = $v647$Zalo chặn tin nhắn người lạ vì gửi quá nhanh, tạm nghỉ gửi tin [x] phút. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây.$v647$, updated_at = now()
 WHERE id = 61 AND error_code = 'err_zalo_127_message_stranger';

UPDATE public.auto_outcome_policies
   SET log_template = $v647$Zalo chặn tin chữ vì gửi quá nhanh. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây$v647$, campaign_note_template = $v647$Zalo chặn tin nhắn người lạ vì gửi quá nhanh, tạm nghỉ gửi tin [x] phút. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây.$v647$
 WHERE id = 92 AND error_code = 'err_zalo_127_message_stranger';

DO $post$
DECLARE r record;
BEGIN
  SELECT md5(p.prosrc) AS m, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl::text AS acl INTO r
    FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF r.m IS DISTINCT FROM '488761c97f91872d0e548c817f8f9ed9' THEN RAISE EXCEPTION 'V647: md5 thân hàm sau khi đổi là %, cần 488761c97f91872d0e548c817f8f9ed9', r.m; END IF;
  IF r.owner <> 'postgres' OR NOT r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'V647: thuộc tính hàm đổi (%, %, %)', r.owner, r.prosecdef, r.proconfig;
  END IF;
  IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' THEN
    RAISE EXCEPTION 'V647: quyền hàm đổi: %', r.acl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 61 AND customer_title = $v647$Zalo chặn tin nhắn người lạ vì gửi quá nhanh$v647$
                   AND noti_running_process = $v647$Zalo chặn tin chữ vì gửi quá nhanh. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây$v647$ AND noti_campaign = $v647$Zalo chặn tin nhắn người lạ vì gửi quá nhanh, tạm nghỉ gửi tin [x] phút. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây.$v647$) THEN
    RAISE EXCEPTION 'V647: auto_error 61 chưa đổi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 92 AND log_template = $v647$Zalo chặn tin chữ vì gửi quá nhanh. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây$v647$
                   AND campaign_note_template = $v647$Zalo chặn tin nhắn người lạ vì gửi quá nhanh, tạm nghỉ gửi tin [x] phút. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây.$v647$) THEN
    RAISE EXCEPTION 'V647: chính sách 92 chưa đổi';
  END IF;
END $post$;
