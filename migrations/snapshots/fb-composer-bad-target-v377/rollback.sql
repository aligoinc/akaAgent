BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_error WHERE id=94 FOR UPDATE;
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
    'sequence',(SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_error_id_seq')) #- '{sequence,last_value}')::text) IS DISTINCT FROM 'bab9ccbca0c4a85db237c122edd65485' OR (SELECT md5(to_jsonb(e)::text) FROM public.auto_error e WHERE id=94) IS DISTINCT FROM '99a8c6f4766a83f9eae5d40414dde57c' THEN RAISE EXCEPTION 'v377 rollback drift: inspect before restoring'; END IF;
  END $guard$;
  UPDATE public.auto_error SET counts_toward_bad_target='false',updated_at='2026-10-09T20:13:58.02111+00:00'::timestamptz WHERE id=94 AND error_code='err_fb_composer_editor_not_found';
  -- Keep migration history and all campaign/detail/input/log records unchanged.
COMMIT;
