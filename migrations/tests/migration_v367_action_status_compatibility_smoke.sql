-- Runner wraps this fixture in a SAVEPOINT and always ROLLBACKs the transaction.
-- Synthetic paused campaigns only; no worker can see uncommitted outbox rows.
-- Identity sequence gaps are normal; never reset a sequence after the test.
DO $fixtures$
DECLARE
  original public.auto_campaigns%ROWTYPE;
  c bigint; target_c bigint; i bigint; next_i bigint; g bigint;
  campaign_rule bigint; group_rule bigint; d bigint; observed_d bigint;
  mt bigint; open_token uuid; click_token uuid; r jsonb; n integer;
  p public.auto_account_action_status_policies%ROWTYPE;
  claim uuid:=gen_random_uuid(); unit uuid:=gen_random_uuid(); rejected boolean;
BEGIN
  SELECT campaign.* INTO STRICT original FROM public.auto_campaigns campaign
  JOIN public.auto_accounts account ON account.id=campaign.account_id AND NOT coalesce(account.is_delete,false)
  JOIN public.org_staff staff ON staff.id=campaign.staff_id AND staff.is_active
  WHERE campaign.id=2417 AND NOT coalesce(campaign.is_delete,false);
  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,runtime_claim_token,runtime_unit_token,runtime_unit_claimed_at,extra_settings)
  VALUES('v367-rollback-smoke','email_send',original.account_id,original.staff_id,original.organization_id,'tạm dừng',claim,unit,now(),'{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":3}') RETURNING id INTO c;
  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status)
  VALUES('v367-rollback-target','email_send',original.account_id,original.staff_id,original.organization_id,'tạm dừng') RETURNING id INTO target_c;
  INSERT INTO public.auto_campaign_input_data(campaign_id,name,email,status)
  VALUES(c,'v367-rollback-smoke','v367-rollback@example.invalid','đang chạy') RETURNING id INTO i;
  INSERT INTO public.auto_campaign_input_data(campaign_id,name,email,status)
  VALUES(c,'v367-rollback-smoke','v367-rollback@example.invalid','chờ xử lý') RETURNING id INTO next_i;
  UPDATE public.auto_campaigns SET runtime_unit_input_data_ids=ARRAY[i] WHERE id=c;
  SELECT policy.* INTO STRICT p FROM public.auto_account_action_status_policies policy
  JOIN public.auto_status status ON status.id=policy.status_id
  WHERE policy.action_code IS NULL AND status.code='campaign_detail_success';
  -- Real writer: a custom output label with confirmed operation evidence.
  r:=public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,claim,unit,'v367:'||unit::text,
    jsonb_build_object('input_data_id',i,'action_code','email_send','action_name','v367-rollback-smoke','status','v367 custom delivered',
      'status_id',p.status_id,'action_status_policy_id',p.id,'log','preserved test log',
      'policy_snapshot',jsonb_build_object('reportGroup','success','countsTowardLimit',false,'badTargetEffect','ignore','resetErrorStreak',false,'inputEffect','complete','operationState','committed')));
  d:=(r->'detail'->>'id')::bigint;
  IF d IS NULL OR NOT EXISTS(SELECT 1 FROM public.aka_agent_internal_send_delivery_history(original.account_id,ARRAY['email_send'],now()-interval '1 minute',clock_timestamp()) WHERE detail_id=d) THEN
    RAISE EXCEPTION 'v367 custom committed history missing'; END IF;
  SELECT to_jsonb(result) INTO r FROM public.aka_agent_apply_campaign_delivery_cooldown(c,original.account_id,original.staff_id,ARRAY[next_i]) result;
  IF r->>'decision'<>'paused_recent_delivery' THEN RAISE EXCEPTION 'v367 custom cooldown missing'; END IF;
  rejected:=false;
  BEGIN
    PERFORM public.aka_agent_apply_campaign_delivery_cooldown(c,original.account_id,-1,ARRAY[next_i]);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='invalid_campaign_delivery_cooldown_scope' THEN rejected:=true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'v367 cooldown scope bypass'; END IF;
  INSERT INTO public.auto_account_contact_groups(name,contact_type,staff_id,organization_id,data_type_category_item_id)
  VALUES('v367-rollback-group','email',original.staff_id,original.organization_id,35) RETURNING id INTO g;
  INSERT INTO public.auto_automation(name,source_campaign_id,target_campaign_id,data_type_code,data_type_category_item_id,is_active,staff_id,organization_id,activated_at)
  VALUES('v367-rollback-rule',c,target_c,'email',35,true,original.staff_id,original.organization_id,now()-interval '1 hour') RETURNING id INTO campaign_rule;
  INSERT INTO public.auto_automation(name,source_campaign_id,target_data_group_id,data_type_code,data_type_category_item_id,is_active,staff_id,organization_id,activated_at)
  VALUES('v367-rollback-group-rule',c,g,'email',35,true,original.staff_id,original.organization_id,now()-interval '1 hour') RETURNING id INTO group_rule;
  INSERT INTO public.auto_automation_trigger_statuses(automation_id,status_mapping_id,action_code,status_value)
  VALUES(campaign_rule,79,'email_send','đã xem'),(group_rule,79,'email_send','đã xem');
  INSERT INTO public.auto_campaign_details(campaign_id,account_id,input_data_id,action_code,action_name,status,status_id,report_group,counts_toward_limit,policy_snapshot,log)
  VALUES(c,original.account_id,i,'email_send','v367-rollback-smoke','thành công',p.status_id,'success',false,'{"countsTowardLimit":false,"reportGroup":"success","operationState":"committed"}','preserved Email log') RETURNING id INTO observed_d;
  INSERT INTO public.auto_email_message_trackings(campaign_id,campaign_detail_id,account_id,input_data_id,recipient_email)
  VALUES(c,observed_d,original.account_id,i,'v367-rollback@example.invalid') RETURNING id,auto_email_message_trackings.open_token INTO mt,open_token;
  INSERT INTO public.auto_email_link_trackings(message_tracking_id,original_url,link_index)
  VALUES(mt,'https://example.invalid/',0) RETURNING auto_email_link_trackings.click_token INTO click_token;
  PERFORM public.aka_agent_mark_email_open(open_token::text,'v367-rollback');
  PERFORM public.aka_agent_mark_email_open(open_token::text,'v367-rollback');
  SELECT count(*) INTO n FROM public.auto_automation_detail WHERE source_campaign_detail_id=observed_d AND automation_id IN(campaign_rule,group_rule);
  IF n<>2 THEN RAISE EXCEPTION 'v367 legacy opened rule or dedupe failed: %',n; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_automation_enqueue_failures WHERE source_campaign_detail_id IN(d,observed_d) AND status='pending') THEN RAISE EXCEPTION 'v367 swallowed enqueue error'; END IF;
  -- Set the real service role as well as the claim for the reader checks.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SET LOCAL ROLE service_role;
  r:=public.aka_agent_list_campaign_details_page(original.staff_id,original.organization_id,c,NULL,'đã xem',NULL,NULL,0,100,'created_desc',NULL,NULL);
  IF (r->>'total')::integer<>1 OR r->'items'->0->'sub_status_presentation'->>'statusValue'<>'đã xem' THEN RAISE EXCEPTION 'v367 old reader filter failed'; END IF;
  r:=public.aka_agent_list_campaign_details_page_v2(original.staff_id,original.organization_id,c,'Đã xem',NULL,NULL,NULL,0,100,'created_desc',NULL,NULL,NULL);
  IF (r->>'total')::integer<>1 THEN RAISE EXCEPTION 'v367 reader search failed'; END IF;
  rejected:=false;
  BEGIN
    PERFORM public.aka_agent_list_campaign_details_page(original.staff_id,original.organization_id+1,c,NULL,NULL,NULL,NULL,0,100,'created_desc',NULL,NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='campaign_not_found' THEN rejected:=true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'v367 reader tenant bypass'; END IF;
  RESET ROLE;
  PERFORM public.aka_agent_mark_email_click(click_token::text,'v367-rollback');
  PERFORM public.aka_agent_mark_email_open(open_token::text,'v367-rollback');
  IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_details x JOIN public.auto_status s ON s.id=x.sub_status_id
    WHERE x.id=observed_d AND x.status='thành công' AND x.log='preserved Email log' AND s.code='campaign_detail_clicked' AND x.counts_toward_limit=false) THEN
    RAISE EXCEPTION 'v367 tracking changed main/log/quota or downgraded click'; END IF;
END $fixtures$;
