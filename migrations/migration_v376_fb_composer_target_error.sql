BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_error WHERE id=94 FOR UPDATE;
DO $preflight$ BEGIN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v376_%') THEN RAISE EXCEPTION 'v376 already applied'; END IF;
    IF md5((jsonb_build_object('table','auto_error','exists',to_regclass('public.auto_error') IS NOT NULL,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass('public.auto_error') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid=to_regclass('public.auto_error')),
    'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid=to_regclass('public.auto_error')),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename='auto_error'),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=to_regclass('public.auto_error') AND NOT tgisinternal),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_error'),
    'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid=to_regclass('public.auto_error')),
    'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name='auto_error'),
    'sequence',(SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_error_id_seq')) #- '{sequence,last_value}')::text) IS DISTINCT FROM 'bab9ccbca0c4a85db237c122edd65485' THEN RAISE EXCEPTION 'v376 schema drift'; END IF;
    IF (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e) IS DISTINCT FROM '505006cbd6457d3a604a99c0d1402c54' OR (SELECT md5(to_jsonb(e)::text) FROM public.auto_error e WHERE id=94) IS DISTINCT FROM 'e92aed4c2b6a4de72381536d538450ee' THEN RAISE EXCEPTION 'v376 catalog drift'; END IF;
  END $preflight$;
  UPDATE public.auto_error SET update_status_campaign=NULL,updated_at=clock_timestamp()
    WHERE id=94 AND error_code='err_fb_composer_editor_not_found';
  DO $postflight$ BEGIN
    IF (SELECT to_jsonb(e)-'updated_at' FROM public.auto_error e WHERE id=94) IS DISTINCT FROM ('{"count_consecutive_errors":null,"counts_toward_bad_target":false,"counts_toward_limit":false,"created_at":"2026-10-06T03:37:29.593089+00:00","detail_mode":"inherit","detail_status":null,"detail_status_id":null,"disable_action_codes":[],"disable_action_days":null,"disable_action_mode":"fixed_minutes","disable_action_time":null,"error_code":"err_fb_composer_editor_not_found","error_desc":"Phạm vi: Đã yêu cầu mở composer nhưng không có editor hoặc bị hộp thoại khác che.\n\nTên/nhóm tương đương trong tài liệu (không thêm policy trùng): err_fb_post_composer_not_open\n\nGiới hạn cấu hình / cần triển khai sau: Đóng popup, nhận diện form mua bán và thử lại có giới hạn cần runtime. Không suy ra checkpoint/chặn từ timeout; không tự đặt thời gian khóa.\n\nv346 chỉ bổ sung danh mục DB. Nhận diện mã và hành vi chưa được tích hợp vào runtime; is_active=true không tự nhận diện lỗi mới.\n\nNguồn: Danh_sach_loi_Facebook_auto_28092026.xlsx / Danh sách lỗi FB / dòng 21\n\nNguồn: FACEBOOK_ERROR_HANDLING_20260928.xlsx / 1. Danh sách lỗi FB / dòng 20","error_element":null,"error_name":"Không mở được ô nhập bài đăng Facebook","error_type":"external facebook","id":94,"input_effect":null,"is_active":true,"is_delete":false,"noti_campaign":"Không tìm thấy ô đăng bài","noti_running_process":"Không tìm thấy ô đăng bài","time_disable_actions":null,"update_login_status":null,"update_status_account":null,"update_status_campaign":null,"updated_at":"2026-10-09T19:33:34.225876+00:00","zalo_action_codes":[],"zalo_error_codes":[]}'::jsonb-'updated_at') THEN RAISE EXCEPTION 'v376 unexpected target change'; END IF;
    IF (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e WHERE id<>94) IS DISTINCT FROM 'd291b8a531ca1fa0dbd0d9ccf2a0cdb6' THEN RAISE EXCEPTION 'v376 unrelated policy change'; END IF;
  END $postflight$;
COMMIT;
