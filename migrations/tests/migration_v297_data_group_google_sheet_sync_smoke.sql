-- Append to the migration transaction BEFORE its final ROLLBACK, or wrap this
-- fixture with BEGIN/ROLLBACK after deployment. No Google HTTP request is made.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $smoke$
DECLARE
  a public.org_staff%ROWTYPE; b public.org_staff%ROWTYPE;
  g bigint; typ bigint; src jsonb; src2 jsonb; cfg jsonb; input jsonb; rows jsonb; result jsonb; first_result jsonb;
  v_token uuid; src_id bigint; member_id bigint; contact_id bigint; cnt bigint; job jsonb; before_contact jsonb;
  retry_minutes integer; i integer;
  prefix text:='sheet-smoke-'||txid_current();
BEGIN
  SELECT * INTO a FROM public.org_staff WHERE is_active AND organization_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT * INTO b FROM public.org_staff WHERE is_active AND organization_id IS NOT NULL AND id<>a.id ORDER BY id LIMIT 1;
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'sheet_smoke_requires_staff'; END IF;
  typ:=public.aka_agent_data_type_category_item_id('phone');
  result:=public.aka_agent_create_data_group_v2(a.id,a.organization_id,prefix,'#123456',prefix,typ,NULL,NULL,NULL); g:=(result->>'id')::bigint;
  cfg:=jsonb_build_object('url','https://docs.google.com/spreadsheets/d/smoke/edit#gid=0','dataTypeCode','phone','hasHeader',true,
    'expectedHeaders',jsonb_build_array('Phone','Tên'),'mapping',jsonb_build_array(jsonb_build_object('column',0,'field','phone'),jsonb_build_object('column',1,'field','name')));
  input:=jsonb_build_object('groupId',g,'requestId',prefix,'name','Khách thử','config',cfg,'everyHours',6,'isEnabled',true,'endDate',NULL);
  src:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',input); src_id:=(src->>'id')::bigint;
  IF public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',input) IS DISTINCT FROM src THEN RAISE EXCEPTION 'sheet_smoke_save_idempotency'; END IF;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  BEGIN
    PERFORM public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,'invalid-smoke-password','list',jsonb_build_object('groupId',g));
    RAISE EXCEPTION 'sheet_smoke_bad_password_allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='sheet_smoke_bad_password_allowed' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_data_group_external_sync(b.id,b.organization_id,b.username,b.password,'list',jsonb_build_object('groupId',g));
    RAISE EXCEPTION 'sheet_smoke_cross_tenant_allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='sheet_smoke_cross_tenant_allowed' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  rows:=jsonb_build_array(jsonb_build_object('phone','0912345678','name','Tên đầu','contact_type','phone','flatform_type',NULL),
    jsonb_build_object('phone','+84912345678','name','Tên trùng','contact_type','phone','flatform_type',NULL));
  result:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'preview',input||jsonb_build_object('rows',rows));
  IF (result->>'new_count')::integer<>1 OR (result->>'duplicate_count')::integer<>1 THEN RAISE EXCEPTION 'sheet_smoke_preview %',result; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE group_id=g) THEN RAISE EXCEPTION 'sheet_smoke_preview_wrote_data'; END IF;
  v_token:=gen_random_uuid();
  UPDATE public.auto_data_group_sheet_worker_state SET enabled=true,token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token);
  IF (job->>'sourceId')::bigint IS DISTINCT FROM src_id THEN RAISE EXCEPTION 'sheet_smoke_claim %',job; END IF;
  IF public.aka_agent_sheet_claim(v_token) IS NOT NULL THEN RAISE EXCEPTION 'sheet_smoke_duplicate_claim'; END IF;
  result:=public.aka_agent_sheet_finish(v_token,rows,2,0);
  IF (result->>'addedCount')::integer IS DISTINCT FROM 1 OR (result->>'duplicateCount')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'sheet_smoke_finish %',result; END IF;
  first_result:=result;
  IF public.aka_agent_sheet_finish(v_token,rows,2,0) IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'sheet_smoke_finish_replay'; END IF;
  SELECT m.id,m.contact_id,to_jsonb(c) INTO member_id,contact_id,before_contact FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id WHERE m.group_id=g;
  IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_group_member_origins o JOIN public.category_item ci ON ci.id=o.source_category_item_id WHERE o.membership_id=member_id AND o.kind='external_sync' AND ci.code='external_sync') THEN RAISE EXCEPTION 'sheet_smoke_provenance'; END IF;
  -- Repeated and cross-source data cannot change the existing contact.
  src2:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',input||jsonb_build_object('requestId',prefix||'-2','name','Nguồn hai'));
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token); result:=public.aka_agent_sheet_finish(v_token,rows,2,0);
  IF (result->>'addedCount')::integer IS DISTINCT FROM 0 OR (SELECT to_jsonb(c) FROM public.auto_account_contacts c WHERE c.id=contact_id) IS DISTINCT FROM before_contact THEN RAISE EXCEPTION 'sheet_smoke_duplicate_overwrote %',result; END IF;
  UPDATE public.auto_account_contact_group_members SET is_delete=true WHERE id=member_id;
  result:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'preview',input||jsonb_build_object('rows',rows));
  IF (result->>'new_count')::integer<>0 THEN RAISE EXCEPTION 'sheet_smoke_readds_removed'; END IF;
  UPDATE public.auto_account_contacts SET is_delete=true WHERE id=contact_id;
  -- A new identity can be cancelled between download and commit.
  UPDATE public.auto_data_group_external_sync_sources SET next_run_at=now() WHERE id=src_id;
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token);
  PERFORM public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'toggle',jsonb_build_object('groupId',g,'id',src_id,'expectedRevision',1,'enabled',false));
  result:=public.aka_agent_sheet_finish(v_token,jsonb_build_array(jsonb_build_object('phone','0987654321','contact_type','phone')),1,0);
  IF result->>'stale' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM public.auto_account_contact_group_members WHERE group_id=g)<>1 THEN RAISE EXCEPTION 'sheet_smoke_late_write %',result; END IF;
  BEGIN
    PERFORM public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'delete',jsonb_build_object('groupId',g,'id',src_id,'expectedRevision',1));
    RAISE EXCEPTION 'sheet_smoke_stale_revision_allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'sheet_sync_conflict' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'delete',jsonb_build_object('groupId',g,'id',src_id,'expectedRevision',2));
  IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE id=member_id) THEN RAISE EXCEPTION 'sheet_smoke_delete_removed_data'; END IF;
  -- Transient errors use 5/15/60-minute DB scheduling and finalize replay.
  FOR i IN 1..3 LOOP
    UPDATE public.auto_data_group_external_sync_sources SET next_run_at=now() WHERE id=(src2->>'id')::bigint;
    v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
    job:=public.aka_agent_sheet_claim(v_token);
    result:=public.aka_agent_sheet_finish(v_token,'[]',0,0,'Mạng tạm gián đoạn',false);
    retry_minutes:=CASE i WHEN 1 THEN 5 WHEN 2 THEN 15 ELSE 60 END;
    IF NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_sources WHERE id=(src2->>'id')::bigint AND is_enabled AND status='retry'
      AND abs(extract(epoch FROM next_run_at-clock_timestamp())-retry_minutes*60)<3) THEN RAISE EXCEPTION 'sheet_smoke_retry_%',i; END IF;
    IF public.aka_agent_sheet_finish(v_token,'[]',0,0,'Mạng tạm gián đoạn',false) IS DISTINCT FROM result THEN RAISE EXCEPTION 'sheet_smoke_error_replay'; END IF;
  END LOOP;
  UPDATE public.auto_data_group_external_sync_sources SET next_run_at=now() WHERE id=(src2->>'id')::bigint;
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token);
  PERFORM public.aka_agent_sheet_finish(v_token,'[]',0,0,'Cột của Sheet đã thay đổi',true);
  IF NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_sources WHERE id=(src2->>'id')::bigint AND NOT is_enabled AND status='error') THEN RAISE EXCEPTION 'sheet_smoke_permanent'; END IF;
  BEGIN
    PERFORM public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'toggle',jsonb_build_object('groupId',g,'id',src2->'id','expectedRevision',1,'enabled',true));
    RAISE EXCEPTION 'sheet_smoke_error_toggle_allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'sheet_sync_requires_save' THEN RAISE; END IF; END;
  -- A stopped source can be repaired by saving. End date includes all of the VN day.
  src2:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',input||jsonb_build_object('id',src2->'id','expectedRevision',1,'endDate',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date));
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token);
  IF job IS NULL THEN RAISE EXCEPTION 'sheet_smoke_end_date_today'; END IF;
  -- Changing/deleting a source while claimed also invalidates a late response.
  PERFORM public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'delete',jsonb_build_object('groupId',g,'id',src2->'id','expectedRevision',2));
  result:=public.aka_agent_sheet_finish(v_token,rows,2,0);
  IF result->>'stale' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'sheet_smoke_delete_in_flight'; END IF;
  src2:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',input||jsonb_build_object('requestId',prefix||'-3'));
  UPDATE public.auto_data_group_external_sync_sources SET end_date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-1 WHERE id=(src2->>'id')::bigint;
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token);
  IF job IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_sources WHERE id=(src2->>'id')::bigint AND status='expired' AND NOT is_enabled) THEN RAISE EXCEPTION 'sheet_smoke_expired'; END IF;
  -- A crashed worker's expired lease can be claimed once, with no duplicate import.
  UPDATE public.auto_data_group_external_sync_sources SET end_date=NULL,is_enabled=true,status='running',next_run_at=now()-interval '1 minute',run_token=gen_random_uuid() WHERE id=(src2->>'id')::bigint;
  INSERT INTO public.auto_data_group_external_sync_runs(source_id,group_id,staff_id,organization_id,source_name,token,source_revision,started_at)
    SELECT id,group_id,staff_id,organization_id,name,run_token,revision,now()-interval '4 minutes' FROM public.auto_data_group_external_sync_sources WHERE id=(src2->>'id')::bigint;
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token);
  IF job IS NULL OR NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_runs WHERE source_id=(src2->>'id')::bigint AND status='interrupted') THEN RAISE EXCEPTION 'sheet_smoke_expired_lease_recovery'; END IF;
  result:=public.aka_agent_sheet_finish(v_token,rows,2,0);
  IF (result->>'addedCount')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'sheet_smoke_recovery_duplicates'; END IF;
  IF has_table_privilege('anon','public.auto_data_group_external_sync_sources','SELECT') OR has_function_privilege('anon','public.aka_agent_sheet_claim(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.aka_agent_sheet_classify(bigint,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'sheet_smoke_acl'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='aka-agent-data-group-dynamic-filter-worker' AND schedule='30 seconds')<>1 THEN RAISE EXCEPTION 'sheet_smoke_cron'; END IF;
END;
$smoke$;
DO $zalo$
DECLARE a public.auto_accounts%ROWTYPE; s public.org_staff%ROWTYPE; g bigint; typ bigint; c bigint; rev bigint;
  cfg jsonb; src jsonb; rows jsonb; result jsonb; before_contact jsonb; v_token uuid; job jsonb; valid_count bigint;
  prefix text:='sheet-zalo-'||txid_current(); uid text:='999999'||txid_current();
BEGIN
  SELECT account.* INTO a FROM public.auto_accounts account JOIN public.org_staff staff ON staff.id=account.staff_id AND staff.is_active
  WHERE public.aka_agent_data_group_account_available(account.id,account.staff_id,account.organization_id) ORDER BY account.id LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'sheet_smoke_requires_zalo_account'; END IF;
  SELECT * INTO s FROM public.org_staff WHERE id=a.staff_id;
  typ:=public.aka_agent_data_type_category_item_id('zalo_person');
  result:=public.aka_agent_create_data_group_v2(s.id,s.organization_id,prefix,'#123456',prefix,typ,a.id,NULL,NULL); g:=(result->>'id')::bigint;
  SELECT revision INTO rev FROM public.auto_account_contact_groups WHERE id=g;
  INSERT INTO public.auto_account_contacts(account_id,contact_type,flatform_type,uid,name,staff_id,organization_id)
    VALUES(a.id,'person','zalo',uid,'Tên cần giữ nguyên',s.id,s.organization_id) RETURNING id,to_jsonb(auto_account_contacts.*) INTO c,before_contact;
  cfg:=jsonb_build_object('url','https://docs.google.com/spreadsheets/d/smoke/edit#gid=0','dataTypeCode','zalo_person','hasHeader',true,
    'expectedHeaders',jsonb_build_array('UID'),'mapping',jsonb_build_array(jsonb_build_object('column',0,'field','uid')));
  src:=public.aka_agent_data_group_external_sync(s.id,s.organization_id,s.username,s.password,'save',jsonb_build_object('groupId',g,'requestId',prefix,'name',prefix,'config',cfg,'everyHours',6,'isEnabled',true));
  rows:=jsonb_build_array(jsonb_build_object('uid',uid,'name','Tên trên Sheet không được ghi đè','contact_type','person','flatform_type','zalo'));
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token); result:=public.aka_agent_sheet_finish(v_token,rows,1,0);
  IF (result->>'addedCount')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'sheet_smoke_zalo_ingest %',result; END IF;
  IF (SELECT to_jsonb(t) FROM public.auto_account_contacts t WHERE id=c) IS DISTINCT FROM before_contact THEN RAISE EXCEPTION 'sheet_smoke_zalo_overwrites'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auto_account_contact_groups WHERE id=g AND revision>rev AND bound_zalo_account_id=a.id)
    OR NOT EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE group_id=g AND contact_id=c AND NOT is_delete) THEN RAISE EXCEPTION 'sheet_smoke_zalo_binding_revision'; END IF;
  SELECT valid_target_count INTO valid_count FROM public.aka_agent_preview_data_group_campaign_targets(s.id,s.organization_id,g,'zalo_message_group_member',ARRAY[a.id]);
  IF valid_count<>1 THEN RAISE EXCEPTION 'sheet_smoke_campaign_target %',valid_count; END IF;
  IF (SELECT count(*) FROM public.aka_agent_list_data_group_members_v3(s.id,s.organization_id,g,NULL,NULL,false,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,100,NULL,NULL,ARRAY['external_sync']))<>1 THEN RAISE EXCEPTION 'sheet_smoke_source_filter'; END IF;
  IF (SELECT count(*) FROM public.aka_agent_list_data_group_members_v3(s.id,s.organization_id,g,NULL,NULL,false,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,100,NULL,NULL,ARRAY['upload']))<>0 THEN RAISE EXCEPTION 'sheet_smoke_other_source_filter'; END IF;
  UPDATE public.auto_data_group_external_sync_sources SET next_run_at=now() WHERE id=(src->>'id')::bigint;
  v_token:=gen_random_uuid(); UPDATE public.auto_data_group_sheet_worker_state SET token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
  job:=public.aka_agent_sheet_claim(v_token);
  UPDATE public.auto_account_contact_groups SET is_delete=true WHERE id=g;
  result:=public.aka_agent_sheet_finish(v_token,rows,1,0);
  IF result->>'error' IS NULL OR NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_sources WHERE id=(src->>'id')::bigint AND NOT is_enabled) THEN RAISE EXCEPTION 'sheet_smoke_deleted_group'; END IF;
END;
$zalo$;
