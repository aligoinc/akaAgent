-- Audit only: every fixture/mutation rolls back; no message is sent.
-- Returns current behavior, including known failures; this is not a passing regression assertion suite.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $audit$
DECLARE
  owner_fixture record;
  aid bigint;
  cid bigint;
  direct_cid bigint;
  gid bigint;
  iid bigint;
  prefix text := 'campaign-flow-audit-' || txid_current()::text;
  result jsonb;
  results jsonb := '{}'::jsonb;
  err text;
  payload jsonb;
BEGIN
  SELECT a.staff_id,a.organization_id INTO owner_fixture
  FROM public.auto_accounts a JOIN public.org_staff s
    ON s.id=a.staff_id AND s.organization_id=a.organization_id AND s.is_active=true
  CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(a.organization_id) caps
  WHERE a.is_zalo_server=true AND a.is_zalo_show_web=false AND a.is_delete=false
    AND caps.qr_enabled AND caps.server_enabled ORDER BY a.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_test_owner'; END IF;
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES(prefix,'zalo',owner_fixture.staff_id,owner_fixture.organization_id,true,false,true,false,'đã đăng nhập','đang chạy') RETURNING id INTO aid;
  payload := jsonb_build_object('name',prefix,'accountId',aid,'actionId','zalo_message_group','schedule',now()+interval '1 day','content','fixture');
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,prefix,payload,'[]'::jsonb,'tạm dừng');
  cid := (result->>'campaign_id')::bigint;
  results := results || jsonb_build_object('create_busy',result->>'created');
  result := public.add_control_campaign_input_rows(owner_fixture.staff_id,owner_fixture.organization_id,cid,prefix||'-add',0,'[{"uid":"audit-fixture"}]'::jsonb,now()+interval '1 day','tạm dừng');
  results := results || jsonb_build_object('add_data_busy',result);
  result := public.append_control_campaign_inputs(owner_fixture.staff_id,owner_fixture.organization_id,cid,prefix||'-legacy',0,'[{"uid":"audit-fixture"}]'::jsonb);
  results := results || jsonb_build_object('legacy_append_busy',result);
  RESET ROLE;
  INSERT INTO public.auto_account_contact_groups(account_id,contact_type,name,purpose,staff_id,organization_id,is_delete)
  VALUES(NULL,NULL,prefix,'data_group',owner_fixture.staff_id,owner_fixture.organization_id,false) RETURNING id INTO gid;
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_preflight_campaign_data_group_change(owner_fixture.staff_id,owner_fixture.organization_id,cid,gid) r;
  results := results || jsonb_build_object('preflight_group_busy',result);
  BEGIN
    result := public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,prefix||'-bind',cid,gid,NULL);
    results := results || jsonb_build_object('bind_group_busy',result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    results := results || jsonb_build_object('bind_group_busy',err);
  END;
  RESET ROLE;
  UPDATE public.auto_accounts SET status='chờ xử lý' WHERE id=aid;
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_preflight_campaign_data_group_change(owner_fixture.staff_id,owner_fixture.organization_id,cid,gid) r;
  results := results || jsonb_build_object('preflight_group_idle',result);
  BEGIN
    result := public.aka_agent_bind_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,prefix||'-bind-idle',cid,gid,NULL);
    results := results || jsonb_build_object('bind_group_idle','success');
    PERFORM public.aka_agent_stop_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,cid,prefix||'-stop','audit');
    RESET ROLE;
    UPDATE public.auto_accounts SET status='đang chạy' WHERE id=aid;
    SET LOCAL ROLE service_role;
    BEGIN
      result := public.aka_agent_reactivate_campaign_data_group_source(owner_fixture.staff_id,owner_fixture.organization_id,cid,prefix||'-reactivate','audit');
      results := results || jsonb_build_object('reactivate_group_busy',result);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
      results := results || jsonb_build_object('reactivate_group_busy',err);
    END;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    results := results || jsonb_build_object('bind_idle_fixture_error',err);
  END;
  RESET ROLE;
  UPDATE public.auto_accounts SET status='đang chạy' WHERE id=aid;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,prefix||'-direct',payload,'[]'::jsonb,'tạm dừng');
  direct_cid := (result->>'campaign_id')::bigint;
  BEGIN
    result := public.aka_agent_snapshot_data_group_to_direct_campaign(owner_fixture.staff_id,owner_fixture.organization_id,prefix||'-snapshot',direct_cid,gid,now()+interval '1 day','tạm dừng',NULL,NULL);
    results := results || jsonb_build_object('snapshot_group_busy','success');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    results := results || jsonb_build_object('snapshot_group_busy',err);
  END;
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_set_zalo_server_campaign_status(direct_cid,owner_fixture.staff_id,'chờ xử lý') r;
  results := results || jsonb_build_object('resume_busy',result->>'ok');
  SELECT to_jsonb(r) INTO result FROM public.aka_agent_set_zalo_server_campaign_status(direct_cid,owner_fixture.staff_id,'tạm dừng') r;
  results := results || jsonb_build_object('pause_busy',result->>'ok');
  RESET ROLE;
  INSERT INTO public.auto_campaign_input_data(campaign_id,uid,status,is_delete)
  VALUES(direct_cid,'audit-fixture','tạm dừng',false) RETURNING id INTO iid;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_input_statuses_atomic(owner_fixture.staff_id,owner_fixture.organization_id,direct_cid,ARRAY[iid],'chờ xử lý',NULL);
  results := results || jsonb_build_object('rerun_input_busy',result);
  result := public.delete_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,direct_cid);
  results := results || jsonb_build_object('delete_paused_busy',result->>'deleted');
  RESET ROLE;
  PERFORM set_config('aka_agent.audit_results',results::text,true);
END;
$audit$;
SELECT current_setting('aka_agent.audit_results')::jsonb AS results;
ROLLBACK;
