-- Only synthetic rows with explicit IDs; no Zalo commands or real campaign writes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='25s';
DO $smoke$
DECLARE
  s bigint; o bigint; r jsonb; k record; base jsonb; err text; tags bigint[]; settings text[];
  a constant bigint:=2000000353;
  c constant bigint:=8000000000003531;
  i constant bigint:=8000000000003532;
  contact constant bigint:=8000000000003533;
  tag constant bigint:=8000000000003534;
  other_tag constant bigint:=8000000000003535;
  claim constant uuid:='a3530000-0000-4000-8000-000000000001';
  unit constant uuid:='a3530000-0000-4000-8000-000000000002';
BEGIN
  SELECT staff.id,staff.organization_id INTO s,o FROM public.org_staff staff
    CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(staff.organization_id) caps
    WHERE staff.is_active IS TRUE AND caps.qr_enabled AND caps.server_enabled
      AND (caps.max_accounts IS NULL OR caps.max_accounts<=0 OR
        (SELECT count(*) FROM public.auto_accounts a WHERE a.staff_id=staff.id
          AND a.flatform_type='zalo' AND NOT a.is_delete)+2<=caps.max_accounts)
    ORDER BY staff.organization_id,staff.id LIMIT 1;
  IF s IS NULL THEN RAISE EXCEPTION 'v353 smoke: missing eligible fixture owner'; END IF;
  INSERT INTO public.auto_accounts(id,name,staff_id,organization_id,flatform_type,status,login_status,is_active,is_delete,is_zalo_server,is_zalo_show_web)
    OVERRIDING SYSTEM VALUE VALUES(a,'__v353_rollback_only__',s,o,'zalo','đang chạy','đã đăng nhập',true,false,true,false);
  INSERT INTO public.auto_contact_tags(id,name,staff_id,organization_id) OVERRIDING SYSTEM VALUE
    VALUES(tag,'__v353_rollback_only__',s,o),(other_tag,'__v353_not_configured__',s,o);
  INSERT INTO public.auto_campaigns(id,name,account_id,staff_id,organization_id,status,action_id,extra_settings,
    runtime_claim_token,runtime_claim_target,runtime_unit_token,runtime_unit_claimed_at,runtime_unit_input_data_ids)
    OVERRIDING SYSTEM VALUE VALUES(c,'__v353_rollback_only__',a,s,o,'đang chạy','zalo_message_phone',
      jsonb_build_object('enableAkaBizTag',true,'akaBizTagIds',jsonb_build_array(tag)),claim,'server',unit,now(),ARRAY[i]);
  INSERT INTO public.auto_campaign_input_data(id,campaign_id,status,canonical_target_key,is_delete,phone,uid)
    VALUES(i,c,'đang chạy','phone:0900000352',false,'0900000352','v353-user'),
      (i+100,c,'đang chạy','phone:0900000353',false,'0900000353','v353-user');
  INSERT INTO public.auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,flatform_type,name,uid,is_delete)
    VALUES(contact,a,s,o,'person','zalo','__v353_rollback_only__','v353-user',false),
      (contact+100,a,s,o,'person','zalo','__v353_unrelated__','v353-other',false),
      (contact+200,a,s,o,'group','zalo','__v353_group__','352123456',false);

  SELECT proconfig INTO settings FROM pg_proc WHERE oid=to_regprocedure(
    'public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])');
  IF settings IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
    THEN RAISE EXCEPTION 'v353 smoke: unexpected function settings %',settings; END IF;
  INSERT INTO public.auto_contact_tags(id,name,staff_id,organization_id) OVERRIDING SYSTEM VALUE
    SELECT tag+1000+n,'__v353_many_tags_'||n,s,o FROM generate_series(1,101) n;
  SELECT array_agg(tag+1000+n ORDER BY n) INTO tags FROM generate_series(1,101) n;
  UPDATE public.auto_campaigns SET extra_settings=jsonb_build_object('enableAkaBizTag',true,'akaBizTagIds',to_jsonb(tags)) WHERE id=c;
  SET LOCAL ROLE anon;
  r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v353-user',tags);
  IF r->>'count'<>'1' THEN RAISE EXCEPTION 'v353 smoke: 101 tags rejected %',r; END IF;
  r:=public.aka_agent_apply_zalo_server_campaign_tags(s,o,c,a,claim,unit,i,'person','v353-user',tags);
  IF r->>'count'<>'0' THEN RAISE EXCEPTION 'v353 smoke: 101-tag replay changed contact'; END IF;
  RESET ROLE;
  IF NOT (SELECT akabiz_tag_ids=tags FROM public.auto_account_contacts WHERE id=contact)
    THEN RAISE EXCEPTION 'v353 smoke: tags missing from target'; END IF;
  IF (SELECT cardinality(akabiz_tag_ids)>0 FROM public.auto_account_contacts WHERE id=contact+100)
    THEN RAISE EXCEPTION 'v353 smoke: unrelated contact changed'; END IF;
END;
$smoke$;
SELECT 'PASS: 101 configured tags accepted as anon, replay idempotent, unrelated contact unchanged; timeout matches Local; rollback only' AS result;
ROLLBACK;
