-- Synthetic paused campaigns and fake email only. Caller always ROLLBACKs.
-- Outbox entries remain uncommitted; no worker can consume them.
DO $fixtures$
DECLARE
  original public.auto_campaigns%ROWTYPE;
  c bigint; target_c bigint; i bigint; g bigint; d bigint; mt bigint;
  campaign_rule bigint; group_rule bigint; mapping bigint;
  open_token uuid; click_token uuid; r jsonb; saved jsonb;
  p public.auto_account_action_status_policies%ROWTYPE;
  claim uuid:=gen_random_uuid(); unit uuid:=gen_random_uuid();
  report_group text; early boolean; n integer; observed bigint;
  before_quota jsonb; after_quota jsonb;
BEGIN
  SELECT campaign.* INTO STRICT original FROM public.auto_campaigns campaign
  JOIN public.auto_accounts account ON account.id=campaign.account_id AND NOT coalesce(account.is_delete,false)
  JOIN public.org_staff staff ON staff.id=campaign.staff_id AND staff.is_active
  WHERE campaign.id=2417 AND NOT coalesce(campaign.is_delete,false);
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) INTO before_quota
  FROM public.auto_account_action_status s WHERE s.account_id=original.account_id;
  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status,runtime_claim_token,runtime_unit_token,runtime_unit_claimed_at)
  VALUES('v368-rollback-smoke','email_send',original.account_id,original.staff_id,original.organization_id,'tạm dừng',claim,unit,now()) RETURNING id INTO c;
  INSERT INTO public.auto_campaigns(name,action_id,account_id,staff_id,organization_id,status)
  VALUES('v368-rollback-target','email_send',original.account_id,original.staff_id,original.organization_id,'tạm dừng') RETURNING id INTO target_c;
  INSERT INTO public.auto_campaign_input_data(campaign_id,name,email,status)
  VALUES(c,'v368-rollback-smoke','v368-rollback@example.invalid','đang chạy') RETURNING id INTO i;
  UPDATE public.auto_campaigns SET runtime_unit_input_data_ids=ARRAY[i] WHERE id=c;
  SELECT policy.* INTO STRICT p FROM public.auto_account_action_status_policies policy
  JOIN public.auto_status status ON status.id=policy.status_id
  WHERE policy.action_code IS NULL AND status.code='campaign_detail_success';
  SELECT id INTO STRICT mapping FROM public.auto_campaign_action_detail_statuses
  WHERE campaign_action_id='email_send' AND action_code IS NULL AND status_value='thành công' AND is_active AND NOT is_delete;
  SELECT id INTO STRICT observed FROM public.auto_status WHERE code='campaign_detail_viewed';
  INSERT INTO public.auto_account_contact_groups(name,contact_type,staff_id,organization_id,data_type_category_item_id)
  VALUES('v368-rollback-group','email',original.staff_id,original.organization_id,35) RETURNING id INTO g;
  INSERT INTO public.auto_automation(name,source_campaign_id,target_campaign_id,data_type_code,data_type_category_item_id,is_active,staff_id,organization_id,activated_at)
  VALUES('v368-rollback-rule',c,target_c,'email',35,true,original.staff_id,original.organization_id,now()-interval '1 hour') RETURNING id INTO campaign_rule;
  INSERT INTO public.auto_automation(name,source_campaign_id,target_data_group_id,data_type_code,data_type_category_item_id,is_active,staff_id,organization_id,activated_at)
  VALUES('v368-rollback-group-rule',c,g,'email',35,true,original.staff_id,original.organization_id,now()-interval '1 hour') RETURNING id INTO group_rule;
  INSERT INTO public.auto_automation_trigger_statuses(automation_id,status_mapping_id,action_code,status_value,sub_status_ids)
  VALUES(campaign_rule,mapping,NULL,'thành công',ARRAY[observed]),(group_rule,mapping,NULL,'thành công',ARRAY[observed]);
  FOREACH report_group IN ARRAY ARRAY['success','pending','skipped','failure'] LOOP
    FOREACH early IN ARRAY ARRAY[false,true] LOOP
      r:=public.aka_agent_write_action_result_v1(original.staff_id,c,original.account_id,claim,unit,'v368:'||unit::text||':'||report_group||':'||early::text,
        jsonb_build_object('input_data_id',i,'action_code','email_send','action_name','v368-rollback-smoke','status','thành công',
          'status_id',p.status_id,'action_status_policy_id',p.id,'log','preserved test log',
          'policy_snapshot',jsonb_build_object('reportGroup',report_group,'countsTowardLimit',false,'badTargetEffect','ignore','resetErrorStreak',false,'inputEffect','complete','operationState','committed')));
      d:=(r->'detail'->>'id')::bigint;
      SELECT to_jsonb(detail)-'sub_status_id' INTO saved FROM public.auto_campaign_details detail WHERE id=d;
      INSERT INTO public.auto_email_message_trackings(campaign_id,campaign_detail_id,account_id,input_data_id,recipient_email)
      VALUES(c,CASE WHEN early THEN NULL ELSE d END,original.account_id,i,'v368-rollback@example.invalid')
      RETURNING id,auto_email_message_trackings.open_token INTO mt,open_token;
      INSERT INTO public.auto_email_link_trackings(message_tracking_id,original_url,link_index)
      VALUES(mt,'https://example.invalid/',0) RETURNING auto_email_link_trackings.click_token INTO click_token;
      SET LOCAL ROLE anon;
      PERFORM public.aka_agent_mark_email_open(open_token::text,'v368-rollback');
      RESET ROLE;
      IF early THEN
        IF EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE id=d AND sub_status_id IS NOT NULL) THEN RAISE EXCEPTION 'unlinked callback touched detail'; END IF;
        UPDATE public.auto_email_message_trackings SET campaign_detail_id=d WHERE id=mt;
      END IF;
      IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE id=d AND sub_status_id=observed) THEN
        RAISE EXCEPTION 'v368 open missing for % / early %',report_group,early; END IF;
      SELECT count(*) INTO n FROM public.auto_automation_detail WHERE source_campaign_detail_id=d AND automation_id IN(campaign_rule,group_rule);
      IF n<>2 THEN RAISE EXCEPTION 'v368 Automation edge missing: %',n; END IF;
      SET LOCAL ROLE anon;
      PERFORM public.aka_agent_mark_email_open(open_token::text,'v368-rollback');
      PERFORM public.aka_agent_mark_email_click(click_token::text,'v368-rollback');
      PERFORM public.aka_agent_mark_email_open(open_token::text,'v368-rollback');
      RESET ROLE;
      IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_details detail JOIN public.auto_status s ON s.id=detail.sub_status_id WHERE detail.id=d AND s.code='campaign_detail_clicked') THEN
        RAISE EXCEPTION 'v368 click missing/downgraded'; END IF;
      IF saved IS DISTINCT FROM (SELECT to_jsonb(detail)-'sub_status_id' FROM public.auto_campaign_details detail WHERE id=d) THEN
        RAISE EXCEPTION 'v368 changed primary result/history'; END IF;
      SELECT count(*) INTO n FROM public.auto_automation_detail WHERE source_campaign_detail_id=d AND automation_id IN(campaign_rule,group_rule);
      IF n<>2 THEN RAISE EXCEPTION 'v368 duplicate Automation: %',n; END IF;
    END LOOP;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.auto_automation_enqueue_failures WHERE source_campaign_id=c AND status='pending') THEN
    RAISE EXCEPTION 'v368 swallowed Automation failure'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) INTO after_quota
  FROM public.auto_account_action_status s WHERE s.account_id=original.account_id;
  IF before_quota IS DISTINCT FROM after_quota THEN RAISE EXCEPTION 'v368 changed account quota'; END IF;
END $fixtures$;
