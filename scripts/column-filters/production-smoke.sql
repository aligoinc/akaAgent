-- Read-only business probes; credentials remain in server memory and are never returned.
DO $smoke$
DECLARE a jsonb; g jsonb; creds record; rows jsonb; newrows jsonb; page jsonb; q jsonb;
 ids jsonb; ids2 jsonb; old_rows jsonb; result jsonb:='[]'; ok boolean; started timestamptz;
 has_new boolean:=to_regprocedure('public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)') IS NOT NULL;
BEGIN
 PERFORM set_config('request.jwt.claim.role','anon',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 FOR a IN SELECT value FROM jsonb_array_elements('[{"id":1174,"staff_id":308,"flatform_type":"zalo","organization_id":289},{"id":1568,"staff_id":385,"flatform_type":"zalo","organization_id":365}]'::jsonb) LOOP
  SELECT username,password INTO STRICT creds FROM public.org_staff WHERE id=(a->>'staff_id')::bigint AND organization_id=(a->>'organization_id')::bigint AND is_active AND deleted_at IS NULL;
  EXECUTE 'SET LOCAL ROLE anon'; started:=clock_timestamp();
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') INTO rows FROM
   (SELECT id,uid,name,contact_type,is_friend,is_joined,extra_data FROM public.auto_account_contacts WHERE account_id=(a->>'id')::bigint AND staff_id=(a->>'staff_id')::bigint AND NOT is_delete ORDER BY id DESC LIMIT 10) c;
  IF jsonb_array_length(rows)=0 THEN RAISE EXCEPTION 'contact sample empty'; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('test','legacy_contacts','sampleId',a->'id','rows',jsonb_array_length(rows),'checksum',md5(rows::text)));
  IF has_new THEN
   SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint) INTO ids FROM jsonb_array_elements(rows) x;
   q:=jsonb_build_object('accountId',a->'id','ids',ids,'limit',10,'columnFilters',jsonb_build_object('version',1,'filters','[]'::jsonb));
   page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,'contacts',q);
   SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint) INTO ids2 FROM jsonb_array_elements(page->'rows') x;
   IF ids IS DISTINCT FROM ids2 OR (page->>'total')::bigint<>jsonb_array_length(ids) THEN RAISE EXCEPTION 'contacts legacy/new mismatch'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','filtered_contacts_parity','sampleId',a->'id','rows',page->'total'));
   q:=q||jsonb_build_object('columnFilters',jsonb_build_object('version',1,'filters',jsonb_build_array(jsonb_build_object('field','uid','op','eq','value',rows->0->>'uid'))));
   page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,'contacts',q);
   IF (page->>'total')::bigint<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(page->'rows') x WHERE x->>'uid' IS DISTINCT FROM rows->0->>'uid') THEN RAISE EXCEPTION 'uid filter mismatch'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','filtered_uid','sampleId',a->'id','rows',page->'total'));
   q:=q||jsonb_build_object('columnFilters',jsonb_build_object('version',1,'filters','[]'::jsonb));
   page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,'upload',q);
   IF (page->>'total')::bigint<>jsonb_array_length(ids) THEN RAISE EXCEPTION 'upload selected IDs mismatch'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','upload_ids','sampleId',a->'id','rows',page->'total'));
   page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,'contacts',q||'{"limit":2,"idsOnly":true}'::jsonb);
   newrows:=page->'rows';
   WHILE page->>'hasMore'='true' LOOP
    page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,'contacts',q||jsonb_build_object('limit',2,'idsOnly',true,'after',page->'after','countMode','none'));
    newrows:=newrows||(page->'rows');
    IF jsonb_array_length(newrows)>20 THEN RAISE EXCEPTION 'cursor loop'; END IF;
   END LOOP;
   SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint) INTO ids2 FROM jsonb_array_elements(newrows) x;
   IF ids IS DISTINCT FROM ids2 THEN RAISE EXCEPTION 'selected all cursor mismatch'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','contacts_cursor_ids','sampleId',a->'id','rows',jsonb_array_length(newrows)));
   page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,'group_members',q||'{"zaloGroupId":"__column_filter_probe_missing__"}'::jsonb);
   IF (page->>'total')::bigint<>0 THEN RAISE EXCEPTION 'missing group scope leaked rows'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','group_members_empty_scope','sampleId',a->'id'));
   page:=public.aka_agent_read_filtered_remarketing_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,q||'{"dateFrom":"1990-01-01","dateTo":"1990-01-02"}'::jsonb);
   IF (page->>'total')::bigint<>0 THEN RAISE EXCEPTION 'historical empty scope leaked rows'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','remarketing_empty_window','sampleId',a->'id'));
   ok:=false;
   BEGIN PERFORM public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,creds.username,creds.password,'contacts',q||'{"accountId":-1}'::jsonb);
   EXCEPTION WHEN SQLSTATE '42501' THEN ok:=true; END;
   IF NOT ok THEN RAISE EXCEPTION 'account access guard failed'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','filtered_account_denied','sampleId',a->'id'));
  END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 FOR g IN SELECT value FROM jsonb_array_elements('[{"id":5006,"staff_id":1851,"organization_id":1628,"viewer_id":1851,"shared":false},{"id":4916,"owner_id":1,"viewer_id":4,"organization_id":1,"staff_id":4,"shared":true}]'::jsonb) LOOP
  SELECT username,password INTO STRICT creds FROM public.org_staff WHERE id=(g->>'viewer_id')::bigint AND organization_id=(g->>'organization_id')::bigint AND is_active AND deleted_at IS NULL;
  EXECUTE 'SET LOCAL ROLE anon';
  q:=jsonb_build_object('kind','data','groupId',g->'id','limit',10,'includeAccountless',true,'status','all');
  rows:=public.aka_agent_group_sharing((g->>'viewer_id')::bigint,(g->>'organization_id')::bigint,creds.username,creds.password,'data_members',q);
  result:=result||jsonb_build_array(jsonb_build_object('test',CASE WHEN g->>'shared'='true' THEN 'legacy_shared_group' ELSE 'legacy_owned_group' END,'sampleId',g->'id','rows',jsonb_array_length(rows),'total',rows->0->'total_count','checksum',md5(rows::text)));
  IF has_new THEN
   page:=public.aka_agent_read_filtered_group_v1((g->>'viewer_id')::bigint,(g->>'organization_id')::bigint,creds.username,creds.password,q||'{"columnFilters":{"version":1,"filters":[]}}'::jsonb);
   SELECT COALESCE(jsonb_agg(x-'total_count' ORDER BY (x->>'id')::bigint),'[]') INTO old_rows FROM jsonb_array_elements(rows) x;
   SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'id')::bigint),'[]') INTO newrows FROM jsonb_array_elements(page->'rows') x;
   IF old_rows IS DISTINCT FROM newrows OR (page->>'total')::bigint<>COALESCE((rows->0->>'total_count')::bigint,0) THEN RAISE EXCEPTION 'group legacy/new mismatch'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','group_parity','sampleId',g->'id','shared',g->'shared','rows',jsonb_array_length(newrows),'total',page->'total'));
   ok:=false;
   BEGIN PERFORM public.aka_agent_read_filtered_group_v1((g->>'viewer_id')::bigint,(g->>'organization_id')::bigint,creds.username,creds.password,q||'{"groupId":-1,"columnFilters":{"version":1,"filters":[]}}'::jsonb);
   EXCEPTION WHEN SQLSTATE '42501' THEN ok:=true; END;
   IF NOT ok THEN RAISE EXCEPTION 'group access guard failed'; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('test','filtered_group_denied','sampleId',g->'id'));
   IF g->>'shared'='true' AND EXISTS(SELECT 1 FROM jsonb_array_elements(newrows) x WHERE x->>'source_automation_id' IS NOT NULL OR x->>'source_automation_name' IS NOT NULL OR x->'provenance'<>'[]'::jsonb OR x->'dataset_ids'<>'[]'::jsonb) THEN RAISE EXCEPTION 'shared redaction mismatch'; END IF;
  END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 EXECUTE 'SET LOCAL ROLE anon';
 ok:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(0,0,NULL,NULL,'data_members','{"kind":"data","groupId":0}'::jsonb);
 EXCEPTION WHEN OTHERS THEN ok:=SQLERRM='automation_auth_required'; END;
 IF NOT ok THEN RAISE EXCEPTION 'legacy identity guard failed'; END IF;
 result:=result||'[{"test":"legacy_missing_auth_rejected"}]'::jsonb;
 IF has_new THEN
  ok:=false;
  BEGIN PERFORM public.aka_agent_read_filtered_contacts_v1(0,0,NULL,NULL,'contacts','{"accountId":0,"columnFilters":{"version":1,"filters":[]}}'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok:=SQLERRM='automation_auth_required'; END;
  IF NOT ok THEN RAISE EXCEPTION 'new identity guard failed'; END IF;
  result:=result||'[{"test":"filtered_missing_auth_rejected"}]'::jsonb;
  IF has_function_privilege('anon','private.column_filter_predicate_v1(text,jsonb)','execute') THEN RAISE EXCEPTION 'private helper exposed'; END IF;
  result:=result||'[{"test":"private_helper_not_executable"}]'::jsonb;
 END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('column_filters.smoke_result',result::text,true);
END $smoke$;
SELECT current_setting('column_filters.smoke_result')::jsonb checks;
