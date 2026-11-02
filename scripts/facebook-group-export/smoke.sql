-- Fixture-only rehearsal. Caller MUST wrap this and the candidate in BEGIN/ROLLBACK.
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
DO $smoke$
DECLARE
 base constant bigint:=8800442000000000;
 a constant bigint:=1900044201; b constant bigint:=1900044202;
 org bigint; other_org bigint; typ bigint; person_typ bigint;
 q jsonb; old_rows jsonb; rows jsonb; r jsonb; row1 jsonb; checks jsonb:='[]';
 expected_count integer; denied boolean; role_name text; started timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('facebook-group-export-v443-smoke',0));
 SELECT id INTO org FROM public.org_organization ORDER BY id LIMIT 1;
 SELECT id INTO other_org FROM public.org_organization WHERE id<>org ORDER BY id LIMIT 1;
 typ:=public.aka_agent_data_type_category_item_id('facebook_group');
 person_typ:=public.aka_agent_data_type_category_item_id('facebook_person');
 IF EXISTS(SELECT 1 FROM public.org_staff WHERE id IN(a,b))
   OR EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=base+1) THEN RAISE EXCEPTION 'fixture collision'; END IF;
 INSERT INTO public.org_staff(id,phone,name,username,password,organization_id,is_active)
 OVERRIDING SYSTEM VALUE VALUES
 (a,'0000442001','V443 owner','__v443_owner','v443-test',org,true),
 (b,'0000442002','V443 viewer','__v443_viewer','v443-test',org,true);
 INSERT INTO public.auto_accounts(id,name,flatform_type,login_status,status,is_active,staff_id,organization_id,is_delete)
 OVERRIDING SYSTEM VALUE VALUES(base+1,'V443 fixture','facebook','chưa đăng nhập','tạm dừng',false,b,org,false);
 INSERT INTO public.auto_campaigns(id,name,action_id,account_id,status,content,data_target_source_mode,staff_id,organization_id,is_delete)
 OVERRIDING SYSTEM VALUE VALUES
 (base+2,'V443 group','facebook_comment_seeding',base+1,'tạm dừng','','direct',b,org,false),
 (base+3,'V443 person','facebook_message_uid',base+1,'tạm dừng','','direct',b,org,false);
 INSERT INTO public.auto_account_contact_groups(id,name,color,purpose,staff_id,organization_id,sharing_scope,is_delete)
 OVERRIDING SYSTEM VALUE VALUES(base+4,'V443 shared','#123456','data_group',a,org,'organization',false);
 INSERT INTO public.auto_account_contacts(id,staff_id,organization_id,contact_type,flatform_type,name,uid,url,extra_data,is_delete)
 OVERRIDING SYSTEM VALUE VALUES
 (base+10,a,org,'group','facebook','V443 FB 1','https://www.facebook.com/groups/44201','https://www.facebook.com/groups/44201','{"memberCount":123,"postsPerDay":5,"privacy":"Public","secret":"must-not-export"}',false),
 (base+11,a,org,'group','facebook','V443 FB 2','https://www.facebook.com/groups/44201','https://www.facebook.com/groups/44201','{"memberCount":456,"postsPerDay":5,"privacy":"Public"}',false),
 (base+12,a,org,'group','zalo','V443 Zalo','44202',null,'{"memberCount":999,"postsPerDay":3,"privacy":"Private"}',false),
 (base+13,a,org,'person','facebook','V443 person','44203',null,'{}',false);
 INSERT INTO public.auto_account_contact_group_members(id,group_id,contact_id,is_delete)
 OVERRIDING SYSTEM VALUE VALUES(base+20,base+4,base+10,false),(base+21,base+4,base+11,false),
 (base+22,base+4,base+12,false),(base+23,base+4,base+13,false);
 INSERT INTO public.auto_campaign_input_data(id,campaign_id,name,uid,status,is_delete,data_type_category_item_id)
 OVERRIDING SYSTEM VALUE VALUES
 (base+30,base+2,'V443 group','https://www.facebook.com/groups/44201','hoàn thành',false,typ),
 (base+31,base+2,'V443 person','44203','hoàn thành',false,person_typ),
 (base+32,base+2,'V443 unlinked','https://www.facebook.com/groups/unlinked','hoàn thành',false,typ),
 (base+33,base+3,'V443 message','44203','hoàn thành',false,person_typ);
 INSERT INTO public.auto_campaign_input_origins(id,input_data_id,group_id,membership_id,origin_kind,group_revision,canonical_target_key)
 OVERRIDING SYSTEM VALUE VALUES
 (base+40,base+30,base+4,base+20,'manual',1,'v443:group'),
 (base+41,base+30,base+4,base+21,'manual',1,'v443:group'),
 (base+42,base+31,base+4,base+23,'manual',1,'v443:person');
 INSERT INTO public.auto_campaign_details(id,input_data_id,campaign_id,account_id,action_name,status,is_delete,counts_toward_limit)
 OVERRIDING SYSTEM VALUE VALUES
 (base+50,base+30,base+2,base+1,'Comment','thành công',false,false),
 (base+51,base+31,base+2,base+1,'Comment','thành công',false,false),
 (base+52,base+32,base+2,base+1,'Comment','thất bại',false,false),
 (base+53,base+33,base+3,base+1,'Message','thành công',false,false),
 (base+54,base+30,base+2,base+1,'Comment again','thành công',false,false);
 INSERT INTO public.auto_campaign_details(id,input_data_id,campaign_id,account_id,action_name,status,is_delete,counts_toward_limit)
 OVERRIDING SYSTEM VALUE SELECT base+100+n,base+30,base+2,base+1,'V443 bulk','thành công',false,false FROM generate_series(0,499) n;

 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 EXECUTE 'SET LOCAL ROLE service_role';
 q:=jsonb_build_object('kind','data','groupId',base+4,'limit',500);
 old_rows:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_members',q);
 rows:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_members',q||'{"includeFacebookGroupMetadata":true}');
 IF jsonb_array_length(rows)<>4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(old_rows) x WHERE x ? 'facebook_group_metadata') THEN
   RAISE EXCEPTION 'normal reader changed'; END IF;
 IF (SELECT jsonb_agg(x-'facebook_group_metadata') FROM jsonb_array_elements(rows) x) IS DISTINCT FROM old_rows THEN
   RAISE EXCEPTION 'export changed existing fields or ordering'; END IF;
 SELECT x INTO row1 FROM jsonb_array_elements(rows) x WHERE (x->>'contact_id')::bigint=base+10;
 IF row1->'facebook_group_metadata' IS DISTINCT FROM '{"memberCount":123,"postsPerDay":5,"privacy":"Public"}'::jsonb
   OR row1->'provenance'<>'[]'::jsonb THEN RAISE EXCEPTION 'shared metadata/redaction failed'; END IF;
 SELECT x INTO row1 FROM jsonb_array_elements(rows) x WHERE (x->>'contact_id')::bigint=base+12;
 IF row1->'facebook_group_metadata' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Zalo metadata leaked'; END IF;
 checks:=checks||'["ordinary reader unchanged","shared metadata allowlist","shared provenance redacted","Zalo excluded"]';

 q:=q||jsonb_build_object('includeFacebookGroupMetadata',true,'ids',jsonb_build_array(base+20,base+22),
   'columnFilters',jsonb_build_object('version',1,'filters','[]'::jsonb));
 r:=public.aka_agent_read_filtered_group_v1(b,org,NULL,NULL,q);
 IF (r->>'total')::int<>2 OR jsonb_array_length(r->'rows')<>2 THEN RAISE EXCEPTION 'selected IDs scope changed'; END IF;
 r:=public.aka_agent_read_filtered_group_v1(b,org,NULL,NULL,(q-'ids')||'{"search":"V443 FB","limit":1}');
 IF (r->>'total')::int<>2 OR jsonb_array_length(r->'rows')<>1 OR r->>'hasMore'<>'true' THEN RAISE EXCEPTION 'filtered paging changed'; END IF;
 rows:=r->'rows';
 r:=public.aka_agent_read_filtered_group_v1(b,org,NULL,NULL,(q-'ids')||jsonb_build_object('search','V443 FB','limit',1,'after',r->'after','countMode','none'));
 IF r->'rows'->0->'id'=rows->0->'id' OR jsonb_array_length(r->'rows')<>1 THEN RAISE EXCEPTION 'cursor not advancing'; END IF;
 checks:=checks||'["selected IDs scope","filtered multi-page export"]';

 started:=clock_timestamp();
 r:=public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY[base+50,base+51,base+52,base+54],NULL,NULL);
 IF r->>'eligible'<>'true' OR jsonb_array_length(r->'rows')<>4 THEN RAISE EXCEPTION 'detail rows duplicated'; END IF;
 SELECT x INTO row1 FROM jsonb_array_elements(r->'rows') x WHERE (x->>'detail_id')::bigint=base+50;
 IF jsonb_array_length(row1->'sources')<>2 OR row1::text LIKE '%must-not-export%' THEN RAISE EXCEPTION 'source candidates/allowlist failed'; END IF;
 SELECT x INTO row1 FROM jsonb_array_elements(r->'rows') x WHERE (x->>'detail_id')::bigint=base+51;
 IF row1->'sources'<>'[]'::jsonb THEN RAISE EXCEPTION 'person input not excluded'; END IF;
 SELECT x INTO row1 FROM jsonb_array_elements(r->'rows') x WHERE (x->>'detail_id')::bigint=base+52;
 IF row1->'sources'<>'[]'::jsonb THEN RAISE EXCEPTION 'unlinked input unexpectedly matched'; END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('campaignFixtureMs',extract(epoch from clock_timestamp()-started)*1000));
 r:=public.aka_agent_get_campaign_group_export_metadata(b,org,base+3,ARRAY[base+53],NULL,NULL);
 IF r->>'eligible'<>'false' OR r->'rows'<>'[]'::jsonb THEN RAISE EXCEPTION 'message action not gated'; END IF;
 checks:=checks||'["multiple sources without duplicate results","person input excluded","unlinked input blank","message action gated"]';
 started:=clock_timestamp();
 r:=public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY(SELECT base+100+n FROM generate_series(0,499) n),NULL,NULL);
 IF jsonb_array_length(r->'rows')<>500 THEN RAISE EXCEPTION 'bulk result count changed'; END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('campaign500FixtureMs',extract(epoch from clock_timestamp()-started)*1000));
 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY(SELECT base+100+n FROM generate_series(0,500) n),NULL,NULL);
 EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='invalid_campaign_export_ids'; END;
 IF NOT denied THEN RAISE EXCEPTION 'batch limit exceeded'; END IF;

 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(a,org,base+2,ARRAY[base+50],NULL,NULL);
 EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='campaign_not_found'; END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-staff campaign allowed'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(b,other_org,base+2,ARRAY[base+50],NULL,NULL);
 EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='campaign_not_found'; END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-org campaign allowed'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY[base+50,base+53],NULL,NULL);
 EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='campaign_export_results_changed'; END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-campaign detail allowed'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY[base+50,base+50],NULL,NULL);
 EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='invalid_campaign_export_ids'; END;
 IF NOT denied THEN RAISE EXCEPTION 'duplicate IDs allowed'; END IF;
 checks:=checks||'["cross-staff denied","cross-org denied","cross-campaign detail denied","duplicate IDs denied"]';
 EXECUTE 'RESET ROLE';

 UPDATE public.auto_account_contact_groups SET sharing_scope='private' WHERE id=base+4;
 EXECUTE 'SET LOCAL ROLE service_role';
 r:=public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY[base+50],NULL,NULL);
 IF r->'rows'->0->'sources'<>'[]'::jsonb THEN RAISE EXCEPTION 'revoked metadata exposed'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(b,org,NULL,NULL,'data_members',q);
 EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='group_sharing_access_denied'; END;
 IF NOT denied THEN RAISE EXCEPTION 'revoked group read allowed'; END IF;
 EXECUTE 'RESET ROLE';
 checks:=checks||'["revoked source blank","revoked group denied"]';

 -- Actual Desktop role without a mapped token must fail, even with valid fixture credentials.
 PERFORM set_config('request.jwt.claim.role','aka_agent_desktop',true);
 PERFORM set_config('request.jwt.claims','{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000004442"}',true);
 EXECUTE 'SET LOCAL ROLE aka_agent_desktop';
 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY[base+50],'__v443_viewer','v443-test');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'unbound Desktop token allowed'; END IF;
 EXECUTE 'RESET ROLE';
 INSERT INTO auth.users(id,aud,role,created_at,updated_at)
 VALUES('00000000-0000-4000-8000-000000004442','authenticated','authenticated',now(),now());
 INSERT INTO private.aka_agent_desktop_users(staff_id,auth_user_id)
 VALUES(b,'00000000-0000-4000-8000-000000004442');
 UPDATE public.auto_account_contact_groups SET sharing_scope='organization' WHERE id=base+4;
 EXECUTE 'SET LOCAL ROLE aka_agent_desktop';
 r:=public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY[base+50],'__v443_viewer','v443-test');
 IF jsonb_array_length(r->'rows'->0->'sources')<>2 THEN RAISE EXCEPTION 'bound Desktop reader failed'; END IF;
 r:=public.aka_agent_read_filtered_group_v1(b,org,'__v443_viewer','v443-test',q);
 IF jsonb_array_length(r->'rows')<>2 THEN RAISE EXCEPTION 'Desktop shared export failed'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(a,org,base+2,ARRAY[base+50],'__v443_owner','v443-test');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'bound Desktop cross-staff allowed'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_get_campaign_group_export_metadata(b,org,base+2,ARRAY[base+50],NULL,NULL);
 EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='automation_auth_required'; END;
 IF NOT denied THEN RAISE EXCEPTION 'Desktop missing credential allowed'; END IF;
 EXECUTE 'RESET ROLE';
 checks:=checks||'["bound Desktop metadata read","Desktop shared filtered export","bound Desktop cross-staff denied","Desktop missing credential denied"]';
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','aka_agent_chat_api'] LOOP
   IF has_function_privilege(role_name,'public.aka_agent_get_campaign_group_export_metadata(bigint,bigint,bigint,bigint[],text,text)','EXECUTE') THEN
     RAISE EXCEPTION 'unexpected export caller grant: %',role_name; END IF;
 END LOOP;
 checks:=checks||'["unbound Desktop token denied","ACL excludes anon/authenticated/Chat API"]';
 PERFORM set_config('facebook_group_export.smoke',checks::text,true);
END $smoke$;
SELECT current_setting('facebook_group_export.smoke')::jsonb checks;
