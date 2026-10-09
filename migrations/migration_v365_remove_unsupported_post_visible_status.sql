BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='2s';
SET LOCAL enable_seqscan=off;
SET LOCAL jit=off;
-- Block array-filter edits briefly; FK references serialize on the status row lock.
LOCK TABLE public.auto_automation_trigger_statuses IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$ BEGIN
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
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v365_remove_unsupported_post_visible_status') THEN RAISE EXCEPTION 'Migration already applied'; END IF;
 PERFORM id FROM public.auto_status WHERE id=53 FOR UPDATE;
 IF (SELECT md5(to_jsonb(s)::text) FROM public.auto_status s WHERE id=53) IS DISTINCT FROM '8dd41aac9d84779af5bf7ae73a362b2a' THEN RAISE EXCEPTION 'Status identity/checksum changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE status_id=53)
 OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE sub_status_id=53)
 OR EXISTS(SELECT 1 FROM public.auto_account_action_status_policies WHERE status_id=53)
 OR EXISTS(SELECT 1 FROM public.auto_error WHERE detail_status_id=53 OR detail_status='đã hiển thị bài')
 OR EXISTS(SELECT 1 FROM public.auto_campaign_action_detail_statuses WHERE status_id=53 OR status_value='đã hiển thị bài')
 OR EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE 53=ANY(sub_status_ids) OR status_value='đã hiển thị bài')
 THEN RAISE EXCEPTION 'Status has references; preserve historical data'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_blocks b WHERE to_jsonb(b)::text ~ '(campaign_detail_post_visible|postVisible)')
 OR EXISTS(SELECT 1 FROM public.auto_workflows w WHERE to_jsonb(w)::text ~ '(campaign_detail_post_visible|postVisible)')
 THEN RAISE EXCEPTION 'Live producer/config changed; reconcile first'; END IF;
END $preflight$;
DELETE FROM public.auto_status WHERE id=53 AND code='campaign_detail_post_visible' AND md5(to_jsonb(auto_status)::text)='8dd41aac9d84779af5bf7ae73a362b2a';
DO $verify$ BEGIN IF EXISTS(SELECT 1 FROM public.auto_status WHERE id=53 OR code='campaign_detail_post_visible') THEN RAISE EXCEPTION 'Status deletion failed'; END IF; END $verify$;
COMMIT;
