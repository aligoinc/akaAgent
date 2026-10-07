-- Only synthetic rows with explicit IDs; no Zalo commands or real campaign writes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='25s';
DO $smoke$
DECLARE
  s bigint; o bigint; r jsonb; k record; base jsonb; err text; kind text; target_id bigint; target_uid text; current_input bigint; other_staff bigint; other_org bigint; expected_scope text;
  a constant bigint:=2000000354;
  c constant bigint:=8000000000003541;
  i constant bigint:=8000000000003542;
  contact constant bigint:=8000000000003543;
  tag constant bigint:=8000000000003544;
  other_tag constant bigint:=8000000000003545;
  claim constant uuid:='a3540000-0000-4000-8000-000000000001';
  unit constant uuid:='a3540000-0000-4000-8000-000000000002';
BEGIN
  SELECT staff.id,staff.organization_id INTO s,o FROM public.org_staff staff
    CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(staff.organization_id) caps
    WHERE staff.is_active IS TRUE AND caps.qr_enabled AND caps.server_enabled
      AND (caps.max_accounts IS NULL OR caps.max_accounts<=0 OR
        (SELECT count(*) FROM public.auto_accounts a WHERE a.staff_id=staff.id
          AND a.flatform_type='zalo' AND NOT a.is_delete)+2<=caps.max_accounts)
    ORDER BY staff.organization_id,staff.id LIMIT 1;
  IF s IS NULL THEN RAISE EXCEPTION 'v354 smoke: missing eligible fixture owner'; END IF;
  INSERT INTO public.auto_accounts(id,name,staff_id,organization_id,flatform_type,status,login_status,is_active,is_delete,is_zalo_server,is_zalo_show_web)
    OVERRIDING SYSTEM VALUE VALUES(a,'__v354_rollback_only__',s,o,'zalo','đang chạy','đã đăng nhập',true,false,true,false);
  INSERT INTO public.auto_contact_tags(id,name,staff_id,organization_id) OVERRIDING SYSTEM VALUE
    VALUES(tag,'__v354_rollback_only__',s,o),(other_tag,'__v354_not_configured__',s,o);
  INSERT INTO public.auto_campaigns(id,name,account_id,staff_id,organization_id,status,action_id,extra_settings,
    runtime_claim_token,runtime_claim_target,runtime_unit_token,runtime_unit_claimed_at,runtime_unit_input_data_ids)
    OVERRIDING SYSTEM VALUE VALUES(c,'__v354_rollback_only__',a,s,o,'đang chạy','zalo_message_phone',
      jsonb_build_object('enableAkaBizTag',true,'akaBizTagIds',jsonb_build_array(tag)),claim,'server',unit,now(),ARRAY[i]);
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,canonical_target_key,is_delete,phone,uid)
    VALUES(i,c,'đang chạy','phone:0900000354',false,'0900000354','v354-user'),
      (i+100,c,'đang chạy','phone:0900000353',false,'0900000353','v354-user');
  INSERT INTO public.auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,flatform_type,name,uid,is_delete)
    VALUES(contact,a,s,o,'person','zalo','__v354_rollback_only__','v354-user',false),
      (contact+100,a,s,o,'person','zalo','__v354_unrelated__','v354-other',false),
      (contact+200,a,s,o,'group','zalo','__v354_group__','354123456',false);

  -- Only fixture tags/accounts are modified; real owner IDs are read for FK-valid scope tests.
  SELECT id INTO other_staff FROM public.org_staff WHERE id<>s ORDER BY id LIMIT 1;
  SELECT id INTO other_org FROM public.org_organization WHERE id<>o ORDER BY id LIMIT 1;
  IF other_staff IS NULL OR other_org IS NULL THEN RAISE EXCEPTION 'v354 fixture: missing alternate scopes'; END IF;
  INSERT INTO public.auto_accounts(id,name,staff_id,organization_id,flatform_type,status,login_status,is_active,is_delete,is_zalo_server,is_zalo_show_web)
    OVERRIDING SYSTEM VALUE VALUES(a+1,'__v354_other_account__',s,o,'zalo','tạm dừng','đã đăng nhập',true,false,true,false);
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,canonical_target_key,is_delete,uid)
    VALUES(i+200,c,'đang chạy','uid:g354123456',false,'g354123456');
  UPDATE public.auto_contact_tags SET is_delete=true WHERE id=other_tag;
  FOREACH kind IN ARRAY ARRAY['person','group'] LOOP
    target_id:=CASE WHEN kind='person' THEN contact ELSE contact+200 END;
    current_input:=CASE WHEN kind='person' THEN i ELSE i+200 END;
    target_uid:=CASE WHEN kind='person' THEN 'v354-user' ELSE 'g354123456' END;
    UPDATE public.auto_campaigns SET action_id=CASE WHEN kind='person' THEN 'zalo_message_phone' ELSE 'zalo_message_group' END,
      runtime_unit_input_data_ids=ARRAY[current_input],extra_settings=jsonb_build_object('enableAkaBizTag',true,'akaBizTagIds',jsonb_build_array(tag,other_tag)) WHERE id=c;
    SET LOCAL ROLE anon;
    r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,current_input,kind,target_uid,ARRAY[tag,other_tag]);
    IF r->>'count'<>'1' THEN RAISE EXCEPTION 'v354: mixed active/deleted tags failed for %: %',kind,r; END IF;
    r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,current_input,kind,target_uid,ARRAY[tag,other_tag]);
    IF r->>'count'<>'0' THEN RAISE EXCEPTION 'v354: replay changed %',kind; END IF;
    RESET ROLE;
    IF NOT (SELECT akabiz_tag_ids=ARRAY[tag] FROM public.auto_account_contacts WHERE id=target_id)
      THEN RAISE EXCEPTION 'v354: wrong tags on %',kind; END IF;
    -- All-deleted input succeeds as a no-op and never resurrects the tag.
    UPDATE public.auto_account_contacts SET akabiz_tag_ids='{}'::bigint[] WHERE id=target_id;
    SET LOCAL ROLE anon;
    r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,current_input,kind,target_uid,ARRAY[other_tag]);
    IF r->>'count'<>'0' THEN RAISE EXCEPTION 'v354: all-deleted request changed %',kind; END IF;
    RESET ROLE;
    IF (SELECT cardinality(akabiz_tag_ids)<>0 FROM public.auto_account_contacts WHERE id=target_id)
      THEN RAISE EXCEPTION 'v354: deleted tag restored for %',kind; END IF;
    -- Deletion never bypasses staff/organization/account/configuration checks.
    FOREACH expected_scope IN ARRAY ARRAY['staff','organization','account','configuration'] LOOP
      BEGIN
        IF expected_scope='staff' THEN UPDATE public.auto_contact_tags SET staff_id=other_staff WHERE id=other_tag;
        ELSIF expected_scope='organization' THEN UPDATE public.auto_contact_tags SET organization_id=other_org WHERE id=other_tag;
        ELSIF expected_scope='account' THEN UPDATE public.auto_contact_tags SET auto_account_id=a+1 WHERE id=other_tag;
        ELSE UPDATE public.auto_campaigns SET extra_settings=jsonb_build_object('enableAkaBizTag',true,'akaBizTagIds',jsonb_build_array(tag)) WHERE id=c; END IF;
        SET LOCAL ROLE anon;
        err:=NULL;
        BEGIN
          PERFORM public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,current_input,kind,target_uid,ARRAY[tag,other_tag]);
        EXCEPTION WHEN OTHERS THEN err:=SQLERRM;
        END;
        RESET ROLE;
        IF err IS DISTINCT FROM 'server_campaign_tag_scope_invalid'
          THEN RAISE EXCEPTION 'v354: deleted tag bypassed % guard for %: %',expected_scope,kind,err; END IF;
        IF (SELECT cardinality(akabiz_tag_ids)<>0 FROM public.auto_account_contacts WHERE id=target_id)
          THEN RAISE EXCEPTION 'v354: invalid scope changed %',kind; END IF;
        RAISE SQLSTATE 'Z0354';
      EXCEPTION WHEN SQLSTATE 'Z0354' THEN NULL;
      END;
    END LOOP;
    -- Compare with the unchanged Local entrypoint, not a reimplemented filter.
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    r:=public.aka_agent_mutate_contact_tags(s,o,ARRAY[target_id],ARRAY[tag,other_tag],NULL,NULL,'add');
    IF r->>'count'<>'1' THEN RAISE EXCEPTION 'v354: Local parity failed for %',kind; END IF;
    RESET ROLE;
    IF NOT (SELECT akabiz_tag_ids=ARRAY[tag] FROM public.auto_account_contacts WHERE id=target_id)
      THEN RAISE EXCEPTION 'v354: Local tags differ for %',kind; END IF;
  END LOOP;
  IF (SELECT cardinality(akabiz_tag_ids)>0 FROM public.auto_account_contacts WHERE id=contact+100)
    THEN RAISE EXCEPTION 'v354: unrelated contact changed'; END IF;
  IF NOT (SELECT is_delete FROM public.auto_contact_tags WHERE id=other_tag)
    THEN RAISE EXCEPTION 'v354: tag resurrected'; END IF;
END;
$smoke$;
SELECT 'PASS: person/group mixed deleted tags, all-deleted no-op, replay, Local parity, deleted-tag staff/org/account/config guards, no unrelated changes; rollback only' AS result;
ROLLBACK;
