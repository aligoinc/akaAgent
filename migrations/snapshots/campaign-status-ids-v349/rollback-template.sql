BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.auto_campaign_action_detail_statuses IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.auto_status IN SHARE ROW EXCLUSIVE MODE;
DO $rollback$
DECLARE receipt jsonb := '__V349_RECEIPT__'::jsonb;
BEGIN
 IF md5((jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'comment',col_description(a.attrelid,a.attnum)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.auto_status'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.auto_status'::regclass),
 'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE confrelid='public.auto_status'::regclass),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='auto_status'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.auto_status'::regclass AND NOT tgisinternal),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_status'),
 'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid='public.auto_status'::regclass),
 'sequence_definition',(SELECT to_jsonb(s)-'last_value' FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_status_id_seq')))::text)<>'a37896a201aedb5aafaa15756ed3630e' OR md5((jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'comment',col_description(a.attrelid,a.attnum)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.auto_campaign_action_detail_statuses'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.auto_campaign_action_detail_statuses'::regclass),
 'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE confrelid='public.auto_campaign_action_detail_statuses'::regclass),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='auto_campaign_action_detail_statuses'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.auto_campaign_action_detail_statuses'::regclass AND NOT tgisinternal),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_campaign_action_detail_statuses'),
 'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid='public.auto_campaign_action_detail_statuses'::regclass),
 'sequence_definition',(SELECT to_jsonb(s)-'last_value' FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_campaign_action_detail_statuses_id_seq')))::text)<>'63cb92916fb006817be563d0bcb702ac' THEN RAISE EXCEPTION 'v349 guard: schema changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'statuses') r LEFT JOIN public.auto_status s ON s.id=(r->>'id')::bigint WHERE s.id IS NULL OR s.code<>r->>'code' OR md5(to_jsonb(s)::text)<>r->>'md5') THEN RAISE EXCEPTION 'v349 rollback: status changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r LEFT JOIN public.auto_campaign_action_detail_statuses m ON m.id=(r->>'id')::bigint WHERE m.id IS NULL OR md5(to_jsonb(m)::text)<>r->>'md5') THEN RAISE EXCEPTION 'v349 rollback: mapping changed or used'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_campaign_action_detail_statuses m JOIN jsonb_array_elements(receipt->'statuses') s ON m.status_id=(s->>'id')::bigint WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r WHERE m.id=(r->>'id')::bigint)) THEN RAISE EXCEPTION 'v349 rollback: independent status reference'; END IF;
 IF (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.auto_automation_trigger_statuses t WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r WHERE t.status_mapping_id=(r->>'id')::bigint)) IS DISTINCT FROM
 (SELECT coalesce(jsonb_agg(t ORDER BY (t->>'id')::bigint),'[]'::jsonb) FROM jsonb_array_elements(receipt->'conditions') t WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r WHERE (t->>'status_mapping_id')::bigint=(r->>'id')::bigint)) THEN RAISE EXCEPTION 'v349 rollback: Automation references changed'; END IF;
 UPDATE public.auto_campaign_action_detail_statuses m SET status_id=(r->'before'->>'status_id')::bigint,description=r->'before'->>'description' FROM jsonb_array_elements(receipt->'mappings') r WHERE m.id=(r->>'id')::bigint;
 IF EXISTS(SELECT 1 FROM public.auto_campaign_action_detail_statuses m JOIN jsonb_array_elements(receipt->'statuses') s ON m.status_id=(s->>'id')::bigint) THEN RAISE EXCEPTION 'v349 rollback: references remain'; END IF;
 DELETE FROM public.auto_status s USING jsonb_array_elements(receipt->'statuses') r WHERE s.id=(r->>'id')::bigint;
END $rollback$;
COMMIT;
