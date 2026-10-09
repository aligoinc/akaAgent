BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
-- Serialize this small catalog while verifying the complete before snapshot.
LOCK TABLE public.auto_status IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF md5(((jsonb_build_object('table','auto_status','exists',to_regclass('public.auto_status') IS NOT NULL,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass('public.auto_status') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid=to_regclass('public.auto_status')),
    'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid=to_regclass('public.auto_status')),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename='auto_status'),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=to_regclass('public.auto_status') AND NOT tgisinternal),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_status'),
    'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid=to_regclass('public.auto_status')),
    'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name='auto_status'),
    'sequence',(SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_status_id_seq')) #- '{sequence,last_value}'))::text) IS DISTINCT FROM 'cde8f396f77bce466f1e1dcb8c79427d' THEN RAISE EXCEPTION 'v373 status schema drift'; END IF;
 IF (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY t.id),'')) FROM public.auto_status t) IS DISTINCT FROM 'cdd6a6d442804e2bc645e0bd1d74e597' THEN RAISE EXCEPTION 'v373 status catalog drift'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v373_%') THEN RAISE EXCEPTION 'v373 already recorded'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_status WHERE code='campaign_detail_post_approved' OR (component_type='campaign_detail' AND (status_value='đã duyệt bài' OR lower(name)=lower('Đã duyệt bài')))) THEN RAISE EXCEPTION 'v373 duplicate status'; END IF;
 IF (SELECT md5(to_jsonb(b)::text) FROM auto_blocks b WHERE id=31) IS DISTINCT FROM '21335b279cb31cfb4f382d0a1185e59a' THEN RAISE EXCEPTION 'v373 detector changed; reconcile first'; END IF;
END $guard$;
INSERT INTO public.auto_status(code,name,description,status_key,flatform_type,component_type,is_default,is_terminal,can_set_manually,is_active,is_delete,sort_order,status_value,color)
VALUES('campaign_detail_post_approved','Đã duyệt bài','Trạng thái phụ sau đăng bài group Facebook thành công. Theo quy ước hiện có: isPending=false và pendingCheckConclusive=true được hiển thị là Đã duyệt bài (nhánh log Group không cần duyệt bài). Tái sử dụng kết luận detector, không thêm kiểm tra DOM hoặc xác nhận riêng về thao tác duyệt của quản trị viên. Không gán khi kiểm tra chưa kết luận; không suy từ URL công khai. Khi dùng làm subStatusCode không đổi policy Thành công, bộ đếm hoặc xử lý input. Chỉ áp dụng kết quả mới, không sửa detail/note/log lịch sử.','post_approved','facebook','campaign_detail',false,false,false,true,false,220,'đã duyệt bài',NULL);
DO $guard$ BEGIN
 IF (SELECT count(*) FROM public.auto_status)<>41 THEN RAISE EXCEPTION 'v373 unexpected row count'; END IF;
 IF (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.auto_status t WHERE code<>'campaign_detail_post_approved') IS DISTINCT FROM 'cdd6a6d442804e2bc645e0bd1d74e597' THEN RAISE EXCEPTION 'v373 changed existing row'; END IF;
END $guard$;
COMMIT;
