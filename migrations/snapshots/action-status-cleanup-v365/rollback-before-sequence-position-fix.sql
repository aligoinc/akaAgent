-- Explicit rollback only; restores exactly one deleted catalog row, never sequence/history.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='2s';
SET LOCAL enable_seqscan=off;
SET LOCAL jit=off;
DO $restore_guard$ BEGIN
 IF md5((jsonb_build_object('table','auto_status','exists',to_regclass('public.auto_status') IS NOT NULL,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass('public.auto_status') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid=to_regclass('public.auto_status')),
    'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid=to_regclass('public.auto_status')),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename='auto_status'),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=to_regclass('public.auto_status') AND NOT tgisinternal),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_status'),
    'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid=to_regclass('public.auto_status')),
    'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name='auto_status'),
    'sequence',(SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_status_id_seq')))::text) IS DISTINCT FROM 'a3af39e2ff19adec1c6b70afee4a4eb4' THEN RAISE EXCEPTION 'auto_status schema drift'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_status WHERE id=53 OR code='campaign_detail_post_visible' OR (component_type='campaign_detail' AND status_value='đã hiển thị bài')) THEN RAISE EXCEPTION 'Status identity already exists; do not overwrite'; END IF;
END $restore_guard$;
INSERT INTO public.auto_status SELECT * FROM jsonb_populate_record(NULL::public.auto_status, $removed_row${"can_set_manually":false,"code":"campaign_detail_post_visible","color":null,"component_type":"campaign_detail","created_at":"2026-10-09T10:23:33.056576+00:00","description":"Quan sát xác nhận bài đã hiển thị; không suy ra từ việc chưa phát hiện chờ duyệt. Khi dùng làm subStatusCode không thay policy chính.","flatform_type":"all","id":53,"is_active":true,"is_default":false,"is_delete":false,"is_terminal":false,"name":"Đã hiển thị bài","sort_order":220,"status_key":"post_visible","status_value":"đã hiển thị bài","updated_at":"2026-10-09T10:23:33.056576+00:00"}$removed_row$::jsonb);
DO $restored$ BEGIN IF (SELECT md5(to_jsonb(s)::text) FROM public.auto_status s WHERE id=53) IS DISTINCT FROM '8dd41aac9d84779af5bf7ae73a362b2a' THEN RAISE EXCEPTION 'Restore checksum mismatch'; END IF; END $restored$;
COMMIT;
