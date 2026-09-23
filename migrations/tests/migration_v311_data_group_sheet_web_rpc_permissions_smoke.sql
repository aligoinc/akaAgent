-- Run inside a transaction and always ROLLBACK. Before deployment, append after
-- v311's GRANT statements in the same rollback transaction.
-- Exercise the actual SQL role, not only the JWT claim (which misses ACL errors).
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $fixture$
DECLARE
  s record; g jsonb; typ bigint;
BEGIN
  SELECT id,organization_id INTO STRICT s FROM public.org_staff
    WHERE is_active AND organization_id IS NOT NULL ORDER BY id LIMIT 1;
  typ:=public.aka_agent_data_type_category_item_id('phone');
  g:=public.aka_agent_create_data_group_v2(s.id,s.organization_id,
    'v311-rollback-'||txid_current(),'#123456','ACL rollback smoke',typ,NULL,NULL,NULL);
  PERFORM set_config('v311.staff_id',s.id::text,true);
  PERFORM set_config('v311.organization_id',s.organization_id::text,true);
  PERFORM set_config('v311.group_id',g->>'id',true);
END;
$fixture$;

SET LOCAL ROLE service_role;
DO $service_role_smoke$
DECLARE
  s bigint:=current_setting('v311.staff_id')::bigint;
  o bigint:=current_setting('v311.organization_id')::bigint;
  g bigint:=current_setting('v311.group_id')::bigint;
  cfg jsonb; input jsonb; src jsonb; result jsonb; n bigint;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'v311: wrong test role'; END IF;
  result:=public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'list',jsonb_build_object('groupId',g));
  IF result IS DISTINCT FROM '{"sources":[],"runs":[]}'::jsonb THEN RAISE EXCEPTION 'v311: initial list'; END IF;
  cfg:=jsonb_build_object('url','https://docs.google.com/spreadsheets/d/smoke/edit#gid=0',
    'dataTypeCode','phone','hasHeader',true,'expectedHeaders',jsonb_build_array('Phone'),
    'mapping',jsonb_build_array(jsonb_build_object('column',0,'field','phone')));
  input:=jsonb_build_object('groupId',g,'requestId','v311-'||txid_current(),
    'name','ACL rollback source','config',cfg,'everyHours',6,'isEnabled',false,'endDate',NULL);
  result:=public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'preview',
    input||jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('phone','0912345678','contact_type','phone'))));
  IF (result->>'new_count')::integer+(result->>'duplicate_count')::integer IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'v311: preview'; END IF;
  src:=public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'save',input);
  IF src->>'status' IS DISTINCT FROM 'paused' OR src->>'revision' IS DISTINCT FROM '1'
    THEN RAISE EXCEPTION 'v311: save'; END IF;
  IF public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'save',input) IS DISTINCT FROM src
    THEN RAISE EXCEPTION 'v311: replay'; END IF;
  PERFORM public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'toggle',
    jsonb_build_object('groupId',g,'id',src->'id','expectedRevision',1,'enabled',false));
  BEGIN
    PERFORM public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'delete',
      jsonb_build_object('groupId',g,'id',src->'id','expectedRevision',1));
    RAISE EXCEPTION 'v311: stale revision accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'sheet_sync_conflict' THEN RAISE; END IF; END;
  src:=public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'save',
    input||jsonb_build_object('id',src->'id','expectedRevision',2,'name','Edited ACL source'));
  IF src->>'revision' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'v311: edit'; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_list_data_group_members_v3(s,o,g,NULL,NULL,false,
    NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,100,NULL,NULL,ARRAY['external_sync']);
  IF n<>0 THEN RAISE EXCEPTION 'v311: source filter'; END IF;
  BEGIN
    PERFORM public.aka_agent_data_group_external_sync(0,o,NULL,NULL,'list',jsonb_build_object('groupId',g));
    RAISE EXCEPTION 'v311: wrong staff accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'data_group_not_found' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_list_data_group_members_v3(s,0,g,NULL,NULL,false,
      NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,100,NULL,NULL,ARRAY['external_sync']);
    RAISE EXCEPTION 'v311: wrong organization accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'data_group_not_found' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'delete',
    jsonb_build_object('groupId',g,'id',src->'id','expectedRevision',3));
  result:=public.aka_agent_data_group_external_sync(s,o,NULL,NULL,'list',jsonb_build_object('groupId',g));
  IF result IS DISTINCT FROM '{"sources":[],"runs":[]}'::jsonb THEN RAISE EXCEPTION 'v311: final list'; END IF;
END;
$service_role_smoke$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $anon_smoke$
BEGIN
  BEGIN
    PERFORM public.aka_agent_data_group_external_sync(current_setting('v311.staff_id')::bigint,
      current_setting('v311.organization_id')::bigint,NULL,NULL,'list',
      jsonb_build_object('groupId',current_setting('v311.group_id')::bigint));
    RAISE EXCEPTION 'v311: anonymous credentials bypass';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
  IF has_table_privilege('anon','public.auto_data_group_external_sync_sources','SELECT')
    OR has_function_privilege('anon','public.aka_agent_sheet_claim(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.aka_agent_sheet_classify(bigint,text,jsonb)','EXECUTE')
    THEN RAISE EXCEPTION 'v311: private access changed'; END IF;
END;
$anon_smoke$;
RESET ROLE;
DO $no_ingest$
BEGIN
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_members
      WHERE group_id=current_setting('v311.group_id')::bigint)
    OR EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_runs
      WHERE group_id=current_setting('v311.group_id')::bigint)
    THEN RAISE EXCEPTION 'v311: preview/paused source started ingestion'; END IF;
END;
$no_ingest$;
