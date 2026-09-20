-- Wrap in BEGIN/ROLLBACK (after v301 for the before-deploy check).
-- Fixtures never call Google or run a campaign; no production data is retained.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $smoke$
DECLARE
  a public.org_staff%ROWTYPE; g bigint; typ bigint; src jsonb; cfg jsonb;
  rows jsonb:='[{"phone":"0333875455","contact_type":"phone"},{"phone":"0703576704","contact_type":"phone"},{"phone":"0333875455","contact_type":"phone"},{"phone":"0703576704","contact_type":"phone"}]';
  result jsonb; job jsonb; first_result jsonb; first_run bigint; v_token uuid;
  operation text; plan jsonb; prefix text:='sheet-v301-'||txid_current();
BEGIN
  PERFORM 1 FROM public.auto_data_group_sheet_worker_state WHERE id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.auto_data_group_sheet_worker_state WHERE id AND lease_expires_at>now()) THEN
    RAISE EXCEPTION 'v301 smoke: worker is busy; retry when idle';
  END IF;
  IF public.aka_agent_sheet_identity('phone','{"phone":"333875455"}') IS DISTINCT FROM '0333875455'
    OR public.aka_agent_sheet_identity('phone','{"phone":"703576704"}') IS DISTINCT FROM '0703576704'
  THEN RAISE EXCEPTION 'v301 phone canonical keys'; END IF;
  SELECT * INTO a FROM public.org_staff WHERE is_active AND organization_id IS NOT NULL ORDER BY id LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'v301 smoke requires staff'; END IF;
  typ:=public.aka_agent_data_type_category_item_id('phone');
  result:=public.aka_agent_create_data_group_v2(a.id,a.organization_id,prefix,'#123456',prefix,typ,NULL,NULL,NULL);
  g:=(result->>'id')::bigint;
  cfg:='{"url":"https://docs.google.com/spreadsheets/d/smoke/edit#gid=0","dataTypeCode":"phone","hasHeader":true,"expectedHeaders":["Phone"],"mapping":[{"column":0,"field":"phone"}]}';
  result:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'preview',jsonb_build_object('groupId',g,'config',cfg,'rows',rows));
  IF (result->>'new_count')::int IS DISTINCT FROM 2 OR (result->>'duplicate_count')::int IS DISTINCT FROM 2 OR (result->>'invalid_count')::int IS DISTINCT FROM 0
    THEN RAISE EXCEPTION 'v301 phone preview: %',result; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE group_id=g) THEN RAISE EXCEPTION 'v301 preview wrote members'; END IF;

  FOREACH operation IN ARRAY ARRAY['success','recover','toggle','delete'] LOOP
    src:=public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,'save',jsonb_build_object(
      'groupId',g,'requestId',prefix||operation,'name',prefix||operation,'config',cfg,'everyHours',6,'isEnabled',true));
    -- Make this fixture the earliest candidate without changing real sources.
    UPDATE public.auto_data_group_external_sync_sources SET next_run_at='-infinity' WHERE id=(src->>'id')::bigint;
    IF operation='recover' THEN
      INSERT INTO public.auto_data_group_external_sync_runs(source_id,group_id,staff_id,organization_id,source_name,token,source_revision,started_at)
        SELECT id,group_id,staff_id,organization_id,name,gen_random_uuid(),revision,now()-interval '4 minutes'
        FROM public.auto_data_group_external_sync_sources WHERE id=(src->>'id')::bigint;
    END IF;
    v_token:=gen_random_uuid();
    UPDATE public.auto_data_group_sheet_worker_state SET enabled=true,token=v_token,claimed=false,lease_expires_at=now()+interval '180 seconds' WHERE id;
    job:=public.aka_agent_sheet_claim(v_token);
    IF (job->>'sourceId')::bigint IS DISTINCT FROM (src->>'id')::bigint THEN RAISE EXCEPTION 'v301 wrong claim'; END IF;
    IF operation IN ('toggle','delete') THEN
      PERFORM public.aka_agent_data_group_external_sync(a.id,a.organization_id,a.username,a.password,operation,
        jsonb_build_object('groupId',g,'id',src->'id','expectedRevision',src->'revision','enabled',false));
      IF NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_runs WHERE token=v_token AND status='cancelled') THEN RAISE EXCEPTION 'v301 cancellation'; END IF;
      result:=public.aka_agent_sheet_finish(v_token,rows,4,0);
      IF result->>'stale' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v301 stale finish: %',result; END IF;
    ELSE
      result:=public.aka_agent_sheet_finish(v_token,rows,4,0);
      IF (result->>'addedCount')::int IS DISTINCT FROM (CASE WHEN operation='success' THEN 2 ELSE 0 END)
        OR (result->>'duplicateCount')::int IS DISTINCT FROM (CASE WHEN operation='success' THEN 2 ELSE 4 END)
        OR (result->>'invalidCount')::int IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'v301 finish: %',result; END IF;
      IF public.aka_agent_sheet_finish(v_token,rows,4,0) IS DISTINCT FROM result THEN RAISE EXCEPTION 'v301 replay'; END IF;
      IF operation='success' THEN first_result:=result; first_run:=(job->>'runId')::bigint;
      ELSIF NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_runs WHERE source_id=(src->>'id')::bigint AND status='interrupted') THEN
        RAISE EXCEPTION 'v301 recovery';
      END IF;
    END IF;
  END LOOP;
  IF (SELECT array_agg(c.phone ORDER BY c.phone) FROM public.auto_account_contacts c JOIN public.auto_account_contact_group_members m ON m.contact_id=c.id WHERE m.group_id=g)
    IS DISTINCT FROM ARRAY['0333875455','0703576704']::text[] THEN RAISE EXCEPTION 'v301 persisted phones'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_runs r WHERE r.id=first_run AND r.status='success' AND r.result=first_result) THEN RAISE EXCEPTION 'v301 changed completed history'; END IF;

  -- Verify eligibility, not a claimed speedup on the tiny production table.
  -- Planner settings are transaction-local and never changed in production.
  PERFORM set_config('enable_seqscan','off',true);
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT id FROM public.auto_data_group_external_sync_runs WHERE source_id=$1 AND status=''running'' AND started_at<now()-interval ''180 seconds'''
    INTO plan USING (src->>'id')::bigint;
  IF plan::text NOT LIKE '%idx_data_group_external_sync_runs_running%' THEN RAISE EXCEPTION 'v301 recovery index not usable'; END IF;
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT id FROM public.auto_data_group_external_sync_runs WHERE source_id=$1 AND status=''running'''
    INTO plan USING (src->>'id')::bigint;
  IF plan::text NOT LIKE '%idx_data_group_external_sync_runs_running%' THEN RAISE EXCEPTION 'v301 cancel index not usable'; END IF;
END;
$smoke$;
SELECT 'PASS: phone preview/import/dedupe/replay; recovery/cancel/delete; running index eligibility' AS result;
