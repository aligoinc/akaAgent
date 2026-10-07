-- Only synthetic rows with explicit IDs; no Zalo commands or real campaign writes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='25s';
DO $smoke$
DECLARE
  s bigint; o bigint; r jsonb; k record; base jsonb; err text;
  a constant bigint:=2000000352;
  c constant bigint:=8000000000003521;
  i constant bigint:=8000000000003522;
  contact constant bigint:=8000000000003523;
  tag constant bigint:=8000000000003524;
  other_tag constant bigint:=8000000000003525;
  claim constant uuid:='a3520000-0000-4000-8000-000000000001';
  unit constant uuid:='a3520000-0000-4000-8000-000000000002';
BEGIN
  SELECT staff.id,staff.organization_id INTO s,o FROM public.org_staff staff
    CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(staff.organization_id) caps
    WHERE staff.is_active IS TRUE AND caps.qr_enabled AND caps.server_enabled
      AND (caps.max_accounts IS NULL OR caps.max_accounts<=0 OR
        (SELECT count(*) FROM public.auto_accounts a WHERE a.staff_id=staff.id
          AND a.flatform_type='zalo' AND NOT a.is_delete)+2<=caps.max_accounts)
    ORDER BY staff.organization_id,staff.id LIMIT 1;
  IF s IS NULL THEN RAISE EXCEPTION 'v352 smoke: missing eligible fixture owner'; END IF;
  INSERT INTO public.auto_accounts(id,name,staff_id,organization_id,flatform_type,status,login_status,is_active,is_delete,is_zalo_server,is_zalo_show_web)
    OVERRIDING SYSTEM VALUE VALUES(a,'__v352_rollback_only__',s,o,'zalo','đang chạy','đã đăng nhập',true,false,true,false);
  INSERT INTO public.auto_contact_tags(id,name,staff_id,organization_id) OVERRIDING SYSTEM VALUE
    VALUES(tag,'__v352_rollback_only__',s,o),(other_tag,'__v352_not_configured__',s,o);
  INSERT INTO public.auto_campaigns(id,name,account_id,staff_id,organization_id,status,action_id,extra_settings,
    runtime_claim_token,runtime_claim_target,runtime_unit_token,runtime_unit_claimed_at,runtime_unit_input_data_ids)
    OVERRIDING SYSTEM VALUE VALUES(c,'__v352_rollback_only__',a,s,o,'đang chạy','zalo_message_phone',
      jsonb_build_object('enableAkaBizTag',true,'akaBizTagIds',jsonb_build_array(tag)),claim,'server',unit,now(),ARRAY[i]);
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,canonical_target_key,is_delete,phone,uid)
    VALUES(i,c,'đang chạy','phone:0900000352',false,'0900000352','v352-user'),
      (i+100,c,'đang chạy','phone:0900000353',false,'0900000353','v352-user');
  INSERT INTO public.auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,flatform_type,name,uid,is_delete)
    VALUES(contact,a,s,o,'person','zalo','__v352_rollback_only__','v352-user',false),
      (contact+100,a,s,o,'person','zalo','__v352_unrelated__','v352-other',false),
      (contact+200,a,s,o,'group','zalo','__v352_group__','352123456',false);

  SET LOCAL ROLE anon;
  r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v352-user',ARRAY[tag]);
  IF r->>'count'<>'1' THEN RAISE EXCEPTION 'v352 smoke: first add %',r; END IF;
  r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v352-user',ARRAY[tag,tag]);
  IF r->>'count'<>'0' THEN RAISE EXCEPTION 'v352 smoke: replay not idempotent'; END IF;
  RESET ROLE;
  IF NOT (SELECT tag=ANY(akabiz_tag_ids) FROM public.auto_account_contacts WHERE id=contact)
    OR (SELECT tag=ANY(akabiz_tag_ids) FROM public.auto_account_contacts WHERE id=contact+100)
    THEN RAISE EXCEPTION 'v352 smoke: wrong contact mutation'; END IF;

  base:=jsonb_build_object('staff',s,'org',o,'campaign',c,'account',a,'claim',claim,'unit',unit,'input',i,
    'type','person','uid','v352-user','tags',jsonb_build_array(tag));
  FOR k IN SELECT * FROM (VALUES
    ('null claim','{"claim":null}'::jsonb,'server_campaign_tag_claim_required'),
    ('null unit','{"unit":null}'::jsonb,'server_campaign_tag_claim_required'),
    ('wrong claim',jsonb_build_object('claim',unit),'server_campaign_tag_claim_invalid'),
    ('wrong unit',jsonb_build_object('unit',claim),'server_campaign_tag_claim_invalid'),
    ('wrong staff',jsonb_build_object('staff',8000000000003599::bigint),'server_campaign_tag_staff_invalid'),
    ('wrong organization',jsonb_build_object('org',8000000000003599::bigint),'server_campaign_tag_staff_invalid'),
    ('wrong account',jsonb_build_object('account',a+100),'server_campaign_tag_claim_invalid'),
    ('wrong campaign',jsonb_build_object('campaign',c+100),'server_campaign_tag_input_not_owned'),
    ('unclaimed input',jsonb_build_object('input',i+100),'server_campaign_tag_input_not_in_unit'),
    ('other recipient','{"uid":"v352-other"}'::jsonb,'server_campaign_tag_target_mismatch'),
    ('person to group','{"type":"group"}'::jsonb,'server_campaign_tag_configuration_invalid'),
    ('unconfigured tag',jsonb_build_object('tags',jsonb_build_array(other_tag)),'server_campaign_tag_scope_invalid'),
    ('mixed tags',jsonb_build_object('tags',jsonb_build_array(tag,other_tag)),'server_campaign_tag_scope_invalid'),
    ('null tag','{"tags":[null]}'::jsonb,'server_campaign_tag_claim_required')
  ) cases(name,patch,expected) LOOP
    r:=base||k.patch;
    SET LOCAL ROLE anon;
    BEGIN
      PERFORM public.aka_agent_apply_zalo_server_campaign_tags((r->>'staff')::bigint,(r->>'org')::bigint,
        (r->>'campaign')::bigint,(r->>'account')::bigint,(r->>'claim')::uuid,(r->>'unit')::uuid,
        (r->>'input')::bigint,r->>'type',r->>'uid',ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(r->'tags')));
      RAISE EXCEPTION 'accepted invalid request';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
      IF err<>k.expected THEN RAISE EXCEPTION 'v352 smoke: %: %',k.name,err; END IF;
    END;
    RESET ROLE;
  END LOOP;

  -- Metadata state changes are confined to the synthetic campaign.
  FOR k IN SELECT * FROM (VALUES
    ('disabled', 'server_campaign_tag_configuration_invalid'),
    ('deleted tag', 'zero'), -- v354: the shared mutation core skips deleted tags.
    ('deleted contact', 'zero'),
    ('settled input', 'server_campaign_tag_input_not_owned'),
    ('replaced unit', 'server_campaign_tag_claim_invalid'),
    ('released claim', 'server_campaign_tag_claim_invalid'),
    ('desktop owner', 'server_campaign_tag_claim_invalid'),
    ('deleted account', 'server_campaign_tag_claim_invalid')
  ) cases(name,expected) LOOP
    BEGIN
      IF k.name='disabled' THEN UPDATE public.auto_campaigns SET extra_settings=extra_settings||'{"enableAkaBizTag":false}' WHERE id=c;
      ELSIF k.name='deleted tag' THEN UPDATE public.auto_contact_tags SET is_delete=true WHERE id=tag;
      ELSIF k.name='deleted contact' THEN UPDATE public.auto_account_contacts SET is_delete=true WHERE id=contact;
      ELSIF k.name='settled input' THEN UPDATE public.auto_campaign_input_data SET status='tạm dừng' WHERE id=i;
      ELSIF k.name='replaced unit' THEN UPDATE public.auto_campaigns SET runtime_unit_token=claim WHERE id=c;
      ELSIF k.name='released claim' THEN UPDATE public.auto_campaigns SET runtime_claim_token=NULL WHERE id=c;
      ELSIF k.name='desktop owner' THEN UPDATE public.auto_campaigns SET runtime_claim_target='desktop' WHERE id=c;
      ELSIF k.name='deleted account' THEN UPDATE public.auto_accounts SET is_delete=true WHERE id=a; END IF;
      SET LOCAL ROLE anon;
      BEGIN
        r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v352-user',ARRAY[tag]);
        IF k.expected<>'zero' OR r->>'count'<>'0' THEN RAISE EXCEPTION 'accepted invalid state'; END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
        IF err<>k.expected THEN RAISE EXCEPTION 'v352 smoke: %: %',k.name,err; END IF;
      END;
      RESET ROLE;
      RAISE SQLSTATE 'Z0352'; -- rollback the synthetic state change after asserting
    EXCEPTION WHEN SQLSTATE 'Z0352' THEN NULL;
    END;
  END LOOP;

  UPDATE public.auto_campaigns SET status='tạm dừng' WHERE id=c;
  UPDATE public.auto_accounts SET status='tạm dừng' WHERE id=a;
  SET LOCAL ROLE anon;
  r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v352-user',ARRAY[tag]);
  IF r->>'count'<>'0' THEN RAISE EXCEPTION 'v352 smoke: soft pause drain'; END IF;
  -- Authenticated and service-role API roles still require the opaque claims.
  SET LOCAL ROLE authenticated;
  PERFORM public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v352-user',ARRAY[tag]);
  SET LOCAL ROLE service_role;
  PERFORM public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v352-user',ARRAY[tag]);
  RESET ROLE;

  -- Group aliases and string tag IDs accepted by existing campaign forms.
  UPDATE public.auto_campaigns SET action_id='zalo_message_group',extra_settings=jsonb_build_object(
    'enableAkaBizTag',true,'akaBizTagIds',jsonb_build_array(tag::text)) WHERE id=c;
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,canonical_target_key,is_delete,uid)
    VALUES(i+200,c,'đang chạy','uid:g352123456',false,'g352123456');
  UPDATE public.auto_campaigns SET runtime_unit_input_data_ids=ARRAY[i+200] WHERE id=c;
  SET LOCAL ROLE anon;
  r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i+200,'group','g352123456',ARRAY[tag]);
  IF r->>'count'<>'1' THEN RAISE EXCEPTION 'v352 smoke: group alias'; END IF;

  -- The common core is unavailable directly to all API roles.
  FOREACH err IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(err,'public.aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text)','EXECUTE')
      THEN RAISE EXCEPTION 'v352 smoke: core exposed to %',err; END IF;
  END LOOP;
  BEGIN
    PERFORM public.aka_agent_internal_mutate_contact_tags(s,o,ARRAY[contact],ARRAY[tag],'remove');
    RAISE EXCEPTION 'v352 smoke: core callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.aka_agent_mutate_contact_tags(s,o,ARRAY[contact],ARRAY[tag],NULL,NULL,'remove');
    RAISE EXCEPTION 'v352 smoke: Desktop auth bypassed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'automation_auth_required' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.aka_agent_mutate_contact_tags(s,o,ARRAY[contact],ARRAY[tag],'__v352_invalid__','__invalid__','remove');
    RAISE EXCEPTION 'v352 smoke: bad credentials accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  r:=public.aka_agent_mutate_contact_tags(s,o,ARRAY[contact],ARRAY[tag],NULL,NULL,'remove');
  IF r->>'count'<>'1' THEN RAISE EXCEPTION 'v352 smoke: legacy remove'; END IF;
  r:=public.aka_agent_mutate_contact_tags(s,o,ARRAY[contact],ARRAY[tag],NULL,NULL,'add');
  IF r->>'count'<>'1' THEN RAISE EXCEPTION 'v352 smoke: legacy add'; END IF;
  RESET ROLE;
END;
$smoke$;
SELECT 'PASS: Server anon tagging, replay, tenant/account/input/recipient/tag guards, released/replaced tokens, soft pause, group aliases, internal ACL and legacy auth/add/remove; rollback only' AS result,
  jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
    'definition_md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'prosecdef',p.prosecdef,
    'provolatile',p.provolatile,'proconfig',p.proconfig,'proacl',p.proacl)) AS functions
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.proname IN ('aka_agent_mutate_contact_tags','aka_agent_internal_mutate_contact_tags','aka_agent_apply_zalo_server_campaign_tags');
ROLLBACK;
