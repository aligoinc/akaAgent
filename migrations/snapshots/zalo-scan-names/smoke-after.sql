DO $smoke$
DECLARE a jsonb:=current_setting('zalo_names.scope')::jsonb; credentials record; q jsonb; page jsonb; old_page jsonb; legacy_rows jsonb;
 source_name text; role_name text; subject uuid; predicate text; matched integer; denied boolean; checks jsonb:='[]';
BEGIN
 SELECT username,password INTO STRICT credentials FROM public.org_staff WHERE id=(a->>'staff_id')::bigint;
 SELECT auth_user_id INTO subject FROM private.aka_agent_desktop_users WHERE staff_id=(a->>'staff_id')::bigint LIMIT 1;
 FOREACH role_name IN ARRAY ARRAY['service_role','aka_agent_desktop'] LOOP
  IF role_name='aka_agent_desktop' AND subject IS NULL THEN RAISE EXCEPTION 'Desktop sample identity missing'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role',role_name,'sub',subject)::text,true);
  FOREACH source_name IN ARRAY ARRAY['contacts','remarketing'] LOOP
   q:=current_setting('zalo_names.'||source_name||'_query')::jsonb;
   old_page:=current_setting('zalo_names.'||source_name||'_before')::jsonb;
   EXECUTE format('SET LOCAL ROLE %I',role_name);
   IF source_name='contacts' THEN
    page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,credentials.username,credentials.password,'contacts',q);
   ELSE
    page:=public.aka_agent_read_filtered_remarketing_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,credentials.username,credentials.password,q);
   END IF;
   RESET ROLE;
   SELECT COALESCE(jsonb_agg(value-'zalo_original_name' ORDER BY n),'[]') INTO legacy_rows FROM jsonb_array_elements(page->'rows') WITH ORDINALITY t(value,n);
   IF jsonb_set(page,'{rows}',legacy_rows) IS DISTINCT FROM old_page THEN RAISE EXCEPTION 'Legacy result drift: % %',role_name,source_name; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(page->'rows') r LEFT JOIN public.zalo_users u ON u.account_id=(a->>'id')::bigint AND u.staff_id=(a->>'staff_id')::bigint AND u.zalo_uid=r->>'uid'
     WHERE NOT r ? 'zalo_original_name' OR r->>'zalo_original_name' IS DISTINCT FROM NULLIF(btrim(u.zalo_name),'')) THEN RAISE EXCEPTION 'Original name mismatch'; END IF;
   checks:=checks||jsonb_build_array(jsonb_build_object('test',source_name||'_parity_and_original_name','role',role_name,'rows',jsonb_array_length(page->'rows')));
   -- The field predicate must execute before pagination, including empty names.
   q:=q||'{"columnFilters":{"version":1,"filters":[{"field":"zaloOriginalName","op":"not_empty"}]}}'::jsonb;
   EXECUTE format('SET LOCAL ROLE %I',role_name);
   IF source_name='contacts' THEN
    page:=public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,credentials.username,credentials.password,'contacts',q);
   ELSE
    page:=public.aka_agent_read_filtered_remarketing_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,credentials.username,credentials.password,q);
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(page->'rows') r WHERE NULLIF(btrim(r->>'zalo_original_name'),'') IS NULL) THEN RAISE EXCEPTION 'Empty original name passed not_empty'; END IF;
   denied:=false;
   BEGIN
    IF source_name='contacts' THEN
     PERFORM public.aka_agent_read_filtered_contacts_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,credentials.username,credentials.password,'contacts',q||'{"accountId":-1}'::jsonb);
    ELSE
     PERFORM public.aka_agent_read_filtered_remarketing_v1((a->>'staff_id')::bigint,(a->>'organization_id')::bigint,credentials.username,credentials.password,q||'{"accountId":-1}'::jsonb);
    END IF;
   EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   RESET ROLE;
   IF NOT denied THEN RAISE EXCEPTION 'Account guard missing'; END IF;
   checks:=checks||jsonb_build_array(jsonb_build_object('test',source_name||'_filter_and_account_guard','role',role_name));
  END LOOP;
 END LOOP;
 -- Synthetic values prove aliases cannot masquerade as original names.
 FOREACH source_name IN ARRAY ARRAY['contacts','remarketing'] LOOP
  q:='{"columnFilters":{"version":1,"filters":[{"field":"zaloOriginalName","op":"eq","value":"Nguyễn An"}]}}';
  predicate:=private.column_filter_predicate_v1(source_name,q->'columnFilters');
  EXECUTE 'SELECT count(*) FROM (VALUES (''Nguyễn An''::text,''Biệt danh''::text),(NULL,''Nguyễn An''),('''',''Nguyễn An'')) v("f_zaloOriginalName",f_name) WHERE '||predicate INTO matched USING NULL::bigint,NULL::bigint,q;
  IF matched<>1 THEN RAISE EXCEPTION 'Original/display filter conflated'; END IF;
  checks:=checks||jsonb_build_array(jsonb_build_object('test',source_name||'_distinct_name_predicate'));
 END LOOP;
 IF has_function_privilege('anon','public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)','execute')
 OR has_function_privilege('authenticated','public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)','execute')
 OR has_function_privilege('aka_agent_desktop','private.column_filter_predicate_v1(text,jsonb)','execute') THEN RAISE EXCEPTION 'ACL expanded'; END IF;
 PERFORM set_config('zalo_names.smoke_result',checks::text,true);
END $smoke$;
SELECT current_setting('zalo_names.smoke_result')::jsonb checks;
