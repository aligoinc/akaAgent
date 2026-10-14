DO $smoke$
DECLARE a public.auto_accounts%ROWTYPE; cfg jsonb; result jsonb; before_row jsonb; after_row jsonb; bad jsonb;
BEGIN
 SELECT aa.* INTO STRICT a FROM public.auto_accounts aa JOIN public.org_staff s ON s.id=aa.staff_id AND s.organization_id=aa.organization_id AND s.is_active
 WHERE aa.flatform_type='facebook' AND NOT aa.is_delete AND EXISTS(SELECT 1 FROM public.org_organization_product p
 WHERE p.organization_id=aa.organization_id AND NOT p.is_deleted AND p.product_id IN (3,10) AND p.expiration_date>=now()) LIMIT 1;
 before_row:=to_jsonb(a)-ARRAY['facebook_web_enrichment_enabled','facebook_web_enrichment_config','updated_at'];
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 result:=public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'get');
 cfg:=jsonb_build_object('version',1,'revision',coalesce((result->'config'->>'revision')::integer,0),'industry','Kiểm thử rollback',
   'keywords',jsonb_build_array('một','hai','ba'),'websites',jsonb_build_array('one.example','https://two.example/','https://three.example/'),
   'hobbies',jsonb_build_array(),'minutesPerSession',45,'slots',jsonb_build_array('09:00','08:30','08:00'),'stopDate',NULL);
 result:=public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'save',jsonb_build_object('enabled',true,'config',cfg));
 IF result->>'enabled'<>'true' OR result->'config'->'slots'<>'["08:00","08:30","09:00"]'::jsonb OR (result->'config'->>'revision')::integer<>(cfg->>'revision')::integer+1 THEN RAISE EXCEPTION 'save/sort/revision failed'; END IF;
 BEGIN
   PERFORM public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'save',jsonb_build_object('enabled',true,'config',cfg));
   RAISE EXCEPTION 'stale revision accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'web_enrichment_conflict' THEN RAISE; END IF; END;
 cfg:=result->'config';
 FOR bad IN SELECT x FROM jsonb_array_elements(jsonb_build_array(
   jsonb_set(cfg,'{keywords}','["a","A","b"]'),jsonb_set(cfg,'{minutesPerSession}','7'),
   jsonb_set(cfg,'{websites}','["https://one.example/","https://two.example/"]'),
   jsonb_set(cfg,'{websites}','["https://one.example/","https://two.example/","https://three.example/","https://four.example/"]'),
   jsonb_set(cfg,'{websites}','["https://one.example/","https://two.example/","https://three.example/","https://four.example/","https://five.example/"]'),
   jsonb_set(cfg,'{slots}','["25:00"]'),jsonb_set(cfg,'{websites}','["ftp://one.example","https://two.example","https://three.example"]'),
   jsonb_set(cfg,'{websites}','["https://one.example","https://one.example/","https://three.example"]')
 )) x LOOP
   BEGIN
     PERFORM public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'save',jsonb_build_object('enabled',true,'config',bad));
     RAISE EXCEPTION 'invalid config accepted';
   EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'web_enrichment_%' THEN RAISE; END IF; END;
 END LOOP;
 -- Keep read access and disable for a previously saved five-site configuration.
 UPDATE public.auto_accounts SET facebook_web_enrichment_config=cfg||'{"websites":["https://one.example/","https://two.example/","https://three.example/","https://four.example/","https://five.example/"],"slots":["18:30"],"stopDate":null}'::jsonb WHERE id=a.id;
 result:=public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'get');
 IF jsonb_array_length(result->'config'->'websites')<>5 OR result->'config'->'slots'<>'["18:30"]'::jsonb OR result->'config'->>'stopDate' IS NOT NULL THEN RAISE EXCEPTION 'saved config changed by get'; END IF;
 result:=public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'save',jsonb_build_object('enabled',false,'config',result->'config'));
 IF result->>'enabled'<>'false' OR jsonb_array_length(result->'config'->'websites')<>5 THEN RAISE EXCEPTION 'legacy disable failed'; END IF;
 cfg:=result->'config';
 -- An incomplete draft can always be switched off.
 result:=public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'save',
   jsonb_build_object('enabled',false,'config',cfg||'{"industry":"","keywords":[],"websites":[],"slots":[]}'::jsonb));
 IF result->>'enabled'<>'false' THEN RAISE EXCEPTION 'disable failed'; END IF;
 SELECT to_jsonb(aa)-ARRAY['facebook_web_enrichment_enabled','facebook_web_enrichment_config','updated_at'] INTO after_row FROM public.auto_accounts aa WHERE id=a.id;
 IF before_row IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'business account fields changed'; END IF;
 BEGIN
   PERFORM public.aka_agent_facebook_web_enrichment_settings(a.staff_id,-401,NULL,NULL,a.id,'get');
   RAISE EXCEPTION 'cross tenant accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'web_enrichment_identity' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,-401,'get');
   RAISE EXCEPTION 'wrong account accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'web_enrichment_account' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.role','anon',true);
 BEGIN
   PERFORM public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,NULL,NULL,a.id,'get');
   RAISE EXCEPTION 'missing credential accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.aka_agent_facebook_web_enrichment_settings(a.staff_id,a.organization_id,'v401-invalid','v401-invalid',a.id,'get');
   RAISE EXCEPTION 'bad credential accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
 IF NOT has_function_privilege('anon','public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)','EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p,aclexplode(p.proacl) acl WHERE p.oid=to_regprocedure('public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)') AND acl.grantee=0) THEN RAISE EXCEPTION 'ACL failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_runs WHERE workflow_id=(SELECT id FROM public.auto_workflows WHERE name='fb_web_enrichment')) THEN RAISE EXCEPTION 'auxiliary run persisted'; END IF;
END $smoke$;
