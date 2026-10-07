-- Linked production smoke: synthetic rows only, explicit IDs (no sequences), always ROLLBACK.
-- Requires v350; existing active org-1 staff is referenced, never modified.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $fixture$
DECLARE
  s bigint;
  c constant bigint := 8000000000000350;
  a constant bigint := 8000000000000351;
  ids constant bigint[] := ARRAY[8000000000000352,8000000000000353,8000000000000354];
  claim constant uuid := 'a3500000-0000-4000-8000-000000000001';
  unit constant uuid := 'a3500000-0000-4000-8000-000000000002';
  got integer[] := '{}';
  i bigint;
  n integer;
  before_cursor jsonb;
  before_version text;
  before_updated timestamptz;
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)'::regprocedure))
    IS DISTINCT FROM '006a6da075ede4e9c6b07194422f65c9' THEN RAISE EXCEPTION 'unexpected allocator checksum'; END IF;
  SELECT id INTO s FROM public.org_staff WHERE organization_id=1 AND is_active IS TRUE ORDER BY id LIMIT 1;
  IF s IS NULL THEN RAISE EXCEPTION 'missing active org-1 fixture owner'; END IF;
  PERFORM set_config('aka.v350_smoke_staff',s::text,true);
  INSERT INTO public.auto_accounts(id,name,staff_id,organization_id,flatform_type,status,login_status,is_active,is_delete,is_zalo_server)
    OVERRIDING SYSTEM VALUE VALUES(a,'__v350_rollback_only__',s,1,'facebook','đang chạy','đã đăng nhập',true,false,false);
  INSERT INTO public.auto_campaigns(id,name,account_id,staff_id,organization_id,status,action_id,extra_settings,
    runtime_claim_token,runtime_claim_target,runtime_unit_token,runtime_unit_claimed_at,runtime_unit_input_data_ids)
    OVERRIDING SYSTEM VALUE VALUES(c,'__v350_rollback_only__',a,s,1,'đang chạy','facebook_group_post','{}',claim,'desktop',unit,now(),ids);
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,canonical_target_key,is_delete,uid)
    SELECT x,c,'đang chạy','uid:v350-smoke-'||x,false,'v350-smoke-'||x FROM unnest(ids||8000000000000355::bigint) x;
  SELECT public.aka_agent_campaign_config_version(t),updated_at INTO before_version,before_updated FROM public.auto_campaigns t WHERE id=c;
  FOREACH i IN ARRAY ids LOOP
    got:=array_append(got,public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,i,'fb_post_group',3));
  END LOOP;
  IF got<>ARRAY[0,1,2] THEN RAISE EXCEPTION 'first round: %',got; END IF;
  got:='{}';
  FOREACH i IN ARRAY ARRAY[ids[3],ids[1],ids[2]] LOOP
    got:=array_append(got,public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,i,'fb_post_group',3));
  END LOOP;
  IF got<>ARRAY[0,1,2] THEN RAISE EXCEPTION 'reorder/skip: %',got; END IF;
  got:='{}';
  FOREACH i IN ARRAY ids LOOP
    got:=array_append(got,public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,i,'fb_post_group',3));
  END LOOP;
  IF got<>ARRAY[2,0,1] THEN RAISE EXCEPTION 'third round: %',got; END IF;
  IF public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,ids[1],'fb_comment',3)<>0
    OR public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,ids[1],'fb_comment',3)<>1 THEN RAISE EXCEPTION 'action isolation'; END IF;
  got:='{}';
  FOR n IN 1..3 LOOP
    got:=array_append(got,public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,NULL,'zalo_share_batch',3));
  END LOOP;
  IF got<>ARRAY[0,1,2] THEN RAISE EXCEPTION 'global/batch rotation'; END IF;
  SELECT content_rotation_indexes INTO before_cursor FROM public.auto_campaign_input_data WHERE id=ids[1];
  IF public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,ids[1],'only_one',1)<>0 THEN RAISE EXCEPTION 'singleton'; END IF;
  IF (SELECT content_rotation_indexes FROM public.auto_campaign_input_data WHERE id=ids[1]) IS DISTINCT FROM before_cursor THEN RAISE EXCEPTION 'singleton wrote cursor'; END IF;
  BEGIN
    PERFORM public.aka_agent_take_campaign_content_index(c,a,s,'desktop',unit,claim,ids[1],'fb_post_group',3);
    RAISE EXCEPTION 'accepted wrong claim/unit';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'campaign_content_not_owner' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_take_campaign_content_index(c,a+100,s,'desktop',claim,unit,ids[1],'fb_post_group',3);
    RAISE EXCEPTION 'accepted wrong account';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'campaign_content_not_owner' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,8000000000000355,'fb_post_group',3);
    RAISE EXCEPTION 'accepted unclaimed input';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'campaign_content_input_not_in_unit' THEN RAISE; END IF; END;
  IF (SELECT content_rotation_indexes FROM public.auto_campaign_input_data WHERE id=ids[1]) IS DISTINCT FROM before_cursor THEN RAISE EXCEPTION 'denial wrote cursor'; END IF;
  UPDATE public.auto_campaign_input_data SET status='chờ xử lý' WHERE id=ids[1];
  UPDATE public.auto_campaign_input_data SET status='đang chạy' WHERE id=ids[1];
  IF (SELECT content_rotation_indexes FROM public.auto_campaign_input_data WHERE id=ids[1]) IS DISTINCT FROM before_cursor THEN RAISE EXCEPTION 'reset lost cursor'; END IF;
  UPDATE public.auto_campaigns SET runtime_claim_target='server' WHERE id=c;
  UPDATE public.auto_campaigns SET status='tạm dừng' WHERE id=c;
  UPDATE public.auto_accounts SET status='tạm dừng' WHERE id=a;
  IF public.aka_agent_take_campaign_content_index(c,a,s,'server',claim,unit,ids[1],'server_pause',3)<>0 THEN RAISE EXCEPTION 'server soft pause'; END IF;
  UPDATE public.auto_campaigns SET status='đang chạy' WHERE id=c;
  UPDATE public.auto_accounts SET status='đang chạy' WHERE id=a;
  UPDATE public.auto_campaigns SET runtime_claim_target='desktop',runtime_claim_token=claim,runtime_unit_token=unit WHERE id=c;
  UPDATE public.auto_campaigns SET action_id='facebook_timeline_post',extra_settings='{"contentRotationIndex":41}' WHERE id=c;
  IF public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,NULL,'fb_post_my_profile',42)<>41
    OR public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,NULL,'fb_post_my_profile',42)<>0 THEN RAISE EXCEPTION 'profile legacy seed'; END IF;
  UPDATE public.auto_campaigns SET action_id='facebook_page_post' WHERE id=c;
  IF public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,ids[1],'fb_post_page',42)<>41
    OR public.aka_agent_take_campaign_content_index(c,a,s,'desktop',claim,unit,ids[1],'fb_post_page',3)<>0 THEN RAISE EXCEPTION 'page seed/modulo'; END IF;
  UPDATE public.auto_campaigns SET action_id='facebook_group_post',extra_settings='{}' WHERE id=c;
  IF (SELECT public.aka_agent_campaign_config_version(t) FROM public.auto_campaigns t WHERE id=c) IS DISTINCT FROM before_version
    OR (SELECT updated_at FROM public.auto_campaigns WHERE id=c) IS DISTINCT FROM before_updated THEN RAISE EXCEPTION 'config/updated_at changed'; END IF;
  IF (SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted)<2 THEN RAISE EXCEPTION 'missing allocator advisory locks'; END IF;
END;
$fixture$;
DO $grants$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','aka_agent_chat_api'] LOOP
    IF NOT has_function_privilege(role_name,'public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)','EXECUTE') THEN
      RAISE EXCEPTION 'missing execute privilege: %',role_name;
    END IF;
  END LOOP;
END;
$grants$;
ROLLBACK;
SELECT 'PASS: 3 rounds, reorder/skip, action/global/batch, singleton, ownership/unit, reset, server pause, seed/modulo, config, locks and runtime EXECUTE grants; all fixtures rolled back' AS result,
  NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=8000000000000351)
  AND NOT EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=8000000000000350)
  AND NOT EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE id BETWEEN 8000000000000352 AND 8000000000000355) AS fixtures_absent;
