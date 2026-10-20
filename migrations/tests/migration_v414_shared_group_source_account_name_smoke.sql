-- Run inside BEGIN/ROLLBACK. Set aka_agent.v414_expect_visible to false for V409,
-- true for V414. All staff, accounts, contacts and sharing changes are rolled back.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $smoke$
<<fixture>>
DECLARE
  org bigint; other_org bigint; owner_id bigint; recipient bigint; unselected bigint; outsider bigint;
  group_id bigint; source_account bigint; contact_id bigint; no_account_contact bigint;
  items jsonb; item jsonb; result jsonb; copied_group bigint; current_role text;
  expected_visible boolean:=current_setting('aka_agent.v414_expect_visible')::boolean;
  prefix text:='v414-'||txid_current();
  typ bigint:=public.aka_agent_data_type_category_item_id('facebook_person');
BEGIN
  SELECT id INTO org FROM public.org_organization ORDER BY id LIMIT 1;
  SELECT id INTO other_org FROM public.org_organization WHERE id<>org ORDER BY id LIMIT 1;
  IF other_org IS NULL THEN RAISE EXCEPTION 'fixture requires two organizations'; END IF;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active)
    VALUES('0000000414',prefix||'-owner',prefix||'-owner','v414-fixture',org,true) RETURNING id INTO owner_id;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active,is_admin)
    VALUES('0000000415',prefix||'-recipient',prefix||'-recipient','v414-fixture',org,true,true) RETURNING id INTO recipient;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active)
    VALUES('0000000416',prefix||'-unselected',prefix||'-unselected','v414-fixture',org,true) RETURNING id INTO unselected;
  INSERT INTO public.org_staff(phone,name,username,password,organization_id,is_active)
    VALUES('0000000417',prefix||'-outsider',prefix||'-outsider','v414-fixture',other_org,true) RETURNING id INTO outsider;
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,is_active,is_delete)
    VALUES(prefix||' · Tài khoản nguồn','facebook',owner_id,org,true,false) RETURNING id INTO source_account;
  result:=public.aka_agent_create_data_group_v2(owner_id,org,prefix,'#123456',prefix||'-new',typ,NULL,NULL,NULL);
  group_id:=(result->>'id')::bigint;
  INSERT INTO public.auto_account_contacts(staff_id,organization_id,account_id,contact_type,flatform_type,name,uid,is_delete)
    VALUES(owner_id,org,source_account,'person','facebook',prefix,'1000000000414',false) RETURNING id INTO contact_id;
  INSERT INTO public.auto_account_contacts(staff_id,organization_id,contact_type,flatform_type,name,uid,is_delete)
    VALUES(owner_id,org,'person','facebook',prefix||'-no-account','1000000000415',false) RETURNING id INTO no_account_contact;
  PERFORM public.aka_agent_ingest_data_group(owner_id,org,prefix||'-ingest',group_id,'manual',
    jsonb_build_array(jsonb_build_object('contact_id',contact_id),jsonb_build_object('contact_id',no_account_contact)),
    NULL,NULL,NULL,NULL,NULL,NULL,typ);
  PERFORM public.aka_agent_group_sharing(owner_id,org,NULL,NULL,'save',
    jsonb_build_object('kind','data','groupId',group_id,'scope','selected','recipientIds',jsonb_build_array(recipient),'expectedRevision','0'));

  FOREACH current_role IN ARRAY ARRAY['anon','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',current_role);
    PERFORM set_config('request.jwt.claim.role',current_role,true);
    items:=public.aka_agent_group_sharing(owner_id,org,prefix||'-owner','v414-fixture','data_members',jsonb_build_object('kind','data','groupId',group_id));
    SELECT x INTO item FROM jsonb_array_elements(items) x WHERE (x->>'contact_id')::bigint=fixture.contact_id;
    IF item->>'source_account_name' IS DISTINCT FROM prefix||' · Tài khoản nguồn' THEN RAISE EXCEPTION 'owner name lost'; END IF;
    items:=public.aka_agent_group_sharing(recipient,org,prefix||'-recipient','v414-fixture','data_members',jsonb_build_object('kind','data','groupId',group_id));
    IF jsonb_array_length(items)<>2 THEN RAISE EXCEPTION 'shared member count'; END IF;
    SELECT x INTO item FROM jsonb_array_elements(items) x WHERE (x->>'contact_id')::bigint=fixture.contact_id;
    IF item->>'source_account_name' IS DISTINCT FROM (CASE WHEN expected_visible THEN prefix||' · Tài khoản nguồn' END)
      THEN RAISE EXCEPTION 'shared source account name mismatch'; END IF;
    IF (item->>'source_account_id')::bigint IS DISTINCT FROM source_account
      OR item->>'source_automation_id' IS NOT NULL OR item->>'source_automation_name' IS NOT NULL
      OR item->'dataset_ids'<>'[]'::jsonb OR item->'dataset_names'<>'[]'::jsonb OR item->'provenance'<>'[]'::jsonb
      OR item ?| ARRAY['password','cookie','token','zalo_session','account_config']
      THEN RAISE EXCEPTION 'private metadata exposed or identity changed'; END IF;
    SELECT x INTO item FROM jsonb_array_elements(items) x WHERE (x->>'contact_id')::bigint=no_account_contact;
    IF item->>'source_account_name' IS NOT NULL THEN RAISE EXCEPTION 'accountless row gained account'; END IF;
    items:=public.aka_agent_group_sharing(recipient,org,prefix||'-recipient','v414-fixture','data_members',
      jsonb_build_object('kind','data','groupId',group_id,'accountIds',jsonb_build_array(source_account),'includeAccountless',false,'limit',1));
    IF jsonb_array_length(items)<>1 OR items->0->>'source_account_name' IS DISTINCT FROM (CASE WHEN expected_visible THEN prefix||' · Tài khoản nguồn' END)
      THEN RAISE EXCEPTION 'filtered/paginated account name'; END IF;
    items:=public.aka_agent_group_sharing(recipient,org,prefix||'-recipient','v414-fixture','data_panel',jsonb_build_object('kind','data','groupId',group_id));
    IF items->'account_breakdown'<>'[]'::jsonb OR items->'campaigns'<>'[]'::jsonb OR items->'history'<>'[]'::jsonb
      THEN RAISE EXCEPTION 'account/campaign detail exposed'; END IF;
    BEGIN
      PERFORM public.aka_agent_group_sharing(unselected,org,prefix||'-unselected','v414-fixture','data_members',jsonb_build_object('kind','data','groupId',group_id));
      RAISE EXCEPTION 'unselected staff read source';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_access_denied' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.aka_agent_group_sharing(outsider,other_org,prefix||'-outsider','v414-fixture','data_members',jsonb_build_object('kind','data','groupId',group_id));
      RAISE EXCEPTION 'other organization read source';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_access_denied' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.aka_agent_group_sharing(recipient,org,prefix||'-recipient','v414-fixture','save',
        jsonb_build_object('kind','data','groupId',group_id,'scope','organization','expectedRevision','1'));
      RAISE EXCEPTION 'admin recipient managed sharing';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_owner_required' THEN RAISE; END IF; END;
    EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  UPDATE public.auto_accounts SET is_delete=true WHERE id=source_account;
  items:=public.aka_agent_group_sharing(recipient,org,NULL,NULL,'data_members',jsonb_build_object('kind','data','groupId',group_id));
  SELECT x INTO item FROM jsonb_array_elements(items) x WHERE (x->>'contact_id')::bigint=fixture.contact_id;
  IF item->>'source_account_name' IS DISTINCT FROM (CASE WHEN expected_visible THEN prefix||' · Tài khoản nguồn' END)
    OR (item->>'source_account_deleted')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'deleted source account display'; END IF;
  result:=public.aka_agent_group_sharing(recipient,org,NULL,NULL,'copy',
    jsonb_build_object('kind','data','groupId',group_id,'requestId',prefix||'-copy'));
  copied_group:=(result->>'groupId')::bigint;
  items:=public.aka_agent_group_sharing(recipient,org,NULL,NULL,'data_members',jsonb_build_object('kind','data','groupId',copied_group));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE x->>'source_account_id' IS NOT NULL)
    THEN RAISE EXCEPTION 'copy inherited source account'; END IF;
  PERFORM public.aka_agent_group_sharing(owner_id,org,NULL,NULL,'save',
    jsonb_build_object('kind','data','groupId',group_id,'scope','private','recipientIds','[]'::jsonb,'expectedRevision','1'));
  BEGIN
    PERFORM public.aka_agent_group_sharing(recipient,org,NULL,NULL,'data_members',jsonb_build_object('kind','data','groupId',group_id));
    RAISE EXCEPTION 'revoked group remained readable';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'group_sharing_access_denied' THEN RAISE; END IF; END;
END;
$smoke$;
SELECT 'V414 source account name and preserved access/redaction checks passed' result;
