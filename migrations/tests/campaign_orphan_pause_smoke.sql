-- Run inside a transaction and always ROLLBACK. Only reserved fixture rows are changed.
DO $smoke$
DECLARE
  sid constant bigint := 8800410000000001;
  aid constant bigint := 8800410000000002;
  cid constant bigint := 8800410000000003;
  oid bigint;
  r record;
  mode text;
  before_status text;
  expected text;
  checks integer := 0;
BEGIN
  SELECT org.id INTO oid FROM public.org_organization org
  CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(org.id) cap
  WHERE org.id = 1 AND cap.qr_enabled AND cap.server_enabled;
  IF oid IS NULL THEN RAISE EXCEPTION 'Fixture requires organization 1 with Server capability'; END IF;
  IF EXISTS (SELECT 1 FROM public.org_staff WHERE id=sid)
    OR EXISTS (SELECT 1 FROM public.org_staff WHERE id=sid+10)
    OR EXISTS (SELECT 1 FROM public.auto_accounts WHERE id=aid)
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id=cid)
  THEN RAISE EXCEPTION 'Reserved fixture ID collision'; END IF;
  INSERT INTO public.org_staff(id,organization_id,name,phone,username,password,is_active)
    OVERRIDING SYSTEM VALUE VALUES(sid,oid,'__orphan_pause__','8800410000000001','__orphan_pause__','rollback-only',true);
  INSERT INTO public.org_staff(id,organization_id,name,phone,username,password,is_active)
    OVERRIDING SYSTEM VALUE VALUES(sid+10,oid,'__orphan_pause_other__','8800410000000011','__orphan_pause_other__','rollback-only',true);
  INSERT INTO public.auto_accounts(id,name,flatform_type,is_zalo_show_web,is_zalo_server,login_status,status,is_active,staff_id,organization_id,is_delete)
    OVERRIDING SYSTEM VALUE VALUES(aid,'__orphan_pause__','zalo',false,false,'chưa đăng nhập','chờ xử lý',false,sid,oid,true);
  INSERT INTO public.auto_campaigns(id,name,action_id,account_id,status,content,schedule,data_target_source_mode,staff_id,organization_id,is_delete)
    OVERRIDING SYSTEM VALUE VALUES(cid,'__orphan_pause__','zalo_message_phone',aid,'chờ xử lý','',now(),'direct',sid,oid,false);

  FOREACH mode IN ARRAY ARRAY['qr','web','server'] LOOP
    UPDATE public.auto_accounts SET is_zalo_show_web=mode='web', is_zalo_server=mode='server' WHERE id=aid;
    FOREACH before_status IN ARRAY ARRAY['chờ xử lý','đang chạy','tạm dừng','hoàn thành'] LOOP
      UPDATE public.auto_campaigns SET status=before_status WHERE id=cid;
      IF mode='server' THEN
        SELECT * INTO r FROM public.aka_agent_set_zalo_server_campaign_status(cid,sid,'tạm dừng');
      ELSE
        SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'tạm dừng');
      END IF;
      expected := CASE WHEN before_status='tạm dừng' THEN 'already_target'
        WHEN before_status='hoàn thành' THEN 'invalid_transition'
        WHEN before_status='đang chạy' AND mode<>'server' THEN 'runtime_busy'
        ELSE 'updated' END;
      IF r.reason IS DISTINCT FROM expected OR r.ok IS DISTINCT FROM (expected IN ('updated','already_target'))
      THEN RAISE EXCEPTION 'pause %/%: expected %, got %',mode,before_status,expected,row_to_json(r); END IF;
      checks := checks+1;
    END LOOP;
    UPDATE public.auto_campaigns SET status='tạm dừng' WHERE id=cid;
    IF mode='server' THEN
      SELECT * INTO r FROM public.aka_agent_set_zalo_server_campaign_status(cid,sid,'chờ xử lý');
      expected := 'not_found';
    ELSE
      SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'chờ xử lý');
      expected := 'account_deleted';
    END IF;
    IF r.ok OR r.reason IS DISTINCT FROM expected THEN RAISE EXCEPTION 'deleted resume %: %',mode,row_to_json(r); END IF;
    checks := checks+1;
  END LOOP;

  -- Deleted Server accounts must still never be routed through Desktop control.
  SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'tạm dừng');
  IF r.reason IS DISTINCT FROM 'runtime_not_owner' THEN RAISE EXCEPTION 'runtime route weakened'; END IF;
  UPDATE public.auto_accounts SET is_zalo_server=false WHERE id=aid;
  UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=cid;
  UPDATE public.auto_campaigns SET runtime_claim_token='41000000-0000-4000-8000-000000000001',
    runtime_claim_target='desktop',runtime_claim_vietnam_date=current_date,runtime_claimed_at=now() WHERE id=cid;
  SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'tạm dừng');
  IF r.reason IS DISTINCT FROM 'runtime_busy' THEN RAISE EXCEPTION 'parent claim guard weakened'; END IF;
  UPDATE public.auto_campaigns SET runtime_claim_token=NULL,runtime_claim_target=NULL,runtime_claim_vietnam_date=NULL,runtime_claimed_at=NULL,
    runtime_unit_token='41000000-0000-4000-8000-000000000002',runtime_unit_vietnam_date=current_date,
    runtime_unit_claimed_at=now(),runtime_unit_input_data_ids=ARRAY[]::bigint[] WHERE id=cid;
  SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'tạm dừng');
  IF r.reason IS DISTINCT FROM 'unit_lease_busy' THEN RAISE EXCEPTION 'unit guard weakened'; END IF;
  UPDATE public.auto_campaigns SET runtime_unit_token=NULL,runtime_unit_vietnam_date=NULL,runtime_unit_claimed_at=NULL,runtime_unit_input_data_ids=NULL WHERE id=cid;
  SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid+1,sid,'tạm dừng');
  IF r.reason IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'account ownership guard weakened'; END IF;
  SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid+10,'tạm dừng');
  IF r.reason IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'staff ownership guard weakened'; END IF;
  UPDATE public.auto_campaigns SET is_delete=true WHERE id=cid;
  SELECT * INTO r FROM public.aka_agent_set_desktop_campaign_status_v2(cid,aid,sid,'tạm dừng');
  IF r.reason IS DISTINCT FROM 'campaign_deleted' THEN RAISE EXCEPTION 'deleted campaign guard weakened'; END IF;
  checks := checks+6;
  RAISE NOTICE 'PASS campaign orphan pause: % checks',checks;
END;
$smoke$;
