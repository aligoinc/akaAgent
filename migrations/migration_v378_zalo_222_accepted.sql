BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_error WHERE id=31 FOR UPDATE;
DO $preflight$ BEGIN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v378_%') THEN RAISE EXCEPTION 'v378 already applied'; END IF;
    IF md5((jsonb_build_object('table','auto_error','exists',to_regclass('public.auto_error') IS NOT NULL,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass('public.auto_error') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid=to_regclass('public.auto_error')),
    'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid=to_regclass('public.auto_error')),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename='auto_error'),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=to_regclass('public.auto_error') AND NOT tgisinternal),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_error'),
    'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid=to_regclass('public.auto_error')),
    'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name='auto_error'),
    'sequence',(SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_error_id_seq')) #- '{sequence,last_value}')::text) IS DISTINCT FROM 'bab9ccbca0c4a85db237c122edd65485' THEN RAISE EXCEPTION 'v378 schema drift'; END IF;
    IF (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e) IS DISTINCT FROM 'e66083683f59512251c14549d5452ca4' OR (SELECT md5(to_jsonb(e)::text) FROM public.auto_error e WHERE id=31) IS DISTINCT FROM '53b9843ed5579daa2606964f145c0e35' THEN RAISE EXCEPTION 'v378 catalog drift'; END IF;
    IF jsonb_build_object(
  'success_status',(SELECT to_jsonb(s) FROM public.auto_status s WHERE id=20),
  'success_policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.auto_account_action_status_policies p WHERE status_id=20 AND (action_code IS NULL OR action_code='zalo_add_friend')),
  'action',(SELECT to_jsonb(a) FROM public.auto_account_actions a WHERE code='zalo_add_friend')) IS DISTINCT FROM '{"action":{"code":"zalo_add_friend","created_at":"2026-06-10T06:55:23.96107+00:00","flatform_type":"zalo","id":20,"is_active":true,"is_delete":false,"name":"Zalo - Kết bạn","updated_at":"2026-06-26T03:20:43.831324+00:00"},"success_policies":[{"action_code":null,"bad_target_effect":"reset","counts_toward_limit":true,"created_at":"2026-10-09T10:23:33.056576+00:00","description":"Thao tác chính đã được xác nhận thành công: tính lượt, đặt lại chuỗi lỗi; chốt input sau khi tổng hợp các hành động. Gửi yêu cầu thành công không cần chờ bên nhận chấp thuận.","id":1,"input_effect":"complete","is_active":true,"is_delete":false,"report_group":"success","reset_error_streak":true,"status_id":20,"updated_at":"2026-10-09T10:23:33.056576+00:00"}],"success_status":{"can_set_manually":false,"code":"campaign_detail_success","color":null,"component_type":"campaign_detail","created_at":"2026-06-05T02:49:35.117406+00:00","description":"Milestone hành động thành công.","flatform_type":"all","id":20,"is_active":true,"is_default":true,"is_delete":false,"is_terminal":true,"name":"Thành công","sort_order":10,"status_key":"success","status_value":"thành công","updated_at":"2026-06-05T02:49:35.117406+00:00"}}'::jsonb THEN RAISE EXCEPTION 'v378 dependent policy drift'; END IF;
  END $preflight$;
  UPDATE public.auto_error SET error_name='Đã chấp nhận lời mời kết bạn',
    error_desc='Zalo trả mã 222 “Tự động kết bạn”: đối phương đã gửi lời mời đến, thao tác kết bạn được xử lý thành chấp nhận lời mời.',
    noti_running_process='Đã chấp nhận lời mời kết bạn',
    noti_campaign='Đã chấp nhận lời mời kết bạn',
    detail_status='thành công',
    counts_toward_limit='true',
    zalo_action_codes=ARRAY['zalo_add_friend']::text[],updated_at='2026-10-09 21:34:09.54357+00'::timestamptz
    WHERE id=31 AND error_code='err_zalo_friend_request_sent';
  DO $postflight$ BEGIN
    IF (SELECT to_jsonb(e) FROM public.auto_error e WHERE id=31) IS DISTINCT FROM ('{"count_consecutive_errors":null,"counts_toward_bad_target":false,"counts_toward_limit":true,"created_at":"2026-06-10T18:03:47.067016+00:00","detail_mode":null,"detail_status":"thành công","detail_status_id":null,"disable_action_codes":[],"disable_action_days":null,"disable_action_mode":"fixed_minutes","disable_action_time":null,"error_code":"err_zalo_friend_request_sent","error_desc":"Zalo trả mã 222 “Tự động kết bạn”: đối phương đã gửi lời mời đến, thao tác kết bạn được xử lý thành chấp nhận lời mời.","error_element":null,"error_name":"Đã chấp nhận lời mời kết bạn","error_type":"external zalo","id":31,"input_effect":null,"is_active":true,"is_delete":false,"noti_campaign":"Đã chấp nhận lời mời kết bạn","noti_running_process":"Đã chấp nhận lời mời kết bạn","time_disable_actions":null,"update_login_status":null,"update_status_account":null,"update_status_campaign":null,"updated_at":"2026-06-10T18:03:47.067016+00:00","zalo_action_codes":["zalo_add_friend"],"zalo_error_codes":["222"]}'::jsonb || jsonb_build_object('updated_at','2026-10-09 21:34:09.54357+00'::timestamptz)) THEN RAISE EXCEPTION 'v378 unexpected target change'; END IF;
    IF (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e WHERE id<>31) IS DISTINCT FROM '5b17be38a7294fb275804d5713aa89e3' THEN RAISE EXCEPTION 'v378 unrelated policy change'; END IF;
  END $postflight$;
COMMIT;
