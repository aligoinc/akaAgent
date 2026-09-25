-- Synthetic fixtures only. Run standalone after apply, or append to the migration without its COMMIT.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  customer_id bigint; org_id bigint; actor_id bigint; actor_name text; account_id bigint; manual_id bigint;
  r jsonb; payload jsonb; request_id uuid:=gen_random_uuid(); vault_id uuid; rev bigint; claim_token uuid:=gen_random_uuid();
BEGIN
  IF has_table_privilege('anon','public.auto_facebook_login_sessions','SELECT') OR
     has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') THEN RAISE EXCEPTION 'secret table readable'; END IF;
  INSERT INTO public.aka_customer(name,phone) VALUES('__facebook_v319_rollback__','0999999319') RETURNING id INTO customer_id;
  INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
    SELECT customer_id,'__facebook_v319_rollback__','0999999319',3,id,id FROM public.org_staff WHERE organization_id=1 AND is_admin IS TRUE LIMIT 1 RETURNING id INTO org_id;
  INSERT INTO public.org_staff(organization_id,name,phone,is_admin) VALUES(org_id,'Facebook fixture','0999999319',true) RETURNING id,username INTO actor_id,actor_name;
  INSERT INTO public.org_organization_product(organization_id,product_id,product_package_id,expiration_date,max_accounts)
    SELECT org_id,3,product_package_id,now()+interval '800 days',50 FROM public.org_organization_product WHERE product_id=3 LIMIT 1;
  payload:=jsonb_build_object('requestId',request_id,'batchSize',1,'name','FB smoke','secret',
    jsonb_build_object('uid','100000000001111','password','fixture-password','twoFactorSecret','JBSWY3DPEHPK3PXP','cookies',
      jsonb_build_array(jsonb_build_object('name','c_user','value','100000000001111','domain','.facebook.com','path','/'))));
  EXECUTE 'SET LOCAL ROLE anon';
  r:=public.aka_agent_facebook_login(actor_id,actor_name,'123456','preview','{"uids":[]}');
  IF (r->>'limit')::int<1 THEN RAISE EXCEPTION 'invalid limit'; END IF;
  BEGIN
    PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'wrong','preview','{"uids":[]}'); RAISE EXCEPTION 'wrong credential accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT IN ('staff_auth_invalid','staff_access_denied') THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','reserve',payload||jsonb_build_object('batchSize',(r->>'limit')::int+1)); RAISE EXCEPTION 'batch cap bypassed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'facebook_batch_limit' THEN RAISE; END IF; END;
  r:=public.aka_agent_facebook_login(actor_id,actor_name,'123456','reserve',payload); account_id:=(r->>'accountId')::bigint;
  IF account_id IS NULL OR r->>'state'<>'initializing' THEN RAISE EXCEPTION 'create failed'; END IF;
  IF public.aka_agent_facebook_login(actor_id,actor_name,'123456','reserve',payload) IS DISTINCT FROM r THEN RAISE EXCEPTION 'idempotency failed'; END IF;
  BEGIN
    PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','get',jsonb_build_object('accountId',account_id)); RAISE EXCEPTION 'pending usable';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'facebook_not_found' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','finish',payload||jsonb_build_object('accountId',account_id));
  r:=public.aka_agent_facebook_login(actor_id,actor_name,'123456','metadata',jsonb_build_object('accountId',account_id));
  IF r ? 'password' OR r ? 'cookies' OR r->>'hasPassword'<>'true' THEN RAISE EXCEPTION 'metadata leakage'; END IF;
  r:=public.aka_agent_facebook_login(actor_id,actor_name,'123456','reserve',payload||jsonb_build_object('requestId',gen_random_uuid()));
  IF r->>'skipped'<>'true' THEN RAISE EXCEPTION 'import dedupe failed'; END IF;
  EXECUTE 'RESET ROLE';
  -- Manual accounts are allowed to use the same verified UID.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,is_delete,facebook_uid)
    VALUES('manual duplicate','facebook',actor_id,org_id,false,'100000000001111') RETURNING id INTO manual_id;
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','observe',jsonb_build_object('accountId',manual_id,'expectedUid','100000000001111','uid','100000000002222','state','authenticated'));
  -- User changes 1111 -> 2222 while still logged in: no UID uniqueness gate, old credential is discarded.
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','observe',jsonb_build_object('accountId',account_id,'revision',1,'uid','100000000002222','state','authenticated','cookies',
    jsonb_build_array(jsonb_build_object('name','c_user','value','100000000002222','domain','.facebook.com','path','/'))));
  r:=public.aka_agent_facebook_login(actor_id,actor_name,'123456','get',jsonb_build_object('accountId',account_id));
  IF r->'secret' ? 'password' OR r->'secret' ? 'twoFactorSecret' OR r->'secret'->>'uid'<>'100000000002222' THEN RAISE EXCEPTION 'old credential survived identity switch'; END IF;
  rev:=(r->>'revision')::bigint;
  BEGIN
    PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','save',jsonb_build_object('accountId',account_id,'revision',rev,'uid','100000000001111','observedState','authenticated','observedUid','100000000002222')); RAISE EXCEPTION 'browser mismatch accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'facebook_uid_mismatch' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','save',jsonb_build_object('accountId',account_id,'revision',rev,'uid','100000000001111')); RAISE EXCEPTION 'unknown state accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'facebook_unverified' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','save',jsonb_build_object('accountId',account_id,'revision',rev,'uid','100000000002222','observedState','authenticated','observedUid','100000000002222','password','new-fixture'));
  BEGIN
    PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','save',jsonb_build_object('accountId',account_id,'revision',rev,'uid','100000000002222','observedState','logged_out')); RAISE EXCEPTION 'stale revision accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'facebook_conflict' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','observe',jsonb_build_object('accountId',account_id,'revision',rev+1,'state','logged_out'));
  EXECUTE 'RESET ROLE';
  IF (SELECT facebook_uid FROM public.auto_accounts WHERE id=account_id)<>'100000000002222' THEN RAISE EXCEPTION 'logout erased UID'; END IF;
  UPDATE public.auto_accounts SET status='tạm dừng' WHERE id=account_id;
  EXECUTE 'SET LOCAL ROLE anon';
  r:=public.aka_agent_claim_account_operation(account_id,actor_id,'facebook','desktop','tạm dừng',claim_token,false,'operation');
  IF r->>'claimed'<>'true' THEN RAISE EXCEPTION 'logged-out paused claim failed'; END IF;
  r:=public.aka_agent_claim_account_operation(account_id,actor_id,'facebook','desktop','tạm dừng',gen_random_uuid(),false,'operation');
  IF r->>'claimed'='true' THEN RAISE EXCEPTION 'double claim accepted'; END IF;
  PERFORM public.aka_agent_cleanup_account_operation(account_id,actor_id,'facebook','desktop','tạm dừng',claim_token);
  EXECUTE 'RESET ROLE';
  IF (SELECT status FROM public.auto_accounts WHERE id=account_id)<>'tạm dừng' THEN RAISE EXCEPTION 'restore lost paused status'; END IF;
  EXECUTE 'SET LOCAL ROLE anon';
  -- Logged-out edit can target a different UID without changing the last verified UID.
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','save',jsonb_build_object('accountId',account_id,'revision',rev+1,'uid','100000000003333','observedState','logged_out','password','third-fixture'));
  r:=public.aka_agent_facebook_login(actor_id,actor_name,'123456','get',jsonb_build_object('accountId',account_id));
  IF r->'secret'->>'uid'<>'100000000003333' OR jsonb_array_length(r->'secret'->'cookies')<>0 THEN RAISE EXCEPTION 'logged-out edit kept old cookie'; END IF;
  EXECUTE 'RESET ROLE';
  IF (SELECT facebook_uid FROM public.auto_accounts WHERE id=account_id)<>'100000000002222' THEN RAISE EXCEPTION 'unverified target replaced verified UID'; END IF;
  SELECT secret_id INTO vault_id FROM public.auto_facebook_login_sessions WHERE auto_facebook_login_sessions.account_id=account_id;
  UPDATE public.auto_accounts SET is_delete=true WHERE id=account_id;
  IF EXISTS(SELECT 1 FROM vault.secrets WHERE id=vault_id) OR EXISTS(SELECT 1 FROM public.auto_facebook_login_sessions WHERE auto_facebook_login_sessions.account_id=account_id) THEN RAISE EXCEPTION 'soft-delete leaked vault secret'; END IF;
  UPDATE public.auto_accounts SET is_delete=true WHERE id=manual_id;
  EXECUTE 'SET LOCAL ROLE anon';
  request_id:=gen_random_uuid();
  payload:=payload||jsonb_build_object('requestId',request_id,'secret',(payload->'secret')||jsonb_build_object(
    'uid','100000000002222','cookies',jsonb_build_array(jsonb_build_object('name','c_user','value','100000000002222','domain','.facebook.com','path','/'))));
  r:=public.aka_agent_facebook_login(actor_id,actor_name,'123456','reserve',payload);
  IF r->>'accountId' IS NULL THEN RAISE EXCEPTION 'deleted UID cannot be recreated'; END IF;
  account_id:=(r->>'accountId')::bigint;
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','abort',jsonb_build_object('accountId',account_id,'requestId',request_id));
  PERFORM public.aka_agent_facebook_login(actor_id,actor_name,'123456','abort',jsonb_build_object('accountId',account_id,'requestId',request_id));
  EXECUTE 'RESET ROLE';
  IF EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=account_id) THEN RAISE EXCEPTION 'rollback of failed promotion failed'; END IF;
END $smoke$;
SELECT 'facebook_v319_smoke_passed' AS result;
ROLLBACK;
