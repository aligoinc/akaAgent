BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_error WHERE id=31 FOR UPDATE;
DO $guard$ BEGIN
    IF md5((jsonb_build_object('table','auto_error','exists',to_regclass('public.auto_error') IS NOT NULL,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass('public.auto_error') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid=to_regclass('public.auto_error')),
    'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid=to_regclass('public.auto_error')),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename='auto_error'),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=to_regclass('public.auto_error') AND NOT tgisinternal),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_error'),
    'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid=to_regclass('public.auto_error')),
    'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name='auto_error'),
    'sequence',(SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_error_id_seq')) #- '{sequence,last_value}')::text) IS DISTINCT FROM 'bab9ccbca0c4a85db237c122edd65485'
      OR (SELECT to_jsonb(e) FROM public.auto_error e WHERE id=31) IS DISTINCT FROM ('{"count_consecutive_errors":null,"counts_toward_bad_target":false,"counts_toward_limit":true,"created_at":"2026-06-10T18:03:47.067016+00:00","detail_mode":null,"detail_status":"thành công","detail_status_id":null,"disable_action_codes":[],"disable_action_days":null,"disable_action_mode":"fixed_minutes","disable_action_time":null,"error_code":"err_zalo_friend_request_sent","error_desc":"Zalo trả mã 222 “Tự động kết bạn”: đối phương đã gửi lời mời đến, thao tác kết bạn được xử lý thành chấp nhận lời mời.","error_element":null,"error_name":"Đã chấp nhận lời mời kết bạn","error_type":"external zalo","id":31,"input_effect":null,"is_active":true,"is_delete":false,"noti_campaign":"Đã chấp nhận lời mời kết bạn","noti_running_process":"Đã chấp nhận lời mời kết bạn","time_disable_actions":null,"update_login_status":null,"update_status_account":null,"update_status_campaign":null,"updated_at":"2026-06-10T18:03:47.067016+00:00","zalo_action_codes":["zalo_add_friend"],"zalo_error_codes":["222"]}'::jsonb || jsonb_build_object('updated_at','2026-10-09 21:34:09.54357+00'::timestamptz)) THEN
      RAISE EXCEPTION 'v378 rollback drift: inspect before restoring'; END IF;
  END $guard$;
  UPDATE public.auto_error SET error_name='Đã gửi lời mời kết bạn',
    error_desc='Zalo báo lời mời kết bạn đã được gửi hoặc đang tồn tại',
    noti_running_process='Đã gửi lời mời',
    noti_campaign='Đã gửi lời mời',
    detail_status='đã gửi lời mời',
    counts_toward_limit='false',
    zalo_action_codes=ARRAY[]::text[],updated_at='2026-06-10T18:03:47.067016+00:00'::timestamptz
    WHERE id=31 AND error_code='err_zalo_friend_request_sent';
  DO $check$ BEGIN IF (SELECT md5(to_jsonb(e)::text) FROM public.auto_error e WHERE id=31) IS DISTINCT FROM '53b9843ed5579daa2606964f145c0e35' THEN RAISE EXCEPTION 'v378 rollback mismatch'; END IF; END $check$;
  -- Restore configuration for future runs only. Preserve history, details, counters and logs.
COMMIT;
