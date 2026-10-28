-- Live RPC smoke with transaction-only fixture rows; never sends messages.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $smoke$
DECLARE
  s bigint; o bigint; a bigint; other_a bigint; foreign_a bigint;
  c constant bigint := 9000000000000436;
  i constant bigint := 9000000000000536;
  mapped_user uuid;
  mapped_staff bigint;
  target text := 'recipient-smoke-' || gen_random_uuid()::text;
  result record;
  today_start timestamptz := timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
  SELECT ac.staff_id, ac.organization_id, min(ac.id), max(ac.id)
  INTO s,o,a,other_a
  FROM public.auto_accounts ac JOIN public.org_staff st
    ON st.id=ac.staff_id AND st.organization_id=ac.organization_id AND st.is_active
  WHERE ac.flatform_type='zalo' AND NOT coalesce(ac.is_delete,false)
  GROUP BY ac.staff_id, ac.organization_id HAVING count(*)>=2
  ORDER BY count(*), ac.staff_id, ac.organization_id LIMIT 1;
  IF a IS NULL THEN RAISE EXCEPTION 'recipient smoke needs two existing accounts of one active staff'; END IF;
  SELECT id INTO foreign_a FROM public.auto_accounts
  WHERE staff_id<>s AND organization_id=o AND NOT coalesce(is_delete,false)
  ORDER BY id LIMIT 1;
  IF foreign_a IS NULL THEN RAISE EXCEPTION 'recipient smoke needs another staff account'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id BETWEEN c AND c+1)
    OR EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE id BETWEEN i AND i+2)
    OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE id=i) THEN
    RAISE EXCEPTION 'recipient smoke fixture ID collision';
  END IF;
  INSERT INTO public.auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings) OVERRIDING SYSTEM VALUE
  VALUES (c,'recipient rollback target','zalo_message_phone',a,s,o,'tạm dừng',
      '{"enableMessage":true,"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":3}'),
    (c+1,'recipient rollback source','zalo_message_friend',other_a,s,o,'tạm dừng','{}');
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,uid,status)
  VALUES(i,c,target,'chờ xử lý'),(i+1,c,target,'chờ xử lý'),(i+2,c+1,target,'hoàn thành');
  INSERT INTO public.auto_campaign_details(id,campaign_id,input_data_id,account_id,action_name,action_code,status,created_at,counts_toward_limit)
  VALUES(i,c+1,i+2,other_a,'recipient rollback smoke','zalo_message_friend','đã gửi',today_start,false);

  SET LOCAL ROLE service_role;
  SELECT * INTO result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
  IF result.decision IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'recipient default account scope changed'; END IF;
  RESET ROLE;
  UPDATE public.auto_campaigns SET extra_settings=extra_settings||'{"recentDeliveryCooldownAllAccounts":true}' WHERE id=c;
  SET LOCAL ROLE service_role;
  SELECT * INTO result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
  IF result.decision IS DISTINCT FROM 'paused_recent_delivery' OR result.source_campaign_id IS DISTINCT FROM c+1 THEN
    RAISE EXCEPTION 'recipient cross-account history not applied';
  END IF;
  SELECT * INTO result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
  IF result.decision IS DISTINCT FROM 'not_pending' THEN RAISE EXCEPTION 'recipient pending guard changed'; END IF;
  BEGIN
    PERFORM * FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s+900000000000000,ARRAY[i]);
    RAISE EXCEPTION 'recipient invalid staff accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'campaign_delivery_cooldown_scope_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i+2]);
    RAISE EXCEPTION 'recipient invalid input scope accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'campaign_delivery_cooldown_input_scope_mismatch' THEN RAISE; END IF;
  END;
  RESET ROLE;
  UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=i;
  FOR result IN SELECT * FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i,i+1]) LOOP
    IF (result.input_data_id=i AND result.decision<>'paused_recent_delivery') OR
      (result.input_data_id=i+1 AND result.decision<>'deferred_batch_duplicate') THEN
      RAISE EXCEPTION 'recipient duplicate order changed';
    END IF;
  END LOOP;
  UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=i;
  UPDATE public.auto_campaign_details SET account_id=foreign_a WHERE id=i;
  SELECT * INTO result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
  IF result.decision IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'recipient other staff leaked'; END IF;
  UPDATE public.auto_campaign_details SET account_id=other_a,created_at=today_start-interval '3 days' WHERE id=i;
  SELECT * INTO result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
  IF result.decision IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'recipient day boundary changed'; END IF;
  UPDATE public.auto_campaign_details SET created_at=today_start,status='thất bại',policy_snapshot='{"operationState":"committed"}' WHERE id=i;
  SELECT * INTO result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
  IF result.decision IS DISTINCT FROM 'paused_recent_delivery' THEN RAISE EXCEPTION 'recipient V367 evidence lost'; END IF;
  UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=i;
  UPDATE public.auto_campaigns SET extra_settings=extra_settings||'{"enableMessage":false,"enableAddFriend":true}' WHERE id=c;
  SELECT * INTO result FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
  IF result.decision IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'recipient friend-only gate changed'; END IF;
  IF (SELECT count(*) FROM public.auto_campaign_details WHERE campaign_id IN(c,c+1))<>1
    OR (SELECT status FROM public.auto_campaigns WHERE id=c) IS DISTINCT FROM 'tạm dừng'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id=i+1) IS DISTINCT FROM 'chờ xử lý' THEN
    RAISE EXCEPTION 'recipient unexpected runtime side effect';
  END IF;
  SELECT auth_user_id,staff_id INTO mapped_user,mapped_staff FROM private.aka_agent_desktop_users WHERE staff_id<>s ORDER BY staff_id LIMIT 1;
  IF mapped_user IS NULL THEN RAISE EXCEPTION 'need mapped Desktop user for scope smoke'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',mapped_user)::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  BEGIN
    PERFORM * FROM public.aka_agent_apply_campaign_delivery_cooldown(c,a,s,ARRAY[i]);
    RAISE EXCEPTION 'Desktop accepted another staff';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'desktop_staff_scope_denied' THEN RAISE; END IF;
  END;
  RESET ROLE;
END;
$smoke$;
SELECT 'PASS: 12 checks (default, staff history, pending, caller scope, input scope, batch order, staff isolation, day boundary, V367 evidence, friend-only gate, side effects, Desktop ownership); fixtures rolled back' AS smoke;
ROLLBACK;
