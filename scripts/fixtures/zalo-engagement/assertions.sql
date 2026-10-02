BEGIN;
INSERT INTO org_staff VALUES(1,1,true,'owner','password'),(2,2,true,'other','password');
INSERT INTO zalo_accounts VALUES(1,'sender'),(2,'other');
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id) VALUES(1,1,1,1),(2,2,2,2);
INSERT INTO auto_campaigns VALUES(1,1,1),(2,2,2);
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
CREATE TEMP TABLE test_revision AS SELECT updated_at::text r FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled';
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data) SELECT i,1,1,CASE WHEN i=3 THEN 'zalo_add_friend' ELSE 'zalo_message_friend' END,'Gửi','thành công',jsonb_build_object('zaloEngagementSource',jsonb_build_object('version',1,'revision',r,'accountZaloUid','sender','targetZaloUid','recipient','actionType',CASE WHEN i=3 THEN 'friend_request' ELSE 'message' END,'sentAt','2026-01-01T00:00:00Z','messageIds',jsonb_build_array('m'||i))) FROM test_revision CROSS JOIN generate_series(1,3) i;
GRANT SELECT ON test_revision TO anon,service_role;
SET LOCAL ROLE anon;
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"detailId":"1"},{"detailId":"2"},{"detailId":"3"}]','owner','password');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE tracking_until='2026-01-03T00:00:00Z')<>3 THEN RAISE EXCEPTION 'default window'; END IF;
END $$;
UPDATE auto_system_settings SET value='72' WHERE key='zalo.campaign_engagement.tracking_window_hours';
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"detailId":"1"}]','owner','password');
SELECT aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"message","occurredAt":"2026-01-02T00:00:00Z","messageIds":[]},{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"reaction","occurredAt":"2026-01-02T00:00:00Z","messageIds":["m2"]},{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"friend","occurredAt":"2026-01-02T00:00:00Z","messageIds":[]}]','owner','password');
DO $$ BEGIN
 IF (SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE responded_at IS NOT NULL)<>2 OR (SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE reacted_at IS NOT NULL)<>1 OR (SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE friended_at IS NOT NULL)<>1 THEN RAISE EXCEPTION 'event fanout/identity'; END IF;
 IF (SELECT tracking_until FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=1)<>'2026-01-03T00:00:00Z' THEN RAISE EXCEPTION 'retry extended deadline'; END IF;
 IF (aka_agent_list_campaign_details_page_v2(1,1,1,NULL,NULL,NULL,NULL,0,1,'created_desc','owner','password','responded')->>'total')::int<>2 THEN RAISE EXCEPTION 'filter before page'; END IF;
 IF (aka_agent_list_campaign_details_page_v2(1,1,1,NULL,NULL,NULL,NULL,0,1,'created_desc','owner','password','none')->>'total')::int<>0 THEN RAISE EXCEPTION 'none filter'; END IF;
END $$;

-- New registrations snapshot 72h, then 24h; retries never resize earlier rows.
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
 SELECT 4,campaign_id,account_id,action_code,action_name,status,data FROM auto_campaign_details WHERE id=1;
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"detailId":"4"}]','owner','password');
UPDATE auto_system_settings SET value='24' WHERE key='zalo.campaign_engagement.tracking_window_hours';
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
 SELECT 5,campaign_id,account_id,action_code,action_name,status,data FROM auto_campaign_details WHERE id=1;
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"detailId":"1"},{"detailId":"4"},{"detailId":"5"}]','owner','password');
DO $$ BEGIN
 IF (SELECT tracking_until FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=4)<>'2026-01-04T00:00:00Z' OR
    (SELECT tracking_until FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=5)<>'2026-01-02T00:00:00Z' THEN RAISE EXCEPTION 'new registration deadline'; END IF;
 BEGIN PERFORM aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),'[]','other','password'); RAISE EXCEPTION 'tenant guard missing'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'automation_auth_invalid' THEN RAISE; END IF; END;
 IF (aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"accountId":"2","accountZaloUid":"other","targetZaloUid":"recipient","kind":"message","occurredAt":"2026-01-02T00:00:00Z","messageIds":[]}]','owner','password')->>'skippedAccounts')::integer<>1 THEN RAISE EXCEPTION 'account guard missing'; END IF;
