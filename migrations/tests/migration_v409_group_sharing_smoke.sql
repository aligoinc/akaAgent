-- Run after V409 inside a transaction which MUST end with ROLLBACK.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $smoke$
<<fixture>>
DECLARE
  org bigint; other_org bigint; a bigint; b bigint; c bigint; outsider bigint;
  g bigint; cg bigint; ct bigint; contact_id bigint; member_id bigint; copy_g bigint; account_id bigint; campaign_id bigint;
  direct_campaign bigint; next_contact bigint; zalo_owner bigint; zalo_recipient bigint; zalo_group bigint; zalo_campaign bigint;
  content_copy_group bigint; second_template bigint; case_template bigint;
  revision bigint; result jsonb; repeated jsonb; items jsonb; prefix text:='v409-'||txid_current();
  typ bigint:=public.aka_agent_data_type_category_item_id('facebook_person');
BEGIN
  SELECT id INTO org FROM public.org_organization ORDER BY id LIMIT 1;
  SELECT id INTO other_org FROM public.org_organization WHERE id<>org ORDER BY id LIMIT 1;
  IF other_org IS NULL THEN RAISE EXCEPTION 'fixture requires two organizations'; END IF;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active) VALUES('0000000400',prefix||'-a',prefix||'-a','v409-fixture',org,true) RETURNING id INTO a;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active,is_admin) VALUES('0000000401',prefix||'-b',prefix||'-b','v409-fixture',org,true,true) RETURNING id INTO b;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active) VALUES('0000000402',prefix||'-c',prefix||'-c','v409-fixture',org,true) RETURNING id INTO c;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active) VALUES('0000000403',prefix||'-outside',prefix||'-outside','v409-fixture',other_org,true) RETURNING id INTO outsider;
  result:=public.aka_agent_create_data_group_v2(a,org,prefix,'#123456',prefix||'-new',typ,NULL,NULL,NULL);
  g:=(result->>'id')::bigint;
  INSERT INTO public.auto_account_contacts(staff_id,organization_id,contact_type,flatform_type,name,uid,is_delete)
    VALUES(a,org,'person','facebook',prefix,'1000000000409',false) RETURNING id INTO contact_id;
  PERFORM public.aka_agent_ingest_data_group(a,org,prefix||'-ingest',g,'manual',jsonb_build_array(jsonb_build_object('contact_id',contact_id)),NULL,NULL,NULL,NULL,NULL,NULL,typ);
  SELECT id INTO member_id FROM public.auto_account_contact_group_members WHERE group_id=g AND auto_account_contact_group_members.contact_id=fixture.contact_id;
  SELECT g1.revision INTO revision FROM public.auto_account_contact_groups g1 WHERE id=g;
  IF private.can_read_data_group(g,b,org) THEN RAISE EXCEPTION 'private exposed'; END IF;
  result:=public.aka_agent_group_sharing(a,org,NULL,NULL,'save',jsonb_build_object('kind','data','groupId',g,'scope','selected','recipientIds',jsonb_build_array(b),'expectedRevision','0'));
  IF NOT private.can_read_data_group(g,b,org) OR private.can_read_data_group(g,c,org) OR private.can_read_data_group(g,outsider,other_org) THEN RAISE EXCEPTION 'recipient scope'; END IF;
  IF (SELECT g1.revision FROM public.auto_account_contact_groups g1 WHERE id=g)<>revision THEN RAISE EXCEPTION 'sharing changed data revision'; END IF;
  BEGIN
    PERFORM public.aka_agent_group_sharing(b,org,NULL,NULL,'save',jsonb_build_object('kind','data','groupId',g,'scope','organization','recipientIds','[]'::jsonb,'expectedRevision','1'));
    RAISE EXCEPTION 'admin recipient wrote sharing';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_owner_required' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_group_sharing(a,org,NULL,NULL,'save',jsonb_build_object('kind','data','groupId',g,'scope','private','recipientIds','[]'::jsonb,'expectedRevision','0'));
    RAISE EXCEPTION 'stale save accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_conflict' THEN RAISE; END IF; END;
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_groups',jsonb_build_object('search',prefix));
  IF jsonb_array_length(items)<>1 OR items->0->'access'->>'role'<>'shared' THEN RAISE EXCEPTION 'shared catalog:%',items; END IF;
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_groups',jsonb_build_object('search',prefix,'ownedOnly',true));
  IF items<>'[]'::jsonb THEN RAISE EXCEPTION 'write destination exposed'; END IF;
  IF EXISTS(SELECT 1 FROM public.aka_agent_list_data_groups_v2(b,org,prefix,NULL,NULL,NULL,0,50,NULL,NULL,false)) THEN RAISE EXCEPTION 'legacy reader broadened'; END IF;
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_members',jsonb_build_object('kind','data','groupId',g));
  IF jsonb_array_length(items)<>1 OR items->0->>'uid'<>'1000000000409' OR items->0->'provenance'<>'[]'::jsonb THEN RAISE EXCEPTION 'shared members:%',items; END IF;
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_members',jsonb_build_object('kind','data','groupId',g,'sourceCodes',jsonb_build_array('external_sync')));
  IF items IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'empty source filter broadened'; END IF;
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_panel',jsonb_build_object('kind','data','groupId',g));
  IF items->'campaigns'<>'[]'::jsonb OR items->'history'<>'[]'::jsonb THEN RAISE EXCEPTION 'owner metadata exposed'; END IF;
  BEGIN
    PERFORM public.aka_agent_remove_data_group_members(b,org,prefix||'-bad-remove',g,ARRAY[member_id]);
    RAISE EXCEPTION 'recipient modified source';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'data_group_not_found' THEN RAISE; END IF; END;
  result:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','data','groupId',g,'requestId',prefix||'-copy'));
  copy_g:=(result->>'groupId')::bigint;
  repeated:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','data','groupId',g,'requestId',prefix||'-copy'));
  IF result<>repeated OR (result->>'count')::int<>1 THEN RAISE EXCEPTION 'copy retry'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_members WHERE group_id=copy_g AND auto_account_contact_group_members.contact_id=fixture.contact_id) THEN RAISE EXCEPTION 'copy aliases source contact'; END IF;
  UPDATE public.auto_account_contacts SET name='edited copy' WHERE id IN (SELECT m.contact_id FROM public.auto_account_contact_group_members m WHERE m.group_id=copy_g);
  IF (SELECT name FROM public.auto_account_contacts WHERE id=contact_id)<>prefix THEN RAISE EXCEPTION 'copy changed original'; END IF;

  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,is_active,is_delete)
    VALUES(prefix,'facebook',b,org,true,false) RETURNING id INTO account_id;
  INSERT INTO public.auto_campaigns(name,account_id,action_id,staff_id,organization_id,status)
    VALUES(prefix,account_id,'facebook_message_uid',b,org,'tạm dừng') RETURNING id INTO campaign_id;
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'get',jsonb_build_object('kind','data','groupId',g));
  PERFORM public.aka_agent_bind_campaign_data_group_source(b,org,prefix||'-bind',campaign_id,g,NULL);
  IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE auto_campaign_input_data.campaign_id=fixture.campaign_id AND uid='1000000000409')
    THEN RAISE EXCEPTION 'shared bind missing input'; END IF;
  IF (SELECT valid_target_count FROM public.aka_agent_preview_data_group_campaign_targets(b,org,g,'facebook_message_uid',ARRAY[account_id])) IS DISTINCT FROM 1::bigint THEN RAISE EXCEPTION 'shared preview'; END IF;
  INSERT INTO public.auto_campaigns(name,account_id,action_id,staff_id,organization_id,status)
    VALUES(prefix||'-direct',account_id,'facebook_message_uid',b,org,'tạm dừng') RETURNING id INTO direct_campaign;
  PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(b,org,prefix||'-snapshot',direct_campaign,g,now(),'tạm dừng',NULL,NULL);
  IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_input_data i WHERE i.campaign_id=direct_campaign AND i.uid='1000000000409') THEN RAISE EXCEPTION 'shared direct snapshot'; END IF;
  INSERT INTO public.auto_account_contacts(staff_id,organization_id,contact_type,flatform_type,name,uid,is_delete)
    VALUES(a,org,'person','facebook',prefix,'1000000000410',false) RETURNING id INTO next_contact;
  PERFORM public.aka_agent_ingest_data_group(a,org,prefix||'-intake',g,'manual',jsonb_build_array(jsonb_build_object('contact_id',next_contact)),NULL,NULL,NULL,NULL,NULL,NULL,typ);
  IF (SELECT count(*) FROM public.auto_campaign_input_data i WHERE i.campaign_id=fixture.campaign_id)<>2 THEN RAISE EXCEPTION 'continuous shared intake'; END IF;
  IF (SELECT count(*) FROM public.auto_campaign_input_data i WHERE i.campaign_id=direct_campaign)<>1 THEN RAISE EXCEPTION 'snapshot became continuous'; END IF;
  PERFORM public.aka_agent_group_sharing(a,org,NULL,NULL,'save',jsonb_build_object('kind','data','groupId',g,'scope','private','recipientIds','[]'::jsonb,'expectedRevision','1'));
  IF EXISTS(SELECT 1 FROM public.auto_campaign_data_group_sources WHERE group_id=g AND status<>'stopped') THEN RAISE EXCEPTION 'revoke did not stop intake'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE auto_campaign_input_data.campaign_id=fixture.campaign_id) THEN RAISE EXCEPTION 'revoke removed input'; END IF;
  BEGIN
    PERFORM public.aka_agent_group_sharing(b,org,NULL,NULL,'data_members',jsonb_build_object('kind','data','groupId',g));
    RAISE EXCEPTION 'revoked read allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_access_denied' THEN RAISE; END IF; END;
  PERFORM public.aka_agent_group_sharing(a,org,NULL,NULL,'save',jsonb_build_object('kind','data','groupId',g,'scope','organization','recipientIds','[]'::jsonb,'expectedRevision','2'));
  -- Explicit reactivation works; moving staff out of the org stops it and rejoining leaves it stopped.
  PERFORM public.aka_agent_reactivate_campaign_data_group_source(b,org,campaign_id,prefix||'-reactivate',NULL);
  UPDATE public.org_staff SET organization_id=other_org WHERE id=b;
  IF EXISTS(SELECT 1 FROM public.auto_campaign_data_group_sources WHERE group_id=g AND status<>'stopped') THEN RAISE EXCEPTION 'staff move did not stop source'; END IF;
  UPDATE public.org_staff SET organization_id=org WHERE id=b;
  IF NOT private.can_read_data_group(g,c,org) THEN RAISE EXCEPTION 'organization scope'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_campaign_data_group_sources WHERE group_id=g AND status<>'stopped') THEN RAISE EXCEPTION 'grant auto reactivated'; END IF;
  UPDATE public.org_staff SET deleted_at=now(),is_active=false WHERE id=c;
  IF private.can_read_data_group(g,c,org) THEN RAISE EXCEPTION 'deleted viewer retained access'; END IF;

  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'data_groups',jsonb_build_object('search',prefix,'limit',1));
  IF jsonb_array_length(items)<>1 OR (items->0->>'total_count')::int<>2 THEN RAISE EXCEPTION 'pagination total must include shared and own'; END IF;
  INSERT INTO public.auto_content_groups(name,staff_id,organization_id,is_active,is_delete) VALUES(prefix,a,org,true,false) RETURNING id INTO cg;
  INSERT INTO public.auto_content_templates(name,content,staff_id,organization_id,group_id,channels,is_delete)
    VALUES(prefix,'content',a,org,cg,'{}',false) RETURNING id INTO ct;
  PERFORM public.aka_agent_group_sharing(a,org,NULL,NULL,'save',jsonb_build_object('kind','content','groupId',cg,'scope','organization','recipientIds','[]'::jsonb,'expectedRevision','0'));
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'content_templates',jsonb_build_object('afterId',ct-1));
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'id')::bigint=ct AND x->'access'->>'role'='shared') THEN RAISE EXCEPTION 'shared content missing'; END IF;
  result:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'templateId',ct,'requestId',prefix||'-content-copy'));
  IF (result->>'count')::int<>1 OR NOT EXISTS(SELECT 1 FROM public.auto_content_templates WHERE group_id=(result->>'groupId')::bigint AND staff_id=b AND content='content') THEN RAISE EXCEPTION 'content copy'; END IF;
  content_copy_group:=(result->>'groupId')::bigint;
  repeated:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'templateId',ct,'requestId',prefix||'-content-copy'));
  IF repeated<>result THEN RAISE EXCEPTION 'content retry allocated a different copy'; END IF;
  -- Owners can duplicate nonempty groups despite staff-wide unique template names.
  result:=public.aka_agent_group_sharing(a,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'requestId',prefix||'-owner-content-copy'));
  IF (result->>'count')::int<>1 OR NOT EXISTS(SELECT 1 FROM public.auto_content_templates
    WHERE group_id=(result->>'groupId')::bigint AND staff_id=a AND id<>ct AND name=prefix||' - Bản sao' AND content='content')
    THEN RAISE EXCEPTION 'owner content copy name collision'; END IF;
  -- A second template from the same shared group gets a distinct destination.
  INSERT INTO public.auto_content_templates(name,content,staff_id,organization_id,group_id,channels,is_delete)
    VALUES(prefix||'-second','second content',a,org,cg,'{}',false) RETURNING id INTO second_template;
  result:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'templateId',second_template,'requestId',prefix||'-second-template-copy'));
  IF NOT EXISTS(SELECT 1 FROM public.auto_content_groups WHERE id=(result->>'groupId')::bigint
    AND name=prefix||' - Bản sao (2)' AND staff_id=b AND sharing_scope='private')
    OR NOT EXISTS(SELECT 1 FROM public.auto_content_templates WHERE group_id=(result->>'groupId')::bigint AND name=prefix||'-second' AND content='second content')
    THEN RAISE EXCEPTION 'second template destination collision'; END IF;
  -- Repeating with a new request creates independent templates with free names.
  result:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'requestId',prefix||'-repeat-whole-content-copy'));
  IF (result->>'count')::int<>2 OR NOT EXISTS(SELECT 1 FROM public.auto_content_templates
    WHERE group_id=(result->>'groupId')::bigint AND name=prefix||' - Bản sao' AND staff_id=b)
    THEN RAISE EXCEPTION 'repeated content copy name collision'; END IF;
  repeated:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'requestId',prefix||'-repeat-whole-content-copy'));
  IF repeated<>result THEN RAISE EXCEPTION 'renamed content copy retry'; END IF;
  -- Explicit own destinations also resolve names within the whole staff library.
  result:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'templateId',ct,'targetGroupId',content_copy_group,'requestId',prefix||'-copy-existing-content-target'));
  IF (result->>'groupId')::bigint<>content_copy_group OR NOT EXISTS(SELECT 1 FROM public.auto_content_templates
    WHERE group_id=content_copy_group AND name=prefix||' - Bản sao (2)' AND staff_id=b)
    THEN RAISE EXCEPTION 'existing content target collision'; END IF;
  INSERT INTO public.auto_content_groups(name,staff_id,organization_id,is_active,is_delete)
    VALUES('  '||upper(prefix||'-case')||'  ',b,org,true,false);
  INSERT INTO public.auto_content_templates(name,content,staff_id,organization_id,channels,is_delete)
    VALUES('  '||upper(prefix||'-case')||'  ','existing',b,org,'{}',false);
  INSERT INTO public.auto_content_templates(name,content,staff_id,organization_id,group_id,channels,is_delete)
    VALUES(prefix||'-case','case content',a,org,cg,'{}',false) RETURNING id INTO case_template;
  result:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','content','groupId',cg,'templateId',case_template,'name',prefix||'-case','requestId',prefix||'-case-content-copy'));
  IF NOT EXISTS(SELECT 1 FROM public.auto_content_groups WHERE id=(result->>'groupId')::bigint AND name=prefix||'-case (2)')
    OR NOT EXISTS(SELECT 1 FROM public.auto_content_templates WHERE group_id=(result->>'groupId')::bigint AND name=prefix||'-case - Bản sao' AND content='case content')
    THEN RAISE EXCEPTION 'trimmed/case-insensitive content copy collision'; END IF;
  UPDATE public.auto_content_templates SET content='edited copy',is_delete=true WHERE group_id=content_copy_group;
  IF NOT EXISTS(SELECT 1 FROM public.auto_content_templates WHERE id=ct AND content='content' AND NOT is_delete)
    THEN RAISE EXCEPTION 'editing/deleting copied content changed source'; END IF;
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,is_active,is_delete)
    VALUES(prefix||'-zalo-owner','zalo',a,org,true,false) RETURNING id INTO zalo_owner;
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,is_active,is_delete)
    VALUES(prefix||'-zalo-recipient','zalo',b,org,true,false) RETURNING id INTO zalo_recipient;
  result:=public.aka_agent_create_data_group_v2(a,org,prefix||'-zalo','#123456',prefix||'-zalo-group',public.aka_agent_data_type_category_item_id('zalo_person'),NULL,NULL,NULL);
  zalo_group:=(result->>'id')::bigint;
  INSERT INTO public.auto_account_contacts(staff_id,organization_id,account_id,contact_type,flatform_type,name,uid,is_friend,is_delete)
    VALUES(a,org,zalo_owner,'person','zalo',prefix,'409001',true,false) RETURNING id INTO next_contact;
  PERFORM public.aka_agent_ingest_data_group(a,org,prefix||'-zalo-ingest',zalo_group,'manual',jsonb_build_array(jsonb_build_object('contact_id',next_contact)),NULL,NULL,NULL,NULL,NULL,NULL,public.aka_agent_data_type_category_item_id('zalo_person'));
  PERFORM public.aka_agent_group_sharing(a,org,NULL,NULL,'save',jsonb_build_object('kind','data','groupId',zalo_group,'scope','organization','recipientIds','[]'::jsonb,'expectedRevision','0'));
  IF (SELECT valid_target_count FROM public.aka_agent_preview_data_group_campaign_targets(b,org,zalo_group,'zalo_message_friend',ARRAY[zalo_recipient])) IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'sharing granted Zalo relationship evidence'; END IF;
  BEGIN
    PERFORM public.aka_agent_preview_data_group_campaign_targets(b,org,zalo_group,'zalo_message_friend',ARRAY[zalo_owner]);
    RAISE EXCEPTION 'sharing granted owner account';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'data_group_campaign_account_not_found' THEN RAISE; END IF; END;
  result:=public.aka_agent_group_sharing(b,org,NULL,NULL,'copy',jsonb_build_object('kind','data','groupId',zalo_group,'requestId',prefix||'-zalo-copy'));
  IF EXISTS(SELECT 1 FROM public.auto_account_contacts contact JOIN public.auto_account_contact_group_members member ON member.contact_id=contact.id
      WHERE member.group_id=(result->>'groupId')::bigint AND (contact.account_id IS NOT NULL OR contact.is_friend IS TRUE OR contact.is_joined IS TRUE)) THEN RAISE EXCEPTION 'copied Zalo relationship or account'; END IF;
  PERFORM public.aka_agent_group_sharing(a,org,NULL,NULL,'save',jsonb_build_object('kind','content','groupId',cg,'scope','private','recipientIds','[]'::jsonb,'expectedRevision','1'));
  BEGIN
    PERFORM public.aka_agent_group_sharing(b,org,NULL,NULL,'validate_content_selection',jsonb_build_object('kind','content','groupId',cg));
    RAISE EXCEPTION 'revoked content selection allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_access_denied' THEN RAISE; END IF; END;
  IF has_table_privilege('anon','public.auto_data_group_recipients','SELECT') OR has_function_privilege('anon','private.can_read_data_group(bigint,bigint,bigint)','EXECUTE') THEN RAISE EXCEPTION 'private ACL'; END IF;
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.jwt.claim.role','anon',true);
  BEGIN
    PERFORM public.aka_agent_group_sharing(b,org,NULL,NULL,'staff','{}');
    RAISE EXCEPTION 'missing credential accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
  items:=public.aka_agent_group_sharing(b,org,prefix||'-b','v409-fixture','get',jsonb_build_object('kind','data','groupId',g));
  IF items->'access'->>'role'<>'shared' THEN RAISE EXCEPTION 'anon credential read'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  items:=public.aka_agent_group_sharing(b,org,NULL,NULL,'get',jsonb_build_object('kind','data','groupId',g));
  IF items->'access'->>'role'<>'shared' THEN RAISE EXCEPTION 'service role read'; END IF;
  EXECUTE 'RESET ROLE';
END;
$smoke$;
SELECT 'V409 sharing, copy, intake, revoke and real-role checks passed' AS result;
