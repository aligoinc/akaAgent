-- Run with scripts/run-sms-deleted-campaign-smoke.cjs in an isolated local DB.
BEGIN;
SET LOCAL statement_timeout='10s';
INSERT INTO auto_campaigns(id,account_id,name,is_delete,status,schedule,note) VALUES
 (1,10,'deleted',true,'tạm dừng','2026-01-01','keep'),
 (2,10,'live',false,'chờ xử lý','2026-01-01','keep'),
 (3,10,'deleted input',false,'tạm dừng','2026-01-01','keep'),
 (4,10,'non-SMS',true,'tạm dừng','2026-01-01','keep');
UPDATE auto_campaigns SET action_id='voice_call' WHERE id=4;
INSERT INTO auto_campaign_input_data(id,campaign_id,status,phone,content,phone_carrier,is_delete) VALUES
 (1,1,'hoàn thành','0900000001','fixture','viettel',false),
 (2,1,'chờ xử lý','0900000002','fixture','viettel',false),
 (3,2,'chờ xử lý','0900000003','fixture','viettel',false),
 (4,3,'chờ xử lý','0900000004','fixture','viettel',true),
 (5,1,'hoàn thành','0900000005','fixture','viettel',false),
 (6,4,'hoàn thành','0900000006','fixture','viettel',false),
 (7,1,'hoàn thành','0900000007','fixture','viettel',false),
 (8,2,'chờ xử lý','0900000008','fixture','viettel',false),
 (9,1,'hoàn thành','0900000009','fixture','viettel',false);
INSERT INTO auto_campaign_details(input_data_id,campaign_id,account_id,action_code,status,data,is_delete) VALUES
 (1,1,10,'sms_send','đã gửi','{"sentAt":"2026-01-01","providerMessageId":"fixture"}',false),
 (4,3,10,'sms_send','đã gửi','{}',false),
 (5,1,20,'sms_send','đã gửi','{}',false),
 (6,4,10,'sms_send','đã gửi','{}',false),
 (7,1,10,'sms_send','đã gửi','{}',true),
 (9,2,10,'sms_send','đã gửi','{}',false);
INSERT INTO auto_account_contact_groups VALUES(1,1,1,'data_group',false);
INSERT INTO auto_automation_actions VALUES('campaign_detail_route',true,true,false);
INSERT INTO auto_automation_data_types VALUES('phone','phone');
INSERT INTO auto_campaign_action_data_types VALUES('sms_send','phone',true,true,false,NULL,'phone');
INSERT INTO auto_automation(id,name,source_campaign_id,target_data_group_id,staff_id,organization_id,is_active,is_delete,activated_at,automation_action_id,data_type_code,schedule_mode)
 VALUES(1,'deleted rule',1,1,1,1,true,false,'2020-01-01','campaign_detail_route','phone','immediate'),
       (2,'active rule',2,1,1,1,true,false,'2020-01-01','campaign_detail_route','phone','immediate');
