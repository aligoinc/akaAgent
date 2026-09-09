-- Run only on the verified linked project. All fixtures use explicit IDs and
-- ROLLBACK, so no production sequence, campaign, account or delivery is changed.
BEGIN;
DO $test$
DECLARE
  a bigint := 90000000026801;
  c bigint := 90000000026802;
  d1 bigint := 90000000026803;
  d2 bigint := 90000000026804;
  d3 bigint := 90000000026805;
  staff bigint := 625;
  org bigint;
  token uuid := '10000000-0268-4000-8000-000000000001';
  unit uuid := '20000000-0268-4000-8000-000000000001';
  other_token uuid := '30000000-0268-4000-8000-000000000001';
  claim record;
  r record;
BEGIN
  SELECT organization_id INTO STRICT org FROM public.org_staff WHERE id = staff;
  IF EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = a)
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = c)
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id IN (d1,d2,d3)) THEN
    RAISE EXCEPTION 'Fixture IDs already in use';
  END IF;
  INSERT INTO public.auto_accounts(id,name,staff_id,organization_id,flatform_type,is_zalo_server,is_zalo_show_web,is_active,login_status)
  OVERRIDING SYSTEM VALUE VALUES(a,'__cleanup_rollback__',staff,org,'facebook',false,false,true,'đã đăng nhập');
  INSERT INTO public.auto_campaigns(id,name,staff_id,organization_id,account_id,action_id,schedule,schedule_type)
  OVERRIDING SYSTEM VALUE VALUES(c,'__cleanup_rollback__',staff,org,a,'facebook_message_uid',clock_timestamp()-interval '1 second','daily');
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,uid,status) VALUES
    (d1,c,'111111','chờ xử lý'),(d2,c,'222222','chờ xử lý'),(d3,c,'333333','chờ xử lý');

  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',token);
  ASSERT claim.ok AND claim.reason = 'claimed', 'fresh claim rejected';
  ASSERT (SELECT runtime_operation_claim_token = token FROM public.auto_accounts WHERE id=a), 'account token must be bound atomically';
  SELECT * INTO r FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',token);
  ASSERT r.ok AND r.reason = 'already_claimed', 'lost claim response must be idempotent';
  SELECT * INTO r FROM public.aka_agent_claim_campaign_run_unit_v2(c,a,staff,'desktop',token,claim.runtime_claim_vietnam_date,unit,ARRAY[d1,d2,d3]);
  ASSERT r.ok, 'unit claim rejected';
  UPDATE public.auto_campaign_input_data SET status='hoàn thành', note='confirmed success' WHERE id=d3;
  -- Partial old error handling can requeue a started target before failing.
  UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=d1;

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',other_token,unit,ARRAY[d2],'error',false);
  ASSERT NOT r.ok AND r.reason='not_owner', 'wrong parent token must not mutate';
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,other_token,ARRAY[d2],'error',false);
  ASSERT NOT r.ok AND r.reason='not_owner', 'wrong unit token must not mutate';
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,unit,ARRAY[d2,999999999999],'error',false);
  ASSERT NOT r.ok AND r.reason='invalid_unstarted_ids', 'unstarted must belong to exact lease';
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff+1,'desktop',token,unit,ARRAY[d2],'error',false);
  ASSERT NOT r.ok, 'cross-staff call must not mutate';
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,unit,ARRAY[d2],'API result lost',false);
  ASSERT r.ok AND r.reason='cleaned', 'anon cleanup must have narrow existing permissions';
  -- Identical request models a commit whose response was lost.
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,unit,ARRAY[d2],'API result lost',false);
  ASSERT r.ok AND r.reason='already_cleaned', 'lost cleanup response must be idempotent';
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT status='hoàn thành' AND note LIKE '%không tự gửi lại%' FROM public.auto_campaign_input_data WHERE id=d1), 'uncertain started data cannot requeue';
  ASSERT (SELECT status='chờ xử lý' AND date_action IS NULL FROM public.auto_campaign_input_data WHERE id=d2), 'proven unstarted data must requeue';
  ASSERT (SELECT status='hoàn thành' AND note='confirmed success' FROM public.auto_campaign_input_data WHERE id=d3), 'recorded outcome must remain unchanged';
  ASSERT (SELECT status='chờ xử lý' AND runtime_unit_token IS NULL AND runtime_claim_token IS NULL FROM public.auto_campaigns WHERE id=c), 'campaign must be released';
  ASSERT (SELECT status='chờ xử lý' AND runtime_operation_claim_token IS NULL FROM public.auto_accounts WHERE id=a), 'account must be released';

  -- Normal settlement/release remains compatible with the bound account token.
  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',token);
  ASSERT claim.ok;
  SELECT * INTO r FROM public.aka_agent_claim_campaign_run_unit_v2(c,a,staff,'desktop',token,claim.runtime_claim_vietnam_date,unit,ARRAY[d2]);
  ASSERT r.ok;
  SELECT * INTO r FROM public.aka_agent_settle_campaign_run_unit_v2(c,a,staff,'desktop',unit,true);
  ASSERT r.ok;
  ASSERT (SELECT status='chờ xử lý' FROM public.auto_campaign_input_data WHERE id=d2);
  ASSERT (SELECT runtime_operation_claim_token=token FROM public.auto_accounts WHERE id=a);
  UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=c;
  UPDATE public.auto_accounts SET flatform_type='zalo' WHERE id=a;
  ASSERT public.release_zalo_account_runtime_operation(a,staff,'desktop','chờ xử lý'), 'normal tokenless release remains compatible';
  ASSERT (SELECT runtime_operation_claim_token IS NULL FROM public.auto_accounts WHERE id=a);
  UPDATE public.auto_accounts SET flatform_type='facebook' WHERE id=a;

  -- Simulate policy clearing parent metadata before its next write failed.
  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',token);
  ASSERT claim.ok;
  UPDATE public.auto_campaigns SET status='tạm dừng' WHERE id=c;
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,NULL,ARRAY[]::bigint[],'policy failed',false);
  ASSERT r.ok;
  ASSERT (SELECT status='tạm dừng' FROM public.auto_campaigns WHERE id=c), 'preserve paused campaign after parent cleared';
  ASSERT (SELECT status='chờ xử lý' AND runtime_operation_claim_token IS NULL FROM public.auto_accounts WHERE id=a);

  UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=c;
  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',token);
  ASSERT claim.ok;
  UPDATE public.auto_accounts SET runtime_operation_claim_token=other_token WHERE id=a;
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,NULL,ARRAY[]::bigint[],'stale account',false);
  ASSERT NOT r.ok AND r.reason='not_owner', 'different account token blocks cleanup even with matching parent';
  UPDATE public.auto_accounts SET runtime_operation_claim_token=token WHERE id=a;
  UPDATE public.auto_accounts SET status='tạm dừng' WHERE id=a;
  UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id=c;
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,NULL,ARRAY[]::bigint[],'already stopped',false);
  ASSERT r.ok;
  ASSERT (SELECT status='hoàn thành' FROM public.auto_campaigns WHERE id=c), 'completed campaign remains completed';
  ASSERT (SELECT status='tạm dừng' FROM public.auto_accounts WHERE id=a), 'paused account remains paused';
  UPDATE public.auto_accounts SET status='chờ xử lý' WHERE id=a;

  -- Fresh run, empty-ID aggregate started, then failed. Exercise server's
  -- pause-preserving trigger with the same opaque ownership tuple.
  UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=c;
  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',token);
  ASSERT claim.ok;
  SELECT * INTO r FROM public.aka_agent_claim_campaign_run_unit_v2(c,a,staff,'desktop',token,claim.runtime_claim_vietnam_date,unit,ARRAY[]::bigint[]);
  ASSERT r.ok;
  UPDATE public.auto_campaigns SET runtime_claim_target='server' WHERE id=c;
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'server',token,unit,ARRAY[]::bigint[],'aggregate result unknown',true);
  ASSERT r.ok;
  ASSERT (SELECT status='tạm dừng' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL FROM public.auto_campaigns WHERE id=c), 'aggregate pause must clear metadata even with server trigger';

  -- Pause/resume and a new token must win over an old cleanup, without writes.
  UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=c;
  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',other_token);
  ASSERT claim.ok;
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,NULL,ARRAY[]::bigint[],'stale cleanup',false);
  ASSERT NOT r.ok AND r.reason='not_owner';
  ASSERT (SELECT runtime_operation_claim_token=other_token AND status='đang chạy' FROM public.auto_accounts WHERE id=a);
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',other_token,NULL,ARRAY[]::bigint[],'new run stopped',false);
  ASSERT r.ok;

  -- Tokenless running state is insufficient evidence, never forced to pending.
  UPDATE public.auto_accounts SET status='đang chạy' WHERE id=a;
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,NULL,ARRAY[]::bigint[],'legacy unknown',false);
  ASSERT NOT r.ok AND r.reason='insufficient_ownership';
  ASSERT (SELECT status='đang chạy' FROM public.auto_accounts WHERE id=a);
  UPDATE public.auto_accounts SET status='chờ xử lý' WHERE id=a;

  -- Token cleanup ignores expired date; the next normal claim still enforces
  -- the configured cutoff (same predicate as 23:59 daily drain).
  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',token);
  ASSERT claim.ok;
  UPDATE public.auto_campaigns SET runtime_claim_vietnam_date=runtime_claim_vietnam_date-1, daily_stop_time='00:00' WHERE id=c;
  SELECT * INTO r FROM public.aka_agent_cleanup_failed_campaign_runtime(c,a,staff,'desktop',token,NULL,ARRAY[]::bigint[],'past cutoff',false);
  ASSERT r.ok;
  SELECT * INTO claim FROM public.aka_agent_claim_campaign_runtime_v2(c,a,staff,'desktop',other_token);
  ASSERT NOT claim.ok AND claim.reason='daily_stop_due', 'cleanup cannot bypass next claim cutoff';
END;
$test$;
SELECT 'PASS: claim token, anon scope, batch uncertainty, lost responses, pause, new owner, tokenless guard, cutoff' AS result;
ROLLBACK;
