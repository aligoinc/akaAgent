-- Requires scripts/fixtures/account-operation-cleanup-postgres.sql in an
-- isolated local database. The guard below intentionally refuses production.
BEGIN;
DO $smoke$
DECLARE a bigint := 8800100; staff bigint := 8800001; org bigint := 8800000;
  token uuid; newer uuid; r jsonb; before_row jsonb; platform text;
BEGIN
  IF to_regclass('public.test_capabilities') IS NULL THEN
    RAISE EXCEPTION 'v283_smoke_requires_isolated_fixture_database';
  END IF;
  INSERT INTO public.org_staff VALUES(staff,org,true),(staff+1,org+1,true);
  INSERT INTO public.test_capabilities VALUES(org,true,true,true),(org+1,true,true,true);
  INSERT INTO public.auto_accounts VALUES(a,staff,org,'zalo','chờ xử lý','đã đăng nhập',true,false,true,false,NULL,now());

  FOREACH platform IN ARRAY ARRAY['zalo','facebook','email'] LOOP
    UPDATE public.auto_accounts SET flatform_type=platform,is_zalo_server=(platform='zalo'),
      status='chờ xử lý',runtime_operation_claim_token=NULL WHERE id=a;
    token:=gen_random_uuid(); newer:=gen_random_uuid();
    SET LOCAL ROLE anon;
    r:=public.aka_agent_claim_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,
      'chờ xử lý',token,true,'operation');
    IF (r->>'claimed') IS DISTINCT FROM 'true' OR r->>'claim_token'<>token::text THEN RAISE EXCEPTION 'claim failed: %',r; END IF;
    -- Same token confirms an ambiguous successful claim; it does not start a new one.
    r:=public.aka_agent_claim_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,
      'chờ xử lý',token,true,'operation');
    IF (r->>'claimed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'claim retry failed: %',r; END IF;
    r:=public.aka_agent_cleanup_account_operation(a,staff+1,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,'chờ xử lý',token);
    IF (r->>'reason') IS DISTINCT FROM 'not_owner' THEN RAISE EXCEPTION 'wrong staff accepted'; END IF;
    r:=public.aka_agent_cleanup_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,'chờ xử lý',newer);
    IF (r->>'reason') IS DISTINCT FROM 'not_owner' THEN RAISE EXCEPTION 'wrong token accepted'; END IF;
    RESET ROLE;
    UPDATE public.auto_accounts SET status='tạm dừng' WHERE id=a;
    SET LOCAL ROLE anon;
    r:=public.aka_agent_claim_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,
      'chờ xử lý',token,true,'operation');
    IF (r->>'reason') IS DISTINCT FROM 'control_changed' THEN RAISE EXCEPTION 'claim retry overwrote pause: %',r; END IF;
    r:=public.aka_agent_cleanup_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,'chờ xử lý',token);
    IF (r->>'reason') IS DISTINCT FROM 'cleaned' THEN RAISE EXCEPTION 'pause cleanup failed: %',r; END IF;
    RESET ROLE;
    IF (SELECT status<>'tạm dừng' OR runtime_operation_claim_token IS NOT NULL FROM public.auto_accounts WHERE id=a) THEN
      RAISE EXCEPTION 'cleanup did not preserve pause';
    END IF;
    SET LOCAL ROLE anon;
    r:=public.aka_agent_claim_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,
      'tạm dừng',newer,true,'operation');
    IF (r->>'claimed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'new owner could not claim'; END IF;
    RESET ROLE;
    SELECT to_jsonb(t) INTO before_row FROM public.auto_accounts t WHERE id=a;
    SET LOCAL ROLE anon;
    r:=public.aka_agent_cleanup_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,'chờ xử lý',token);
    IF (r->>'reason') IS DISTINCT FROM 'not_owner' THEN RAISE EXCEPTION 'old cleanup took new owner'; END IF;
    RESET ROLE;
    IF (SELECT to_jsonb(t) FROM public.auto_accounts t WHERE id=a) IS DISTINCT FROM before_row THEN
      RAISE EXCEPTION 'old cleanup modified new owner';
    END IF;
    SET LOCAL ROLE anon;
    r:=public.aka_agent_cleanup_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,'tạm dừng',newer);
    IF (r->>'reason') IS DISTINCT FROM 'cleaned' THEN RAISE EXCEPTION 'normal cleanup failed'; END IF;
    r:=public.aka_agent_cleanup_account_operation(a,staff,platform,CASE WHEN platform='zalo' THEN 'server' ELSE 'desktop' END,'tạm dừng',newer);
    IF (r->>'reason') IS DISTINCT FROM 'not_owner' THEN RAISE EXCEPTION 'cleanup replay failed'; END IF;
    RESET ROLE;
  END LOOP;

  UPDATE public.auto_accounts SET flatform_type='zalo',is_zalo_server=true,status='chờ xử lý',
    is_active=false,login_status='chưa đăng nhập',runtime_operation_claim_token=NULL WHERE id=a;
  token:=gen_random_uuid();
  r:=public.aka_agent_claim_account_operation(a,staff,'zalo','server','chờ xử lý',token,false,'operation');
  IF (r->>'claimed') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'inactive QR became eligible'; END IF;
  r:=public.aka_agent_claim_account_operation(a,staff,'zalo','server','chờ xử lý',token,false,'type_change');
  IF (r->>'claimed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'inactive subtype change regressed: %',r; END IF;
  UPDATE public.auto_accounts SET is_zalo_server=false WHERE id=a;
  r:=public.aka_agent_cleanup_account_operation(a,staff,'zalo','server','chờ xử lý',token);
  IF (r->>'reason') IS DISTINCT FROM 'cleaned' THEN RAISE EXCEPTION 'subtype change cleanup failed'; END IF;

  UPDATE public.auto_accounts SET is_active=true,is_zalo_server=true WHERE id=a;
  token:=gen_random_uuid();
  r:=public.aka_agent_claim_account_operation(a,staff,'zalo','server','chờ xử lý',token,true,'operation');
  IF (r->>'claimed') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'logged-out session accepted'; END IF;
  r:=public.aka_agent_claim_account_operation(a,staff,'zalo','server','chờ xử lý',token,false,'operation');
  IF (r->>'claimed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'logged-out QR blocked'; END IF;
  UPDATE public.test_capabilities SET server_enabled=false WHERE organization_id=org;
  UPDATE public.org_staff SET is_active=false WHERE id=staff;
  UPDATE public.auto_accounts SET is_delete=true WHERE id=a;
  r:=public.aka_agent_cleanup_account_operation(a,staff,'zalo','server','chờ xử lý',token);
  IF (r->>'reason') IS DISTINCT FROM 'cleaned' THEN RAISE EXCEPTION 'cleanup incorrectly requires active entitlement/account'; END IF;
  UPDATE public.org_staff SET is_active=true WHERE id=staff;
  UPDATE public.auto_accounts SET is_delete=false,login_status='đã đăng nhập' WHERE id=a;
  r:=public.aka_agent_claim_account_operation(a,staff,'zalo','server','chờ xử lý',gen_random_uuid(),true,'operation');
  IF (r->>'reason') IS DISTINCT FROM 'runtime_not_owner' THEN RAISE EXCEPTION 'claim ignored capability loss'; END IF;
  UPDATE public.test_capabilities SET server_enabled=true WHERE organization_id=org;

  -- A completed legacy campaign can leave a token on an idle account.
  UPDATE public.auto_accounts SET runtime_operation_claim_token=gen_random_uuid() WHERE id=a;
  token:=gen_random_uuid();
  r:=public.aka_agent_claim_account_operation(a,staff,'zalo','server','chờ xử lý',token,true,'operation');
  IF (r->>'claimed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'legacy idle token blocked new work'; END IF;
  INSERT INTO public.auto_campaigns VALUES(8800200,a,staff,'chờ xử lý',gen_random_uuid());
  r:=public.aka_agent_cleanup_account_operation(a,staff,'zalo','server','chờ xử lý',token);
  IF (r->>'reason') IS DISTINCT FROM 'work_running' THEN RAISE EXCEPTION 'cleanup crossed durable unit'; END IF;
  UPDATE public.auto_campaigns SET runtime_unit_token=NULL WHERE id=8800200;
  INSERT INTO public.auto_campaign_input_data VALUES(8800300,8800200,'đang chạy');
  r:=public.aka_agent_cleanup_account_operation(a,staff,'zalo','server','chờ xử lý',token);
  IF (r->>'reason') IS DISTINCT FROM 'work_running' THEN RAISE EXCEPTION 'cleanup crossed running input'; END IF;
  DELETE FROM public.auto_campaign_input_data WHERE id=8800300;
  INSERT INTO public.auto_campaign_inputs VALUES(8800300,8800200,'đang chạy');
  r:=public.aka_agent_cleanup_account_operation(a,staff,'zalo','server','chờ xử lý',token);
  IF (r->>'reason') IS DISTINCT FROM 'work_running' THEN RAISE EXCEPTION 'cleanup crossed running input group'; END IF;
  DELETE FROM public.auto_campaign_inputs WHERE id=8800300;
  UPDATE public.auto_accounts SET status='chờ xử lý' WHERE id=a;
  r:=public.aka_agent_cleanup_account_operation(a,staff,'zalo','server','tạm dừng',token);
  IF (r->>'reason') IS DISTINCT FROM 'cleaned' OR (SELECT status FROM public.auto_accounts WHERE id=a)<>'chờ xử lý' THEN
    RAISE EXCEPTION 'cleanup overwrote resume';
  END IF;

  -- Existing boolean entrypoints remain callable by older binaries.
  token:=gen_random_uuid();
  r:=public.claim_zalo_account_runtime_operation(a,staff,'server','chờ xử lý',token,true);
  IF (r->>'claimed') IS DISTINCT FROM 'true' OR NOT public.release_zalo_account_runtime_operation(a,staff,'server','chờ xử lý',token) THEN
    RAISE EXCEPTION 'legacy RPC contract changed';
  END IF;
END;
$smoke$;
ROLLBACK;
SELECT 'v283 account operation SQL smoke PASS; fixtures rolled back' AS result;
