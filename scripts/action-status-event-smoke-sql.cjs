// Executed only inside action-status-readers-smoke's ROLLBACK transaction.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
module.exports = function eventTests(m, before, fixture, directory) {
  const source = JSON.parse(fs.readFileSync(path.join(directory, 'event-fixture-schema.json'), 'utf8'))
  const tests = source.inputs.map(input => {
    assert(input.input_id)
    const trigger = before.tables.auto_automation_trigger_statuses.rows.find(x => x.row.automation_id === input.automation_id).row
    const insert = `INSERT INTO public.auto_campaign_details(campaign_id,input_data_id,account_id,action_code,action_name,status,counts_toward_limit)
      VALUES (${input.source_campaign_id},${input.input_id},${input.account_id},${m.quote(trigger.action_code)},'reader-smoke',${m.quote(trigger.status_value)},false) RETURNING id INTO detail_id;`
    return `DO $events$ DECLARE detail_id bigint; BEGIN
      UPDATE public.auto_automation SET is_active=true,activated_at=transaction_timestamp()-interval '1 second' WHERE id=${input.automation_id};
      UPDATE public.auto_automation_trigger_statuses SET sub_status_ids=ARRAY[52::bigint] WHERE automation_id=${input.automation_id};
      ${insert}
      IF EXISTS(SELECT 1 FROM public.auto_automation_detail WHERE source_campaign_detail_id=detail_id AND automation_id=${input.automation_id}) THEN RAISE EXCEPTION 'secondary rule fired without secondary'; END IF;
      UPDATE public.auto_campaign_details SET sub_status_id=52 WHERE id=detail_id;
      IF (SELECT count(*) FROM public.auto_automation_detail WHERE source_campaign_detail_id=detail_id AND automation_id=${input.automation_id})<>1 THEN RAISE EXCEPTION 'secondary transition did not enqueue'; END IF;
      UPDATE public.auto_campaign_details SET sub_status_id=52 WHERE id=detail_id;
      UPDATE public.auto_campaign_details SET sub_status_id=53 WHERE id=detail_id;
      UPDATE public.auto_campaign_details SET sub_status_id=52 WHERE id=detail_id;
      IF (SELECT count(*) FROM public.auto_automation_detail WHERE source_campaign_detail_id=detail_id AND automation_id=${input.automation_id})<>1 THEN RAISE EXCEPTION 'secondary transition duplicated automation'; END IF;
      UPDATE public.auto_automation SET is_active=false WHERE id=${input.automation_id};
      UPDATE public.auto_automation_trigger_statuses SET sub_status_ids=NULL WHERE automation_id=${input.automation_id};
      ${insert}
      UPDATE public.auto_automation SET is_active=true WHERE id=${input.automation_id};
      UPDATE public.auto_campaign_details SET sub_status_id=52 WHERE id=detail_id;
      IF EXISTS(SELECT 1 FROM public.auto_automation_detail WHERE source_campaign_detail_id=detail_id AND automation_id=${input.automation_id}) THEN RAISE EXCEPTION 'main-only rule fired on secondary-only update'; END IF;
      IF EXISTS(SELECT 1 FROM public.auto_automation_enqueue_failures WHERE source_campaign_detail_id=detail_id AND status='pending') THEN RAISE EXCEPTION 'enqueue swallowed an error'; END IF;
    END $events$;`
  })
  const input = source.inputs[0]
  const owner = fixture.automations.find(a => a.id === input.automation_id)
  const pageArgs=`p_staff_id=>${owner.staff_id}::bigint,p_organization_id=>${owner.organization_id}::bigint,p_campaign_id=>${input.source_campaign_id}::bigint,p_search=>'reader-smoke'::text,p_status=>NULL::text,p_date_from=>NULL::timestamptz,p_date_to=>NULL::timestamptz,p_offset=>0,p_limit=>500,p_sort=>'created_desc'::text,p_auth_username=>NULL::text,p_auth_password=>NULL::text`
  tests.push(`DO $tracking$ DECLARE managed boolean; detail_id bigint; message_id bigint; open_key uuid; click_key uuid; before_detail jsonb; after_detail jsonb; page jsonb; BEGIN
    FOREACH managed IN ARRAY ARRAY[false,true] LOOP
      INSERT INTO public.auto_campaign_details(campaign_id,account_id,action_code,action_name,status,status_id,report_group,counts_toward_limit,policy_snapshot,log)
      VALUES (${input.source_campaign_id},${input.account_id},'email_send','reader-smoke','thành công',CASE WHEN managed THEN 20 ELSE NULL END,CASE WHEN managed THEN 'success' ELSE NULL END,true,CASE WHEN managed THEN '{"countsTowardLimit":true}'::jsonb ELSE NULL END,'reader-smoke')
      RETURNING id,to_jsonb(auto_campaign_details) INTO detail_id,before_detail;
      INSERT INTO public.auto_email_message_trackings(campaign_id,campaign_detail_id,recipient_email)
      VALUES (${input.source_campaign_id},detail_id,'reader-smoke@example.invalid') RETURNING id,open_token INTO message_id,open_key;
      INSERT INTO public.auto_email_link_trackings(message_tracking_id,original_url,link_index)
      VALUES (message_id,'https://example.invalid/',0) RETURNING click_token INTO click_key;
      PERFORM public.aka_agent_mark_email_open(open_key::text,'rollback-smoke');
      SELECT to_jsonb(d) INTO after_detail FROM public.auto_campaign_details d WHERE id=detail_id;
      IF managed THEN
        IF after_detail->>'sub_status_id'<>'34' OR (after_detail-'sub_status_id') IS DISTINCT FROM (before_detail-'sub_status_id') THEN RAISE EXCEPTION 'open changed original policy result'; END IF;
      ELSIF after_detail->>'status'<>'đã xem' THEN RAISE EXCEPTION 'legacy email open changed'; END IF;
      PERFORM public.aka_agent_mark_email_click(click_key::text,'rollback-smoke');
      PERFORM public.aka_agent_mark_email_open(open_key::text,'rollback-smoke');
      SELECT to_jsonb(d) INTO after_detail FROM public.auto_campaign_details d WHERE id=detail_id;
      IF managed THEN
        IF after_detail->>'sub_status_id'<>'23' OR (after_detail-'sub_status_id') IS DISTINCT FROM (before_detail-'sub_status_id') THEN RAISE EXCEPTION 'click changed or downgraded original policy result'; END IF;
      ELSIF after_detail->>'status'<>'đã click' THEN RAISE EXCEPTION 'legacy email click changed'; END IF;
      page:=public.aka_agent_list_campaign_details_page_v2(${pageArgs});
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') d WHERE (d->>'id')::bigint=detail_id AND d->>'status'=after_detail->>'status'
        AND (NOT managed OR d->'sub_status_presentation'->>'code'='campaign_detail_clicked')) THEN RAISE EXCEPTION 'detail v2 page lost result metadata or legacy row'; END IF;
      page:=public.aka_agent_list_campaign_details_page(${pageArgs});
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') d WHERE (d->>'id')::bigint=detail_id AND d->>'status'=after_detail->>'status'
        AND (NOT managed OR d->'sub_status_presentation'->>'code'='campaign_detail_clicked')) THEN RAISE EXCEPTION 'detail legacy page lost result metadata or legacy row'; END IF;
    END LOOP;
  END $tracking$;`)
  tests.push(`DO $reports$ DECLARE old_report record; new_report record; pending_input bigint; BEGIN
    SELECT * INTO old_report FROM public.crm_agent_campaign_results(ARRAY[${owner.organization_id}::bigint],ARRAY[${input.source_campaign_id}::bigint]);
    INSERT INTO public.auto_campaign_details(campaign_id,account_id,action_code,action_name,status,status_id,report_group,counts_toward_limit)
    VALUES (${input.source_campaign_id},${input.account_id},'email_send','reader-smoke','reader-smoke',21,'failure',false),
      (${input.source_campaign_id},${input.account_id},'email_send','reader-smoke','reader-smoke',20,'success',true);
    SELECT * INTO new_report FROM public.crm_agent_campaign_results(ARRAY[${owner.organization_id}::bigint],ARRAY[${input.source_campaign_id}::bigint]);
    IF new_report.successful<>old_report.successful+1 OR new_report.failed<>old_report.failed+1 THEN RAISE EXCEPTION 'report ignored stored group for unknown text'; END IF;
    INSERT INTO public.auto_campaign_input_data(campaign_id,name,status) VALUES(${input.source_campaign_id},'reader-smoke','chờ xử lý') RETURNING id INTO pending_input;
    INSERT INTO public.auto_campaign_details(campaign_id,account_id,input_data_id,action_code,action_name,status,status_id,report_group,counts_toward_limit)
    VALUES (${input.source_campaign_id},${input.account_id},pending_input,'email_send','reader-smoke','reader-smoke',20,'pending',false);
    SELECT * INTO new_report FROM public.crm_agent_campaign_results(ARRAY[${owner.organization_id}::bigint],ARRAY[${input.source_campaign_id}::bigint]);
    IF new_report.pending<>old_report.pending+1 THEN RAISE EXCEPTION 'CRM pending input/result counted twice'; END IF;
  END $reports$;`)
  tests.push(`DO $sms$ DECLARE c bigint; i bigint; d bigint; r record; original jsonb; current_row jsonb; managed boolean; quota_before bigint; quota_after bigint; BEGIN
    INSERT INTO public.auto_campaigns(name,account_id,staff_id,organization_id,action_id,status)
    VALUES ('reader-smoke',${input.account_id},${owner.staff_id},${owner.organization_id},'sms_send','tạm dừng') RETURNING id INTO c;
    FOREACH managed IN ARRAY ARRAY[false,true] LOOP
      INSERT INTO public.auto_campaign_input_data(campaign_id,name,phone,status,note) VALUES(c,'reader-smoke','0900000000','đang chạy','preserved note') RETURNING id INTO i;
      SELECT coalesce(sum(count_action_in_day),0) INTO quota_before FROM public.auto_account_action_status WHERE account_id=${input.account_id} AND action_code='sms_send';
      IF managed THEN
        INSERT INTO public.auto_campaign_details(campaign_id,input_data_id,account_id,action_code,action_name,status,status_id,report_group,counts_toward_limit,log,policy_snapshot)
        VALUES(c,i,${input.account_id},'sms_send','reader-smoke','thành công',20,'success',true,'preserved log','{"countsTowardLimit":true,"reportGroup":"success"}'::jsonb) RETURNING id INTO d;
      ELSE
        SELECT * INTO r FROM public.aka_agent_record_sms_message_status(i,${input.account_id},'đã gửi','legacy sent');
        IF NOT r.accepted OR NOT r.counted THEN RAISE EXCEPTION 'legacy SMS initial result changed'; END IF;
        d:=r.detail_id;
      END IF;
      SELECT to_jsonb(t) INTO original FROM public.auto_campaign_details t WHERE id=d;
      SELECT * INTO r FROM public.aka_agent_record_sms_message_status(i,${input.account_id},'đã nhận','new observation');
      IF NOT r.accepted OR r.counted THEN RAISE EXCEPTION 'SMS observation counted again'; END IF;
      PERFORM public.aka_agent_record_sms_message_status(i,${input.account_id},'đã gửi','late sent');
      PERFORM public.aka_agent_record_sms_message_status(i,${input.account_id},'thất bại','late failure');
      SELECT to_jsonb(t) INTO current_row FROM public.auto_campaign_details t WHERE id=d;
      IF managed THEN
        IF current_row->>'sub_status_id'<>'32' OR (current_row-'sub_status_id'-'data') IS DISTINCT FROM (original-'sub_status_id'-'data') THEN RAISE EXCEPTION 'managed SMS observation changed effective decision'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_input_data WHERE id=i AND status='đang chạy' AND note='preserved note') THEN RAISE EXCEPTION 'managed SMS observation rewrote input'; END IF;
      ELSIF current_row->>'status'<>'đã nhận' THEN RAISE EXCEPTION 'legacy SMS receipt downgraded'; END IF;
      SELECT coalesce(sum(count_action_in_day),0) INTO quota_after FROM public.auto_account_action_status WHERE account_id=${input.account_id} AND action_code='sms_send';
      IF quota_after<>quota_before+(CASE WHEN managed THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'SMS quota duplicated'; END IF;
    END LOOP;
  END $sms$;`)
  return tests.join('\n')
}