END $$;
-- Chat identity without a legacy zalo_accounts FK and event projected before detail registration.
INSERT INTO chat_zalo_account VALUES(3,'chat-sender');
INSERT INTO auto_accounts(id,staff_id,organization_id) VALUES(3,1,1);
INSERT INTO chat_zalo_account_organization VALUES(3,3,1,3,true);
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
 SELECT 6,1,3,'zalo_message_friend','Gửi','thành công',jsonb_set(data,'{zaloEngagementSource,accountZaloUid}','"chat-sender"') FROM auto_campaign_details WHERE id=1;
INSERT INTO chat_zalo_runtime_event(id,organization_id,chat_zalo_account_organization_id,processed_at,engagement_state,engagement_revision,engagement_payload,engagement_occurred_at,engagement_target_uid,engagement_account_uid)
 SELECT 1,1,3,now(),'done',r,'{"staffId":"1","events":[{"kind":"message","messageIds":[]}]}','2026-01-01T00:01:00Z','recipient','chat-sender' FROM test_revision;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"detailId":"6"}]',NULL,NULL);
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN
 IF (SELECT responded_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=6) IS DISTINCT FROM '2026-01-01T00:01:00Z'::timestamptz THEN RAISE EXCEPTION 'Chat early event reconciliation'; END IF;
END $$;
-- Wrong reaction ID and event outside the saved deadline do not mark; exact deadline is valid.
SELECT aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"reaction","occurredAt":"2026-01-01T00:01:00Z","messageIds":["wrong"]},{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"message","occurredAt":"2026-01-05T00:00:00Z","messageIds":[]}]','owner','password');
DO $$ BEGIN
 IF (SELECT responded_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=5) IS NOT NULL OR
    (SELECT reacted_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=1) IS NOT NULL THEN RAISE EXCEPTION 'false mark'; END IF;
END $$;
UPDATE auto_campaign_details SET is_delete=true WHERE id=5;
SELECT aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),'[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"message","occurredAt":"2026-01-02T00:00:00Z","messageIds":[]}]','owner','password');
DO $$ BEGIN
 IF (SELECT responded_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=5) IS NOT NULL THEN RAISE EXCEPTION 'soft delete updated'; END IF;
 IF EXISTS(SELECT 1 FROM auto_campaign_details WHERE status<>'thành công' OR counts_toward_limit<>true) THEN RAISE EXCEPTION 'execution status changed'; END IF;
END $$;

-- Seen is an independent historical mark, requires an exact sent message ID.
UPDATE auto_campaigns SET staff_id=2 WHERE id=1;
DO $$ BEGIN
 IF (aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),
   '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"seen","occurredAt":"2026-01-01T02:00:00Z","messageIds":["m2"]}]','owner','password')->>'updated')::int<>0 THEN RAISE EXCEPTION 'campaign owner changed'; END IF;
 IF jsonb_array_length(aka_agent_read_campaign_engagement(1,1,(SELECT r FROM test_revision),
   '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"seen","occurredAt":"2026-01-01T02:00:00Z","messageIds":["m2"]}]','owner','password')->'items')<>0 THEN RAISE EXCEPTION 'read campaign owner changed'; END IF;
END $$;
UPDATE auto_campaigns SET staff_id=1 WHERE id=1;
SELECT aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),
 '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"seen","occurredAt":"2026-01-01T02:00:00Z","messageIds":["wrong"]}]','owner','password');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM auto_campaign_detail_zalo_engagement WHERE seen_at IS NOT NULL) THEN RAISE EXCEPTION 'wrong seen ID'; END IF; END $$;
SELECT aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),
 '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"seen","occurredAt":"2026-01-01T02:00:00Z","messageIds":["m2"]},{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient","kind":"seen","occurredAt":"2026-01-01T03:00:00Z","messageIds":["m2"]}]','owner','password');
DO $$ BEGIN
 IF (SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE seen_at IS NOT NULL)<>1 OR
    (SELECT seen_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=2) IS DISTINCT FROM '2026-01-01T02:00:00Z'::timestamptz THEN RAISE EXCEPTION 'seen exact ID/first timestamp'; END IF;
 IF (aka_agent_list_campaign_details_page_v2(1,1,1,NULL,NULL,NULL,NULL,0,1,'created_desc','owner','password','seen')->>'total')::int<>1 THEN RAISE EXCEPTION 'seen page filter'; END IF;
END $$;
UPDATE auto_system_settings SET value='false' WHERE key='zalo.campaign_engagement.enabled';
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
DO $$ BEGIN
 IF (aka_agent_record_campaign_engagement(1,1,(SELECT r FROM test_revision),'[]','owner','password')->>'enabled')::boolean THEN RAISE EXCEPTION 'old generation replay'; END IF;
