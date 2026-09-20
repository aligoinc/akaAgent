-- Database-only smoke; no Zalo/network action. All rows and trigger side effects roll back.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $smoke$
DECLARE
  fixture record;
  v_id uuid := gen_random_uuid();
  v_detail_id bigint;
  v_before timestamptz := clock_timestamp() - interval '10 minutes';
  v_global text := 'v295-smoke-' || v_id::text;
  v_payload jsonb;
  v_page jsonb;
BEGIN
  SELECT c.id AS campaign_id, c.account_id, c.staff_id, c.organization_id, i.id AS input_id,
    s.username, s.password INTO fixture
  FROM public.auto_campaigns c
  JOIN public.auto_accounts a ON a.id=c.account_id AND a.staff_id=c.staff_id AND a.organization_id=c.organization_id
  JOIN public.auto_campaign_input_data i ON i.campaign_id=c.id
  JOIN public.org_staff s ON s.id=c.staff_id AND s.organization_id=c.organization_id AND s.is_active AND s.deleted_at IS NULL
  WHERE c.action_id IN ('zalo_message_friend','zalo_message_phone') AND a.flatform_type='zalo'
    AND NOT COALESCE(c.is_delete,false) AND NOT COALESCE(a.is_delete,false)
  ORDER BY c.id,i.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'v295 smoke requires an eligible campaign input'; END IF;

  INSERT INTO public.auto_zalo_message_opt_outs(id,staff_id,organization_id,zalo_global_id,created_at)
  VALUES(v_id,fixture.staff_id,fixture.organization_id,v_global,v_before);
  v_payload := jsonb_build_object('target',jsonb_build_object('uid','v295-fixture','globalId',v_global),
    'messageOptOutSource',jsonb_build_object('version',1,'optOutId',v_id,'zaloGlobalId',v_global,
      'zaloName',v_global,'zaloAvatar',NULL,'sentAt',v_before + interval '1 minute'));
  INSERT INTO public.auto_campaign_details(campaign_id,input_data_id,account_id,action_code,action_name,status,data,counts_toward_limit)
  VALUES(fixture.campaign_id,fixture.input_id,fixture.account_id,'zalo_message_friend','Nhắn tin','thành công',v_payload,false)
  RETURNING id INTO v_detail_id;
  IF NOT EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs WHERE id=v_id AND source_detail_id=v_detail_id
    AND source_campaign_id=fixture.campaign_id) THEN RAISE EXCEPTION 'source capture failed'; END IF;

  PERFORM set_config('request.jwt.claim.role','anon',true);
  v_page := public.aka_agent_list_message_opt_out_customers(fixture.staff_id,fixture.organization_id,fixture.username,fixture.password,v_global,1);
  IF (v_page->>'total')::integer <> 0 THEN RAISE EXCEPTION 'pending opt-out leaked into list'; END IF;
  PERFORM public.aka_agent_confirm_zalo_message_opt_out(v_id);
  v_page := public.aka_agent_list_message_opt_out_customers(fixture.staff_id,fixture.organization_id,fixture.username,fixture.password,v_global,1);
  IF (v_page->>'total')::integer <> 1 OR v_page#>>'{items,0,id}' IS DISTINCT FROM v_id::text THEN
    RAISE EXCEPTION 'confirmed opt-out not returned';
  END IF;
  BEGIN
    PERFORM public.aka_agent_list_message_opt_out_customers(-1,fixture.organization_id,fixture.username,fixture.password,v_global,1);
    RAISE EXCEPTION 'unexpected_auth_success';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'automation_auth_invalid' THEN RAISE; END IF;
  END;

  v_payload := jsonb_set(v_payload,'{messageOptOutSource,sentAt}',to_jsonb(clock_timestamp()+interval '1 minute'));
  INSERT INTO public.auto_campaign_details(campaign_id,input_data_id,account_id,action_code,action_name,status,data,counts_toward_limit)
  VALUES(fixture.campaign_id,fixture.input_id,fixture.account_id,'zalo_message_friend','Nhắn tin','thành công',v_payload,false);
  IF NOT EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs WHERE id=v_id AND source_detail_id=v_detail_id) THEN
    RAISE EXCEPTION 'post-confirmation delivery replaced source';
  END IF;
  IF has_table_privilege('anon','public.auto_zalo_message_opt_outs','SELECT')
    OR NOT has_function_privilege('anon','public.aka_agent_list_message_opt_out_customers(bigint,bigint,text,text,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'unexpected reporting privileges';
  END IF;
END;
$smoke$;
ROLLBACK;