INSERT INTO auto_automation_trigger_statuses VALUES(1,'đã nhận','sms_send'),(2,'đã nhận','sms_send');
DO $test$
DECLARE r record; before_campaign jsonb; before_input jsonb; baseline_detail jsonb;
BEGIN
  SELECT to_jsonb(c) INTO before_campaign FROM auto_campaigns c WHERE id=1;
  SELECT to_jsonb(i) INTO before_input FROM auto_campaign_input_data i WHERE id=1;
  SELECT * INTO r FROM aka_agent_record_sms_message_status(1,20,'đã nhận');
  ASSERT NOT r.accepted, 'wrong account must fail';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(5,10,'đã nhận');
  ASSERT NOT r.accepted, 'foreign history must fail';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(9,10,'đã nhận');
  ASSERT NOT r.accepted, 'history in a different campaign must fail';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(6,10,'đã nhận');
  ASSERT NOT r.accepted, 'non-SMS campaign must fail';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(7,10,'đã nhận');
  ASSERT NOT r.accepted, 'deleted history must not be recreated';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(2,10,'đã gửi');
  ASSERT NOT r.accepted, 'deleted source without history must not create fake history';
  ASSERT NOT EXISTS(SELECT 1 FROM auto_campaign_details WHERE input_data_id=2);
  SELECT * INTO r FROM aka_agent_record_sms_message_status(99999,10,'đã nhận');
  ASSERT NOT r.accepted, 'missing input must fail';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(1,10,'invalid');
  ASSERT NOT r.accepted, 'invalid status must fail';

  SELECT * INTO r FROM aka_agent_record_sms_message_status(1,10,'thất bại','fixture','{"errorCode":"fixture"}');
  ASSERT r.accepted AND r.detail_status='thất bại' AND NOT r.counted AND NOT r.input_updated;
  SELECT * INTO r FROM aka_agent_record_sms_message_status(1,10,'đã nhận',NULL,'{"deliveredAt":"2026-01-02"}');
  ASSERT r.accepted AND r.detail_status='đã nhận' AND NOT r.counted AND NOT r.input_updated;
  ASSERT (SELECT data->>'providerMessageId'='fixture' AND data->>'deliveredAt'='2026-01-02' FROM auto_campaign_details WHERE input_data_id=1);
  SELECT to_jsonb(d) INTO baseline_detail FROM auto_campaign_details d WHERE input_data_id=1;
  PERFORM * FROM aka_agent_record_sms_message_status(1,10,'đã nhận');
  PERFORM * FROM aka_agent_record_sms_message_status(1,10,'đã gửi');
  SELECT * INTO r FROM aka_agent_record_sms_message_status(1,10,'thất bại');
  ASSERT r.accepted AND r.detail_status='đã nhận', 'delivered cannot downgrade';
  ASSERT baseline_detail=(SELECT to_jsonb(d) FROM auto_campaign_details d WHERE input_data_id=1), 'retries must not rewrite history';
  ASSERT before_campaign=(SELECT to_jsonb(c) FROM auto_campaigns c WHERE id=1), 'deleted campaign unchanged';
  ASSERT before_input=(SELECT to_jsonb(i) FROM auto_campaign_input_data i WHERE id=1), 'historical input unchanged';
  ASSERT NOT EXISTS(SELECT 1 FROM test_counts), 'late reports must not count quota';
  ASSERT NOT EXISTS(SELECT 1 FROM auto_automation_detail WHERE automation_id=1), 'deleted source must not trigger automation';
  ASSERT NOT EXISTS(SELECT 1 FROM auto_automation_enqueue_failures), 'trigger query must succeed, not swallow SQL errors';
  ASSERT NOT EXISTS(SELECT 1 FROM aka_agent_list_sms_due_input_data(10,ARRAY[1::bigint],'viettel',30,30)), 'deleted campaign remains unfetchable';

  SELECT to_jsonb(c) INTO before_campaign FROM auto_campaigns c WHERE id=3;
  SELECT to_jsonb(i) INTO before_input FROM auto_campaign_input_data i WHERE id=4;
  SELECT * INTO r FROM aka_agent_record_sms_message_status(4,10,'đã nhận');
  ASSERT r.accepted AND NOT r.counted AND NOT r.input_updated;
  ASSERT before_campaign=(SELECT to_jsonb(c) FROM auto_campaigns c WHERE id=3);
  ASSERT before_input=(SELECT to_jsonb(i) FROM auto_campaign_input_data i WHERE id=4), 'deleted input unchanged';

  SELECT * INTO r FROM aka_agent_record_sms_message_status(3,10,'đã nhận');
  ASSERT NOT r.accepted AND r.message='Chưa có trạng thái đã gửi để cập nhật đã nhận';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(3,10,'đã gửi');
  ASSERT r.accepted AND r.counted AND r.input_updated;
  SELECT * INTO r FROM aka_agent_record_sms_message_status(3,10,'đã gửi');
  ASSERT r.accepted AND NOT r.counted;
  SELECT * INTO r FROM aka_agent_record_sms_message_status(3,10,'đã nhận');
  ASSERT r.accepted AND r.detail_status='đã nhận' AND NOT r.counted;
  ASSERT (SELECT value=1 FROM test_counts WHERE account_id=10), 'normal send counted once';
  ASSERT (SELECT count(*)=1 FROM auto_automation_detail WHERE automation_id=2), 'live automation must still enqueue';
  ASSERT NOT EXISTS(SELECT 1 FROM auto_automation_enqueue_failures);
  ASSERT (SELECT status='chờ xử lý' FROM auto_campaigns WHERE id=2), 'pending inputs prevent completion';
  SELECT * INTO r FROM aka_agent_record_sms_message_status(8,10,'thất bại','fixture');
  ASSERT r.accepted AND r.counted;
  ASSERT (SELECT status='hoàn thành' AND note IS NULL FROM auto_campaigns WHERE id=2), 'normal finalization preserved';
END;
$test$;
SELECT 'v317 SMS status smoke PASS' AS result;
ROLLBACK;