END $$;
ROLLBACK;

-- Restart recovery is keyset-paged against a fixed high-water mark, not an
-- unbounded stream of newly committed campaign details.
BEGIN;
INSERT INTO org_staff VALUES(1,1,true,'owner','password'),(2,2,true,'other','password');
INSERT INTO auto_campaigns VALUES(1,1,1),(2,2,2);
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
INSERT INTO auto_campaign_details(id,campaign_id,data)
 SELECT i,1,jsonb_build_object('zaloEngagementPending',true,'zaloEngagementSource',jsonb_build_object('operationId','send-'||i))
 FROM generate_series(1,701) i;
INSERT INTO auto_campaign_details(id,campaign_id,data) VALUES(9000,2,'{"zaloEngagementPending":true,"zaloEngagementSource":{"operationId":"other-owner"}}');
DO $$ DECLARE r text; first_page jsonb; second_page jsonb; replay jsonb;
BEGIN
 SELECT updated_at::text INTO r FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled';
 first_page:=aka_agent_read_campaign_engagement(1,1,r,'[]','owner','password');
 IF jsonb_array_length(first_page->'pending')<>500 OR first_page->>'recoveryDone'<>'false'
   OR first_page#>>'{recoveryCursor,throughId}'<>'701' THEN RAISE EXCEPTION 'recovery first page bound'; END IF;
 INSERT INTO auto_campaign_details(id,campaign_id,data) VALUES(702,1,'{"zaloEngagementPending":true,"zaloEngagementSource":{}}');
 second_page:=aka_agent_read_campaign_engagement(1,1,r,jsonb_build_array(jsonb_build_object('recovery',first_page->'recoveryCursor')),'owner','password');
 IF jsonb_array_length(second_page->'pending')<>201 OR second_page->>'recoveryDone'<>'true'
   OR second_page#>>'{pending,200,detailId}'<>'701' THEN RAISE EXCEPTION 'recovery last page/new source isolation'; END IF;
 replay:=aka_agent_read_campaign_engagement(1,1,r,'[{"recovery":{"afterId":"0","throughId":"701"}}]','owner','password');
 IF replay IS DISTINCT FROM first_page THEN RAISE EXCEPTION 'recovery retry must not skip a page'; END IF;
END $$;
ROLLBACK;

-- Ambiguous commit recovery is scoped, idempotent and independent of pending markers.
BEGIN;
INSERT INTO org_staff VALUES(1,1,true,'owner','password'),(2,2,true,'other','password');
INSERT INTO zalo_accounts VALUES(1,'sender'),(2,'other');
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id) VALUES(1,1,1,1),(2,2,2,2);
INSERT INTO auto_campaigns VALUES(1,1,1),(2,2,2);
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
CREATE TEMP TABLE operation_revision AS SELECT updated_at::text r FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled';
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,status,data)
 SELECT 1,1,1,'zalo_message_friend','thành công',jsonb_build_object('zaloEngagementSource',jsonb_build_object(
   'version',1,'revision',r,'operationId','committed','accountZaloUid','sender','targetZaloUid','recipient',
   'actionType','message','sentAt',now(),'messageIds',jsonb_build_array('m'))) FROM operation_revision;
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,status,data)
 SELECT 2,2,2,action_code,status,jsonb_set(data,'{zaloEngagementSource,operationId}','"foreign"') FROM auto_campaign_details WHERE id=1;
GRANT SELECT ON operation_revision TO anon,service_role;
SET LOCAL ROLE anon;
DO $$ DECLARE r text; result jsonb; items jsonb;
BEGIN
 SELECT operation_revision.r INTO r FROM operation_revision;
 items:='[{"operation":{"operationId":"committed","campaignId":"1","accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient"}},
   {"operation":{"operationId":"missing","campaignId":"1","accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient"}},
   {"operation":{"operationId":"foreign","campaignId":"2","accountId":"2","accountZaloUid":"other","targetZaloUid":"recipient"}}]';
 result:=aka_agent_read_campaign_engagement(1,1,r,items,'owner','password');
 IF result#>>'{operations,0,status}'<>'found' OR result#>>'{operations,0,detailId}'<>'1'
   OR result#>>'{operations,1,status}'<>'missing' OR result#>>'{operations,2,status}'<>'invalid'
   OR result#>>'{operations,2,source}' IS NOT NULL THEN RAISE EXCEPTION 'operation lookup scope/result: %',result; END IF;
 IF aka_agent_read_campaign_engagement(1,1,r,items,'owner','password') IS DISTINCT FROM result THEN RAISE EXCEPTION 'operation lookup retry'; END IF;
 IF aka_agent_read_campaign_engagement(1,1,r,jsonb_set(items,'{0,operation,accountZaloUid}','"old-session"'),'owner','password')#>>'{operations,0,status}'<>'invalid' THEN RAISE EXCEPTION 'operation UID fence'; END IF;
