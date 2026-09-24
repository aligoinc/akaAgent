-- Diagnostic for the reported SMS. Always ROLLBACK; never fabricate a live result.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  v_reporter bigint; r record; before_campaign jsonb; before_input jsonb; before_counter jsonb;
  after_detail jsonb; before_automation bigint; before_failures bigint;
BEGIN
  SELECT id INTO v_reporter FROM public.auto_accounts
    WHERE id<>4745 AND flatform_type='sms' AND is_active=true AND is_delete=false
    ORDER BY id LIMIT 1;
  ASSERT v_reporter IS NOT NULL, 'need a second real SMS account for the cross-account test';
  SELECT to_jsonb(c) INTO before_campaign FROM public.auto_campaigns c WHERE id=17715;
  SELECT to_jsonb(i) INTO before_input FROM public.auto_campaign_input_data i WHERE id=4486246;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.account_id) INTO before_counter FROM public.auto_account_action_status s
    WHERE account_id IN (4745,v_reporter) AND action_code='sms_send';
  ASSERT before_campaign->>'is_delete'='true';
  ASSERT before_campaign->>'account_id'='4745';
  ASSERT before_input->>'campaign_id'='17715';
  ASSERT EXISTS(SELECT 1 FROM public.auto_campaign_details
    WHERE id=2568922 AND input_data_id=4486246 AND account_id=4745 AND NOT is_delete);
  SELECT count(*) INTO before_automation FROM public.auto_automation_detail WHERE source_campaign_detail_id=2568922;
  SELECT count(*) INTO before_failures FROM public.auto_automation_enqueue_failures WHERE source_campaign_detail_id=2568922;

  SELECT * INTO r FROM public.aka_agent_record_sms_message_status(4486246,v_reporter,'đã gửi');
  ASSERT r.accepted AND NOT r.counted AND NOT r.input_updated, 'B must be able to report A SMS';
  SELECT * INTO r FROM public.aka_agent_record_sms_message_status(4486246,4745,'đã gửi');
  ASSERT r.accepted AND r.detail_id=2568922 AND NOT r.counted AND NOT r.input_updated;
  SELECT * INTO r FROM public.aka_agent_record_sms_message_status(4486246,v_reporter,'đã nhận','v318 rollback smoke');
  ASSERT r.accepted AND r.detail_status='đã nhận' AND NOT r.counted AND NOT r.input_updated;
  SELECT to_jsonb(d) INTO after_detail FROM public.auto_campaign_details d WHERE id=2568922;
  ASSERT after_detail->>'account_id'='4745', 'history owner must remain A';
  SELECT * INTO r FROM public.aka_agent_record_sms_message_status(4486246,4745,'thất bại');
  ASSERT r.accepted AND r.detail_status='đã nhận' AND NOT r.counted AND NOT r.input_updated;
  SELECT * INTO r FROM public.aka_agent_record_sms_message_status(4486246,4745,'đã nhận');
  ASSERT r.accepted AND r.detail_status='đã nhận';
  ASSERT after_detail=(SELECT to_jsonb(d) FROM public.auto_campaign_details d WHERE id=2568922), 'retry changed history';
  ASSERT before_campaign=(SELECT to_jsonb(c) FROM public.auto_campaigns c WHERE id=17715), 'campaign changed';
  ASSERT before_input=(SELECT to_jsonb(i) FROM public.auto_campaign_input_data i WHERE id=4486246), 'input changed';
  ASSERT before_counter IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.account_id) FROM public.auto_account_action_status s WHERE account_id IN (4745,v_reporter) AND action_code='sms_send'), 'quota changed';
  ASSERT before_automation=(SELECT count(*) FROM public.auto_automation_detail WHERE source_campaign_detail_id=2568922), 'automation enqueued';
  ASSERT before_failures=(SELECT count(*) FROM public.auto_automation_enqueue_failures WHERE source_campaign_detail_id=2568922), 'automation trigger failed';
  ASSERT NOT EXISTS(SELECT 1 FROM public.aka_agent_list_sms_due_input_data(4745,ARRAY[17715::bigint],'viettel',30,30)), 'deleted campaign fetched';
END;
$smoke$;
RESET ROLE;
SELECT 'v318 production rollback PASS' AS result;
ROLLBACK;
