-- Synthetic fixtures only; workers cannot see these uncommitted rows.
-- Exercises the independent data endpoints, source wrappers and bundle intake.
-- No Zalo calls. Every mutation, including runtime claims, ends in ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL aka_agent.zalo_runtime_target='server';

DO $smoke$
DECLARE
  owner_fixture record;
  foreign_owner record;
  aid bigint;
  scan_aid bigint;
  invalid_aid bigint;
  inactive_aid bigint;
  sms_aid bigint;
  sms_cid bigint;
  running_cid bigint;
  direct_cid bigint;
  group_cid bigint;
  snapshot_cid bigint;
  child1 bigint;
  child2 bigint;
  bundle_id bigint;
  gid bigint;
  other_gid bigint;
  contact_id bigint;
  source_id bigint;
  prefix text := 'v288-smoke-' || txid_current()::text;
  payload jsonb;
  result jsonb;
  account_before jsonb;
  scan_before jsonb;
  running_before jsonb;
  err text;
  case_name text;
BEGIN
  SELECT a.staff_id,a.organization_id INTO owner_fixture
  FROM public.auto_accounts a JOIN public.org_staff s
    ON s.id=a.staff_id AND s.organization_id=a.organization_id AND s.is_active
  CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(a.organization_id) caps
  WHERE a.is_zalo_server AND NOT a.is_zalo_show_web AND NOT a.is_delete
    AND caps.qr_enabled AND caps.server_enabled AND caps.web_enabled
  ORDER BY a.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'v288_smoke:no_owner'; END IF;
  SELECT s.id,s.organization_id,a.id AS account_id INTO foreign_owner
  FROM public.org_staff s JOIN public.auto_accounts a ON a.staff_id=s.id AND a.organization_id=s.organization_id
  WHERE s.is_active AND s.organization_id<>owner_fixture.organization_id
    AND a.flatform_type='zalo' AND a.is_zalo_server AND NOT a.is_zalo_show_web
    AND a.is_active AND NOT a.is_delete ORDER BY a.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'v288_smoke:no_foreign_owner'; END IF;

  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES(prefix,'zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','chờ xử lý') RETURNING id INTO aid;
  payload := jsonb_build_object('name',prefix,'accountId',aid,'actionId','zalo_message_phone',
    'schedule',now()-interval '1 minute','content','fixture');
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-runtime',payload,'[]'::jsonb,'chờ xử lý');
  running_cid := (result->>'campaign_id')::bigint;
  SET LOCAL ROLE anon;
  IF NOT public.claim_campaign_runtime(running_cid,aid,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v288_smoke:claim_fixture';
  END IF;
  RESET ROLE;
  SELECT to_jsonb(a) INTO account_before FROM public.auto_accounts a WHERE id=aid;
  SELECT to_jsonb(c) INTO running_before FROM public.auto_campaigns c WHERE id=running_cid;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-direct',payload,'[]'::jsonb,'tạm dừng');
  direct_cid := (result->>'campaign_id')::bigint;

  -- First assertion reproduces the independent upload failure before v288.
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-chunk1',0,'[{"phone":"0901288001"}]',now()+interval '1 day','tạm dừng');
  IF result->>'created' IS DISTINCT FROM 'true' OR result->>'inserted' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'v288_smoke:busy_chunk_upload:%',result;
  END IF;
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-chunk1',0,'[{"phone":"0901288001"}]',now()+interval '1 day','tạm dừng');
  IF result->>'created' IS DISTINCT FROM 'false' OR result->>'inserted' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'v288_smoke:chunk_retry:%',result;
  END IF;
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-conflict',0,'[{"phone":"0901288002"}]',now()+interval '1 day','tạm dừng');
  IF result->>'reason' IS DISTINCT FROM 'input_count_conflict' THEN
    RAISE EXCEPTION 'v288_smoke:chunk_count_conflict:%',result;
  END IF;
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-chunk2',1,'[{"phone":"0901288002"}]',now()+interval '1 day','tạm dừng');
  IF result->>'created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:chunk2:%',result; END IF;
  result := public.append_control_campaign_inputs(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-legacy',2,'[{"phone":"0901288003"}]');
  IF result->>'created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:legacy:%',result; END IF;
  result := public.append_control_campaign_inputs(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-legacy',2,'[{"phone":"0901288003"}]');
  IF result->>'created' IS DISTINCT FROM 'false' OR result->>'inserted' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'v288_smoke:legacy_retry:%',result;
  END IF;
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_set_zalo_server_campaign_status(direct_cid,owner_fixture.staff_id,'chờ xử lý') r;
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:activate:%',result; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=direct_cid)<>3
    OR (SELECT status FROM public.auto_campaigns WHERE id=direct_cid)<>'chờ xử lý' THEN
    RAISE EXCEPTION 'v288_smoke:chunk_materialization';
  END IF;
  SET LOCAL ROLE anon;
  IF public.claim_campaign_runtime(direct_cid,aid,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v288_smoke:runtime_stolen';
  END IF;
  RESET ROLE;

  -- Nonempty, account-independent phone data; later intake must deduplicate it.
  INSERT INTO public.auto_account_contact_groups(account_id,contact_type,name,purpose,staff_id,organization_id,is_delete)
  VALUES(NULL,NULL,prefix,'data_group',owner_fixture.staff_id,owner_fixture.organization_id,false) RETURNING id INTO gid;
  INSERT INTO public.auto_account_contact_groups(account_id,contact_type,name,purpose,staff_id,organization_id,is_delete)
  VALUES(NULL,NULL,prefix||'-other','data_group',owner_fixture.staff_id,owner_fixture.organization_id,false) RETURNING id INTO other_gid;
  INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,phone,flatform_type,
    is_friend,is_joined,staff_id,organization_id,is_delete)
  VALUES(aid,'person',prefix,prefix||'-person1','0901288011','zalo',false,false,
    owner_fixture.staff_id,owner_fixture.organization_id,false) RETURNING id INTO contact_id;
  INSERT INTO public.auto_account_contact_group_members(group_id,contact_id,is_delete,change_revision)
  VALUES(gid,contact_id,false,0);
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-group',payload,'[]'::jsonb,'tạm dừng');
  group_cid := (result->>'campaign_id')::bigint;
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_preflight_campaign_data_group_change(
    owner_fixture.staff_id,owner_fixture.organization_id,group_cid,gid) r;
  IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:preflight:%',result; END IF;
  -- Wrappers must select Server even when caller's previous context is Desktop,
  -- then restore that context. Service JWT is the same as the Web backend.
  SET LOCAL aka_agent.zalo_runtime_target='desktop';
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_preflight_campaign_data_group_change(
    owner_fixture.staff_id,owner_fixture.organization_id,group_cid,gid,NULL,NULL) r;
  IF result->>'allowed' IS DISTINCT FROM 'true' OR current_setting('aka_agent.zalo_runtime_target')<>'desktop' THEN
    RAISE EXCEPTION 'v288_smoke:preflight_wrapper:%',result;
  END IF;
  result := public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-bind',group_cid,gid,NULL,NULL,NULL);
  source_id := (result->>'id')::bigint;
  IF result->>'status' IS DISTINCT FROM 'active' OR current_setting('aka_agent.zalo_runtime_target')<>'desktop' THEN
    RAISE EXCEPTION 'v288_smoke:bind_wrapper:%',result;
  END IF;
  SET LOCAL aka_agent.zalo_runtime_target='server';
  result := public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-bind-retry',group_cid,gid,NULL);
  IF (result->>'id')::bigint IS DISTINCT FROM source_id THEN RAISE EXCEPTION 'v288_smoke:bind_retry'; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=group_cid AND canonical_target_key IS NOT NULL)<>1
    OR (SELECT status FROM public.auto_campaigns WHERE id=group_cid)<>'tạm dừng' THEN
    RAISE EXCEPTION 'v288_smoke:bind_materialization';
  END IF;
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_preflight_campaign_data_group_change(
    owner_fixture.staff_id,owner_fixture.organization_id,group_cid,other_gid) r;
  IF result->>'reason' IS DISTINCT FROM 'campaign_data_group_source_immutable_after_intake' THEN
    RAISE EXCEPTION 'v288_smoke:immutable_preflight:%',result;
  END IF;
  BEGIN
    PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
      prefix||'-rebind',group_cid,other_gid,NULL);
    RAISE EXCEPTION 'v288_smoke:immutable_bind_accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    IF err<>'campaign_data_group_source_immutable_after_intake' THEN RAISE; END IF;
  END;
  PERFORM public.aka_agent_stop_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    group_cid,prefix||'-stop','smoke');
  RESET ROLE;
  INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,phone,flatform_type,
    is_friend,is_joined,staff_id,organization_id,is_delete)
  VALUES(aid,'person',prefix,prefix||'-person2','0901288012','zalo',false,false,
    owner_fixture.staff_id,owner_fixture.organization_id,false) RETURNING id INTO contact_id;
  INSERT INTO public.auto_account_contact_group_members(group_id,contact_id,is_delete,change_revision)
  VALUES(gid,contact_id,false,0);
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=group_cid)<>1 THEN
    RAISE EXCEPTION 'v288_smoke:stopped_source_received_data';
  END IF;
  SET LOCAL ROLE service_role;
  SET LOCAL aka_agent.zalo_runtime_target='desktop';
  result := public.aka_agent_reactivate_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    group_cid,prefix||'-reactivate','smoke',NULL,NULL);
  IF result->>'status' IS DISTINCT FROM 'active' OR current_setting('aka_agent.zalo_runtime_target')<>'desktop' THEN
    RAISE EXCEPTION 'v288_smoke:reactivate_wrapper:%',result;
  END IF;
  SET LOCAL aka_agent.zalo_runtime_target='server';
  PERFORM public.aka_agent_reactivate_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    group_cid,prefix||'-reactivate','smoke');
  RESET ROLE;
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=group_cid)<>2
    OR (SELECT status FROM public.auto_campaigns WHERE id=group_cid)<>'tạm dừng' THEN
    RAISE EXCEPTION 'v288_smoke:reactivate_missing_or_duplicate_inputs';
  END IF;

  -- Account validity must precede idempotent/unchanged early returns in all cores.
  FOREACH case_name IN ARRAY ARRAY['inactive','deleted','desktop','web','foreign'] LOOP
    IF case_name='foreign' THEN
      invalid_aid := foreign_owner.account_id;
    ELSE
      INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
        is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
      VALUES(prefix||'-'||case_name,'zalo',owner_fixture.staff_id,owner_fixture.organization_id,
        case_name NOT IN('desktop','web'),case_name='web',case_name<>'inactive',case_name='deleted','đã đăng nhập','đang chạy')
      RETURNING id INTO invalid_aid;
      IF case_name='inactive' THEN inactive_aid := invalid_aid; END IF;
    END IF;
    UPDATE public.auto_campaigns SET account_id=invalid_aid WHERE id IN(direct_cid,group_cid);
    SET LOCAL ROLE service_role;
    result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
      direct_cid,prefix||'-chunk1',0,'[{"phone":"0901288001"}]',now()+interval '1 day','tạm dừng');
    IF result->>'reason' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'v288_smoke:add_account_guard:%:%',case_name,result; END IF;
    result := public.append_control_campaign_inputs(owner_fixture.staff_id,owner_fixture.organization_id,
      direct_cid,prefix||'-legacy',2,'[{"phone":"0901288003"}]');
    IF result->>'reason' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'v288_smoke:legacy_account_guard:%:%',case_name,result; END IF;
    SELECT to_jsonb(r) INTO result FROM public.aka_agent_preflight_campaign_data_group_change(
      owner_fixture.staff_id,owner_fixture.organization_id,group_cid,gid) r;
    IF result->>'reason' IS DISTINCT FROM 'data_group_campaign_account_not_found' THEN
      RAISE EXCEPTION 'v288_smoke:preflight_account_guard:%:%',case_name,result;
    END IF;
    BEGIN
      PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
        prefix||'-invalid-bind',group_cid,gid,NULL);
      RAISE EXCEPTION 'v288_smoke:invalid_account_bind_accepted:%',case_name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
      IF err<>'data_group_campaign_account_not_found' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.aka_agent_reactivate_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
        group_cid,prefix||'-invalid-reactivate','smoke');
      RAISE EXCEPTION 'v288_smoke:invalid_account_reactivate_accepted:%',case_name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
      IF err<>'data_group_campaign_terminal' THEN RAISE; END IF;
    END;
    RESET ROLE;
  END LOOP;
  UPDATE public.auto_campaigns SET account_id=aid WHERE id IN(direct_cid,group_cid);

  -- Campaign running/terminal gates differ from an unrelated busy account.
  SET LOCAL ROLE service_role;
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
    running_cid,prefix||'-running-add',0,'[{"phone":"0901288004"}]',now()+interval '1 day','tạm dừng');
  IF result->>'reason' IS DISTINCT FROM 'campaign_running' THEN RAISE EXCEPTION 'v288_smoke:add_running:%',result; END IF;
  result := public.append_control_campaign_inputs(owner_fixture.staff_id,owner_fixture.organization_id,
    running_cid,prefix||'-running-append',0,'[{"phone":"0901288004"}]');
  IF result->>'reason' IS DISTINCT FROM 'campaign_running' THEN RAISE EXCEPTION 'v288_smoke:append_running:%',result; END IF;
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_preflight_campaign_data_group_change(
    owner_fixture.staff_id,owner_fixture.organization_id,running_cid,gid) r;
  IF result->>'reason' IS DISTINCT FROM 'data_group_campaign_not_bindable' THEN RAISE EXCEPTION 'v288_smoke:preflight_running:%',result; END IF;
  BEGIN
    PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
      prefix||'-running-bind',running_cid,gid,NULL);
    RAISE EXCEPTION 'v288_smoke:running_bind_accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    IF err<>'data_group_campaign_not_bindable' THEN RAISE; END IF;
  END;
  RESET ROLE;
  UPDATE public.auto_campaigns SET schedule_end_date=now()-interval '1 minute' WHERE id=group_cid;
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.aka_agent_reactivate_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
      group_cid,prefix||'-ended-reactivate','smoke');
    RAISE EXCEPTION 'v288_smoke:ended_reactivate_accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    IF err<>'data_group_campaign_terminal' THEN RAISE; END IF;
  END;
  RESET ROLE;
  UPDATE public.auto_campaigns SET schedule_end_date=NULL WHERE id=group_cid;

  -- Existing completed-campaign semantics: legacy append rejects; the newer
  -- add endpoint intentionally reopens with the requested schedule/status.
  UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id=direct_cid;
  SET LOCAL ROLE service_role;
  result := public.append_control_campaign_inputs(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-completed-legacy',3,'[{"phone":"0901288004"}]');
  IF result->>'reason' IS DISTINCT FROM 'campaign_completed' THEN RAISE EXCEPTION 'v288_smoke:legacy_completed:%',result; END IF;
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
    direct_cid,prefix||'-completed-add',3,'[{"phone":"0901288004"}]',now()+interval '1 day','tạm dừng');
  IF result->>'created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:add_completed:%',result; END IF;
  RESET ROLE;
  IF (SELECT status FROM public.auto_campaigns WHERE id=direct_cid)<>'tạm dừng' THEN
    RAISE EXCEPTION 'v288_smoke:add_completed_status';
  END IF;

  -- Shared Control RPCs must preserve the SMS path as well.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,status)
  VALUES(prefix||'-sms','sms',owner_fixture.staff_id,owner_fixture.organization_id,
    false,false,true,false,'đang chạy') RETURNING id INTO sms_aid;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-sms',payload||jsonb_build_object('accountId',sms_aid,'actionId','sms_send'),'[]'::jsonb,'tạm dừng');
  sms_cid := (result->>'campaign_id')::bigint;
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,
    sms_cid,prefix||'-sms-add',0,'[{"phone":"0901288001","content":"fixture"}]',now()+interval '1 day','tạm dừng');
  IF result->>'created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:sms_add:%',result; END IF;
  result := public.append_control_campaign_inputs(owner_fixture.staff_id,owner_fixture.organization_id,
    sms_cid,prefix||'-sms-append',1,'[{"phone":"0901288002","content":"fixture"}]');
  IF result->>'created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:sms_append:%',result; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=sms_cid)<>2 THEN
    RAISE EXCEPTION 'v288_smoke:sms_materialization';
  END IF;

  -- Snapshot direct intake is an unchanged adjacent path, now with real rows.
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-snapshot-campaign',payload,'[]'::jsonb,'tạm dừng');
  snapshot_cid := (result->>'campaign_id')::bigint;
  PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-snapshot',snapshot_cid,gid,now()+interval '1 day','tạm dừng',NULL,NULL);
  PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-snapshot',snapshot_cid,gid,now()+interval '1 day','tạm dừng',NULL,NULL);
  RESET ROLE;
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=snapshot_cid)<>2 THEN
    RAISE EXCEPTION 'v288_smoke:snapshot_missing_or_duplicate_inputs';
  END IF;

  -- Bundle: one account owns a campaign, another owns a scan operation.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES(prefix||'-scan','zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','tạm dừng') RETURNING id INTO scan_aid;
  SET LOCAL ROLE anon;
  result := public.claim_zalo_account_runtime_operation(scan_aid,owner_fixture.staff_id,'server','tạm dừng',gen_random_uuid(),true);
  IF result->>'claimed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v288_smoke:scan_claim:%',result; END IF;
  RESET ROLE;
  SELECT to_jsonb(a) INTO scan_before FROM public.auto_accounts a WHERE id=scan_aid;
  INSERT INTO public.auto_campaign_creation_bundles(request_id,status,expected_campaign_count,staff_id,organization_id)
  VALUES(prefix||'-bundle','staged',2,owner_fixture.staff_id,owner_fixture.organization_id) RETURNING id INTO bundle_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-child1',payload,'[]'::jsonb,'tạm dừng');
  child1 := (result->>'campaign_id')::bigint;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-child2',payload||jsonb_build_object('accountId',scan_aid),'[]'::jsonb,'tạm dừng');
  child2 := (result->>'campaign_id')::bigint;
  RESET ROLE;
  UPDATE public.auto_campaigns SET creation_bundle_id=bundle_id,
    creation_bundle_child_index=CASE WHEN id=child1 THEN 0 ELSE 1 END,provisioning_state='staged'
  WHERE id IN (child1,child2);
  SET LOCAL ROLE service_role;
  PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-bind-child1',child1,gid,bundle_id,NULL,NULL);
  RESET ROLE;
  IF (SELECT status FROM public.auto_campaign_creation_bundles WHERE id=bundle_id)<>'staged'
    OR EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE campaign_id IN (child1,child2)) THEN
    RAISE EXCEPTION 'v288_smoke:partial_bundle_activated';
  END IF;
  -- Final child's call must validate the OTHER child's account as well.
  UPDATE public.auto_campaigns SET account_id=inactive_aid WHERE id=child1;
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
      prefix||'-bind-child2',child2,gid,bundle_id,NULL,NULL);
    RAISE EXCEPTION 'v288_smoke:invalid_other_child_accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    IF err<>'data_group_campaign_account_not_found' THEN RAISE; END IF;
  END;
  RESET ROLE;
  UPDATE public.auto_campaigns SET account_id=aid WHERE id=child1;
  SET LOCAL ROLE service_role;
  PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-bind-child2',child2,gid,bundle_id,NULL,NULL);
  PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-bind-child2',child2,gid,bundle_id,NULL,NULL);
  PERFORM public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix||'-bind-child1-new-request',child1,gid,bundle_id,NULL,NULL);
  RESET ROLE;
  IF (SELECT status FROM public.auto_campaign_creation_bundles WHERE id=bundle_id)<>'ready'
    OR (SELECT ready_campaign_count FROM public.auto_campaign_creation_bundles WHERE id=bundle_id)<>2
    OR (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=child1)<>2
    OR (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=child2)<>2
    OR EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id IN(child1,child2) AND (status<>'tạm dừng' OR provisioning_state<>'ready')) THEN
    RAISE EXCEPTION 'v288_smoke:bundle_missing_duplicate_or_wrong_status';
  END IF;

  -- No data/config operation may change account runtime ownership or its owner.
  IF (SELECT to_jsonb(a) FROM public.auto_accounts a WHERE id=aid) IS DISTINCT FROM account_before
    OR (SELECT to_jsonb(a) FROM public.auto_accounts a WHERE id=scan_aid) IS DISTINCT FROM scan_before
    OR (SELECT to_jsonb(c) FROM public.auto_campaigns c WHERE id=running_cid) IS DISTINCT FROM running_before THEN
    RAISE EXCEPTION 'v288_smoke:runtime_ownership_modified';
  END IF;
END;
$smoke$;
SELECT 'v288_behavior_passed' AS result;
ROLLBACK;
