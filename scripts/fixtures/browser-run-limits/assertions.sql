SET LOCAL ROLE anon;
DO $test$
DECLARE r jsonb; c record; n integer;
BEGIN
 r:=public.aka_agent_browser_run_limits(34001,340,'fixture-a','fixture-password','get');
 ASSERT r->'settings'='{"zaloWebMax":null,"facebookMax":null,"revision":0}'::jsonb,'default unlimited';
 r:=public.aka_agent_browser_run_limits(34001,340,'fixture-a','fixture-password','save','{"zaloWebMax":2,"facebookMax":2,"revision":0}');
 ASSERT (r->'settings'->>'revision')::int=1,'save';
 r:=public.aka_agent_browser_run_limits(34001,340,'fixture-a','fixture-password','save','{"zaloWebMax":9,"facebookMax":9,"revision":0}');
 ASSERT r->>'reason'='conflict','CAS rejects stale writes';
 FOR r IN SELECT value FROM jsonb_array_elements('[{"zaloWebMax":0,"facebookMax":null,"revision":1},{"zaloWebMax":-1,"facebookMax":null,"revision":1},{"zaloWebMax":1.5,"facebookMax":null,"revision":1},{"zaloWebMax":"3","facebookMax":null,"revision":1},{"zaloWebMax":2147483648,"facebookMax":null,"revision":1},{"facebookMax":null,"revision":1},{"zaloWebMax":null,"facebookMax":null,"revision":-1}]') LOOP
  BEGIN
   PERFORM public.aka_agent_browser_run_limits(34001,340,'fixture-a','fixture-password','save',r);
   RAISE EXCEPTION 'invalid input accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='invalid input accepted' THEN RAISE; END IF; END;
 END LOOP;
 BEGIN
  PERFORM public.aka_agent_browser_run_limits(34001,340,'fixture-b','fixture-password','get');
  RAISE EXCEPTION 'other staff accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='other staff accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.aka_agent_browser_run_limits(34001,341,'fixture-a','fixture-password','get');
  RAISE EXCEPTION 'other tenant accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='other tenant accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.aka_agent_browser_run_limits(34001,340,'fixture-a','wrong-password','get');
  RAISE EXCEPTION 'wrong password accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='wrong password accepted' THEN RAISE; END IF; END;
 ASSERT public.claim_campaign_runtime(1,1,34001,'desktop'),'first legacy slot';
 SELECT * INTO c FROM public.aka_agent_claim_campaign_runtime_v2(2,2,34001,'desktop','34000000-0000-4000-8000-000000000002');
 ASSERT c.ok,'second v2 slot';
 ASSERT (SELECT note IS NULL FROM auto_campaigns WHERE id=2),'successful claim clears wait note';
 SELECT * INTO c FROM public.aka_agent_claim_campaign_runtime_v2(2,2,34001,'desktop','34000000-0000-4000-8000-000000000002');
 ASSERT c.ok AND c.reason='already_claimed','exact token retry succeeds at full capacity';
 SELECT * INTO c FROM public.aka_agent_claim_campaign_runtime_v2(3,3,34001,'desktop','34000000-0000-4000-8000-000000000003');
 ASSERT NOT c.ok AND c.reason='concurrency_limit_reached','third v2 waits';
 ASSERT (SELECT status='chờ xử lý' AND note='old note' AND runtime_claim_token IS NULL FROM auto_campaigns WHERE id=3),'reject does not mutate campaign';
 ASSERT (SELECT status='chờ xử lý' FROM auto_accounts WHERE id=3),'reject does not reserve account';
 ASSERT NOT public.claim_campaign_runtime(3,3,34001,'desktop'),'legacy also enforces cap';
 -- Distinct accounts, even if legacy duplicate campaign state exists.
 INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,status) VALUES(101,1,34001,340,'đang chạy');
 UPDATE org_staff SET max_running_facebook_accounts=3 WHERE id=34001;
 ASSERT public.claim_campaign_runtime(3,3,34001,'desktop'),'duplicate campaigns count once';
 UPDATE org_staff SET max_running_facebook_accounts=1 WHERE id=34001;
 ASSERT (SELECT count(*)=3 FROM auto_accounts WHERE id IN(1,2,3) AND status='đang chạy'),'lowering cap does not stop existing runs';
 ASSERT NOT public.claim_campaign_runtime(4,4,34001,'desktop'),'lowered cap stops fresh admission';
 -- Zalo browser capacity and other staff are independent.
 ASSERT public.claim_campaign_runtime(11,11,34001,'desktop'),'zalo slot 1 independent';
 ASSERT public.claim_campaign_runtime(12,12,34001,'desktop'),'zalo slot 2';
 ASSERT NOT public.claim_campaign_runtime(13,13,34001,'desktop'),'zalo full';
 ASSERT public.claim_campaign_runtime(15,15,34001,'desktop'),'QR excluded';
 ASSERT public.claim_campaign_runtime(16,16,34001,'server'),'server excluded';
 ASSERT public.claim_campaign_runtime(20,20,34001,'desktop'),'email excluded';
 ASSERT public.claim_campaign_runtime(21,21,34001,'desktop'),'sms excluded';
 ASSERT public.claim_campaign_runtime(30,30,34002,'desktop'),'other staff independent';
 -- A pause with a durable unit stays occupied after the parent token cleared.
 UPDATE auto_campaigns SET runtime_unit_token='34000000-0000-4000-8000-000000000002',status='tạm dừng' WHERE id=2;
 UPDATE auto_campaigns SET status='hoàn thành' WHERE id IN(1,3,101);
 UPDATE auto_accounts SET status='chờ xử lý' WHERE id IN(1,3);
 ASSERT NOT public.claim_campaign_runtime(4,4,34001,'desktop'),'unsettled pause occupies slot';
 UPDATE auto_campaigns SET runtime_unit_token=NULL WHERE id=2;
 UPDATE auto_accounts SET status='chờ xử lý' WHERE id=2;
 -- A login or scan marked running without a campaign is not a campaign slot.
 UPDATE auto_accounts SET status='đang chạy',runtime_operation_claim_token='34000000-0000-4000-8000-000000000005' WHERE id=5;
 ASSERT public.claim_campaign_runtime(4,4,34001,'desktop'),'settlement releases; login-only account excluded';
 UPDATE org_staff SET max_running_facebook_accounts=NULL WHERE id=34001;
 ASSERT public.claim_campaign_runtime(6,6,34001,'desktop'),'null disables limit immediately';
 -- Existing eligibility checks remain authoritative.
 UPDATE auto_campaigns SET schedule=now()+interval '1 hour' WHERE id=7;
 ASSERT NOT public.claim_campaign_runtime(7,7,34001,'desktop'),'future schedule guard';
 UPDATE auto_accounts SET login_status='chưa đăng nhập' WHERE id=8;
 ASSERT NOT public.claim_campaign_runtime(8,8,34001,'desktop'),'login guard';
 UPDATE auto_campaigns SET is_delete=true WHERE id=9;
 ASSERT NOT public.claim_campaign_runtime(9,9,34001,'desktop'),'deleted campaign guard';
 ASSERT NOT public.claim_campaign_runtime(10,10,34002,'desktop'),'staff ownership guard';
 RAISE NOTICE 'v340 SQL behavior PASS';
END;
$test$;
RESET ROLE;