END $$;
RESET ROLE;
UPDATE auto_campaign_details SET is_delete=true WHERE id=1;
DO $$ BEGIN
 IF aka_agent_read_campaign_engagement(1,1,(SELECT r FROM operation_revision),
   '[{"operation":{"operationId":"committed","campaignId":"1","accountId":"1","accountZaloUid":"sender","targetZaloUid":"recipient"}}]','owner','password')#>>'{operations,0,status}'<>'invalid' THEN RAISE EXCEPTION 'operation deleted detail'; END IF;
END $$;

-- Catalog is bounded, tenant/UID guarded and leaves historical deadlines intact.
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,status)
 SELECT n,1,1,'zalo_message_friend','thành công' FROM generate_series(10001,10551) n;
INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
 SELECT n,1,1,1,'sender','catalog-'||n,'message',now()-interval '1 minute',now()+interval '1 hour',ARRAY['m'] FROM generate_series(10001,10551) n;
SET LOCAL ROLE anon;
DO $$ DECLARE first jsonb; second jsonb; r text; BEGIN
 SELECT operation_revision.r INTO r FROM operation_revision;
 first:=aka_agent_read_campaign_engagement(1,1,r,'[{"catalog":{}}]','owner','password');
 IF jsonb_array_length(first->'items')<>500 OR (first->>'catalogDone')::boolean THEN RAISE EXCEPTION 'catalog first page'; END IF;
 second:=aka_agent_read_campaign_engagement(1,1,r,jsonb_build_array(jsonb_build_object('catalog',first->'catalogCursor')),'owner','password');
 IF jsonb_array_length(second->'items')<>51 OR NOT (second->>'catalogDone')::boolean THEN RAISE EXCEPTION 'catalog second page'; END IF;
 IF jsonb_array_length(aka_agent_read_campaign_engagement(2,2,r,'[{"catalog":{}}]','other','password')->'items')<>0 THEN RAISE EXCEPTION 'catalog leaked tenant'; END IF;
 BEGIN
  PERFORM aka_agent_read_campaign_engagement(1,1,r,'[{"catalog":{}}]','other','password');
  RAISE EXCEPTION 'catalog allowed wrong owner';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%automation_auth_invalid%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE zalo_accounts SET zalo_uid='new-session' WHERE id=1;
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF jsonb_array_length(aka_agent_read_campaign_engagement(1,1,(SELECT r FROM operation_revision),'[{"catalog":{}}]','owner','password')->'items')<>0 THEN RAISE EXCEPTION 'catalog leaked old UID'; END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- Real Chat role has explicit wrapper access, without internal/table privileges.
BEGIN;
SET LOCAL ROLE aka_agent_chat_api;
DO $chat_acl$
BEGIN
 IF NOT has_function_privilege(current_user,'public.aka_agent_read_campaign_engagement(bigint,bigint,text,jsonb,text,text)','EXECUTE')
 OR NOT has_function_privilege(current_user,'public.aka_agent_register_campaign_engagement(bigint,bigint,text,jsonb,text,text)','EXECUTE')
 OR NOT has_function_privilege(current_user,'public.aka_agent_record_campaign_engagement(bigint,bigint,text,jsonb,text,text)','EXECUTE')
 OR has_function_privilege(current_user,'public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)','EXECUTE')
 OR has_table_privilege(current_user,'public.auto_campaign_detail_zalo_engagement','SELECT') THEN
   RAISE EXCEPTION 'Chat runtime ACL mismatch';
 END IF;
 BEGIN
  PERFORM public.aka_agent_read_campaign_engagement(0,0,NULL,'[]','invalid','invalid');
  RAISE EXCEPTION 'credential guard bypassed';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT IN ('automation_auth_invalid','engagement_owner_invalid') THEN RAISE; END IF;
 END;
END
$chat_acl$;
ROLLBACK;
