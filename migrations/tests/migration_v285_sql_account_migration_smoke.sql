BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $safe_fixture$
BEGIN
 IF EXISTS(SELECT 1 FROM org_organization WHERE sql_account_id='2147483646')
 OR EXISTS(SELECT 1 FROM aka_customer WHERE public.normalize_phone(phone) IN ('0999999988','0999999986','0999999987'))
 OR EXISTS(SELECT 1 FROM org_customer WHERE public.normalize_phone(phone) IN ('0999999988','0999999986','0999999987'))
 OR EXISTS(SELECT 1 FROM zalo_accounts WHERE zalo_uid='9999999999999999285') THEN
 RAISE EXCEPTION 'v285 smoke sentinel already used'; END IF;
END;
$safe_fixture$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $smoke$
DECLARE p jsonb := '{"sql_account_id":2147483646,"account":{"phone":"0999999988","name":"__v285_rollback_smoke__","customer_name":"__v285_rollback_customer__","email":"test@example.invalid","package_type":"demo","duration_days":null,"expiration_date":"2020-01-02T03:04:05+07:00","max_accounts":0,"max_staff":8,"max_sends_per_day":99,"creator_sql_staff_id":null,"owner_sql_staff_id":null},"product_ids":[3,16,18],"admin_sql_staff_id":10,"skipped_products":[],"staff":[{"id":10,"phone":"0999999986","name":"Admin","email":null,"is_admin":true,"is_active":true},{"id":11,"phone":"0999999987","name":"Staff","email":null,"is_admin":false,"is_active":false}],"groups":[{"id":100,"name":"Root","parent_id":null},{"id":101,"name":"Child","parent_id":100}],"memberships":[{"staff_id":10,"group_id":100,"is_admin":true},{"staff_id":11,"group_id":101,"is_admin":false}],"shops":[{"id":300,"staff_id":10,"name":"Zalo owner","phone":"0999999986","zalo_uid":"9999999999999999285","is_active":true,"session":{"cookie":[{"key":"zpsid","value":"TEST_SESSION_SECRET","domain":"zalo.me","path":"/"}],"imei":"test-imei","userAgent":"test-user-agent"}},{"id":301,"staff_id":11,"name":"Zalo staff","phone":null,"zalo_uid":null,"is_active":false,"session":null}],"skipped_staff":[],"skipped_shops":[],"adjustments":[{"code":"ZALO_LOGIN_REQUIRED","shop_id":301}]}'::jsonb; r jsonb; again jsonb; org_id bigint; admin_id bigint; locked_id bigint; acct_id bigint;
BEGIN
 r := public.akabiz_migrate_sql_account_v1(p);
 org_id := (r->>'organization_id')::bigint;
 IF (r->>'already_migrated')::boolean OR r->'counts'->>'staff_created'<>'2'
 OR r->'counts'->>'products_created'<>'3' OR r->'counts'->>'zalo_accounts_created'<>'2'
 THEN RAISE EXCEPTION 'v285 unexpected smoke counts: %',r; END IF;
 IF (SELECT count(*) FROM org_organization_product WHERE organization_id=org_id AND expiration_date='2020-01-02T03:04:05+07'::timestamptz)<>3
 THEN RAISE EXCEPTION 'v285 expiry changed'; END IF;
 IF (SELECT count(*) FROM auto_accounts WHERE organization_id=org_id AND flatform_type='zalo'
 AND zalo_account_id IS NULL AND login_status='chưa đăng nhập' AND zalo_session IS NULL)<>1
 THEN RAISE EXCEPTION 'v285 logged-out identity failed'; END IF;
 IF (SELECT count(*) FROM auto_accounts WHERE organization_id=org_id AND flatform_type='zalo'
 AND zalo_session IS NOT NULL AND zalo_session_last_verified_at IS NULL)<>1
 THEN RAISE EXCEPTION 'v285 stored session import failed'; END IF;
 IF coalesce(current_setting('aka_agent.sql_migration_org',true),'')<>'' THEN RAISE EXCEPTION 'v285 import context leaked'; END IF;
 again := public.akabiz_migrate_sql_account_v1(jsonb_build_object('sql_account_id',2147483646));
 IF NOT (again->>'already_migrated')::boolean OR again->>'organization_id'<>r->>'organization_id'
 THEN RAISE EXCEPTION 'v285 replay failed'; END IF;
 SELECT id INTO admin_id FROM org_staff WHERE organization_id=org_id AND is_active;
 SELECT id INTO locked_id FROM org_staff WHERE organization_id=org_id AND NOT is_active;
 BEGIN
  INSERT INTO auto_accounts(name,flatform_type,staff_id,organization_id,is_zalo_server,is_zalo_show_web)
   VALUES('__v285_blocked__','zalo',locked_id,org_id,true,false);
  RAISE EXCEPTION 'v285 locked staff guard missing';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'zalo_account_staff_not_active' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO auto_accounts(name,flatform_type,staff_id,organization_id,is_zalo_server,is_zalo_show_web)
   VALUES('__v285_expired__','zalo',admin_id,org_id,true,false);
  RAISE EXCEPTION 'v285 expiry capability guard missing';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'zalo_account_capability_unavailable' THEN RAISE; END IF;
 END;
 SELECT id INTO acct_id FROM auto_accounts WHERE organization_id=org_id AND staff_id=admin_id AND flatform_type='zalo';
 BEGIN
  UPDATE auto_accounts SET is_zalo_server=false WHERE id=acct_id;
  RAISE EXCEPTION 'v285 subtype ownership guard missing';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'zalo_account_subtype_change_claim_required' THEN RAISE; END IF;
 END;
 PERFORM set_config('aka_agent.smoke_result',r::text,true);
END;
$smoke$;
RESET ROLE;
DO $attributes$
DECLARE r record;
BEGIN
 SELECT *,pg_get_userbyid(proowner) AS owner INTO r FROM pg_proc WHERE oid='public.akabiz_migrate_sql_account_v1(jsonb)'::regprocedure;
 IF r.owner<>'postgres' OR NOT r.prosecdef OR r.provolatile<>'v'
 OR NOT r.proconfig @> ARRAY['search_path=pg_catalog, public, private','statement_timeout=60s']
 OR has_function_privilege('anon',r.oid,'EXECUTE') OR has_function_privilege('authenticated',r.oid,'EXECUTE')
 OR NOT has_function_privilege('service_role',r.oid,'EXECUTE') THEN RAISE EXCEPTION 'v285 RPC attributes mismatch'; END IF;
 IF md5(pg_get_functiondef(r.oid))<>'529028a7ad71f71f61212d04062cad4f' THEN RAISE EXCEPTION 'v285 RPC target mismatch'; END IF;
 IF md5(pg_get_functiondef('public.enforce_zalo_account_capability_and_quota()'::regprocedure))<>'1edc48a7985f2268159ad0b605fb205b'
 OR has_function_privilege('service_role','public.enforce_zalo_account_capability_and_quota()','EXECUTE') THEN RAISE EXCEPTION 'v285 trigger mismatch'; END IF;
END;
$attributes$;
SELECT jsonb_build_object('smoke_passed',true,'checks',ARRAY['full_rpc_import','expired_entitlements','locked_staff_import','missing_zalo_identity','stored_session','replay','context_restore','staff_guard','expiry_guard','subtype_claim_guard','backend_acl','target_checksums'],'result',current_setting('aka_agent.smoke_result')::jsonb) AS smoke;

ROLLBACK;
