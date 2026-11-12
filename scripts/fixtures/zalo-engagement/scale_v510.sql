-- V510 scale check: how many rows does one engagement RPC call read for a staff with a
-- long send history? Production (12/11/2026): register read ~68k results of one staff
-- (19.5 s) because (staff_id, organization_id) are correlated and estimated ~1 row.
-- Everything runs in one transaction and is rolled back. Prints one JSON line.
BEGIN;
SET LOCAL client_min_messages = warning;
SET LOCAL stats_fetch_consistency = 'none';
-- 2,000 staffs (one organization each) so per-staff estimates are tiny, like production.
INSERT INTO org_staff SELECT 1000000+s,1000000+s,true,'scale'||s,'password' FROM generate_series(0,1999) s;
INSERT INTO zalo_accounts SELECT 1000000+s,'uid-'||s FROM generate_series(0,1999) s;
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id) SELECT 1000000+s,1000000+s,1000000+s,1000000+s FROM generate_series(0,1999) s;
-- Staff 1000000 has 40 campaigns; every other staff has 15.
INSERT INTO auto_campaigns SELECT 1000000+c,1000000,1000000,false FROM generate_series(0,39) c;
INSERT INTO auto_campaigns SELECT 2000000+s*15+c,1000000+s,1000000+s,false FROM generate_series(1,1999) s, generate_series(0,14) c;
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
CREATE TEMP TABLE scale_revision AS SELECT updated_at::text r FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled';
-- History: staff 1000000 has 70,000 successful message results (registered under an
-- older revision), other staffs 10 per campaign.
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
SELECT 10000000+n,1000000+(n%40),1000000,'zalo_message_friend','Gửi','thành công',
  jsonb_build_object('zaloEngagementSource',jsonb_build_object('version',1,'revision','2026-01-01 00:00:00+00',
    'accountZaloUid','uid-0','targetZaloUid','t'||n,'actionType','message','sentAt','2026-01-01T00:00:00Z','messageIds',jsonb_build_array('m'||n)))
FROM generate_series(1,70000) n;
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
SELECT 20000000+n,2000000+15+(n%(1999*15)),1000000+1+((n%(1999*15))/15),'zalo_message_friend','Gửi','thành công','{}'
FROM generate_series(1,299850) n;
-- Watches: staff 1000000 has 50,000 rows still inside the tracking window (a busy
-- Server tenant sends >1,000/hour), every other staff has one, so a generic plan
-- estimates "rows of one staff" from 2,000 distinct owners, like production.
INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
SELECT 10000000+n,1000000,1000000,1000000,'uid-0','t'||n,'message',now()-interval '1 hour',now()+interval '47 hours',ARRAY['m'||n]
FROM generate_series(1,50000) n;
INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
SELECT 20000000+s*15,1000000+s,1000000+s,1000000+s,'uid-'||s,'o'||s,'message',now()-interval '1 hour',now()+interval '47 hours',ARRAY['o'||s]
FROM generate_series(1,1999) s;
-- Three fresh sends to register now, plus one pending recovery source.
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data)
SELECT 30000000+n,1000000+n,1000000,'zalo_message_friend','Gửi','thành công',
  jsonb_build_object('zaloEngagementPending',true,'zaloEngagementSource',jsonb_build_object('version',1,'revision',r,
    'accountZaloUid','uid-0','targetZaloUid','fresh'||n,'actionType','message','sentAt',now(),'messageIds',jsonb_build_array('fm'||n)))
FROM generate_series(1,3) n, scale_revision;
ANALYZE org_staff; ANALYZE zalo_accounts; ANALYZE auto_accounts; ANALYZE auto_campaigns;
ANALYZE auto_campaign_details; ANALYZE auto_campaign_detail_zalo_engagement;

CREATE TEMP TABLE scale_result(step text, call int, details_rows bigint, watch_rows bigint, campaign_rows bigint);
CREATE FUNCTION pg_temp.scale_reads() RETURNS TABLE(d bigint, w bigint, c bigint) LANGUAGE sql AS $$
  SELECT (SELECT coalesce(seq_tup_read,0)+coalesce(idx_tup_fetch,0) FROM pg_stat_xact_user_tables WHERE relid='public.auto_campaign_details'::regclass),
         (SELECT coalesce(seq_tup_read,0)+coalesce(idx_tup_fetch,0) FROM pg_stat_xact_user_tables WHERE relid='public.auto_campaign_detail_zalo_engagement'::regclass),
         (SELECT coalesce(seq_tup_read,0)+coalesce(idx_tup_fetch,0) FROM pg_stat_xact_user_tables WHERE relid='public.auto_campaigns'::regclass) $$;
DO $scale$
DECLARE r text := (SELECT scale_revision.r FROM scale_revision); b record; a record; i int;
 register_items jsonb := '[{"detailId":"30000001"},{"detailId":"30000002"},{"detailId":"30000003"}]';
 event_items jsonb := '[{"accountId":"1000000","accountZaloUid":"uid-0","targetZaloUid":"fresh1","kind":"message","occurredAt":"__NOW__","messageIds":[]}]';
BEGIN
 event_items := replace(event_items::text,'__NOW__',to_char((now()+interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))::jsonb;
 -- 7 calls each: plpgsql switches to a generic plan after five custom plans.
 FOR i IN 1..7 LOOP
   SELECT * INTO b FROM pg_temp.scale_reads();
   PERFORM aka_agent_register_campaign_engagement(1000000,1000000,r,register_items,'scale0','password');
   SELECT * INTO a FROM pg_temp.scale_reads();
   INSERT INTO scale_result VALUES('register',i,a.d-b.d,a.w-b.w,a.c-b.c);
 END LOOP;
 FOR i IN 1..7 LOOP
   SELECT * INTO b FROM pg_temp.scale_reads();
   PERFORM aka_agent_record_campaign_engagement(1000000,1000000,r,event_items,'scale0','password');
   SELECT * INTO a FROM pg_temp.scale_reads();
   INSERT INTO scale_result VALUES('events',i,a.d-b.d,a.w-b.w,a.c-b.c);
 END LOOP;
 UPDATE auto_campaign_details SET data=data||'{"zaloEngagementPending":true}' WHERE id=30000001;
 FOR i IN 1..7 LOOP
   SELECT * INTO b FROM pg_temp.scale_reads();
   PERFORM aka_agent_read_campaign_engagement(1000000,1000000,r,'[]','scale0','password');
   SELECT * INTO a FROM pg_temp.scale_reads();
   INSERT INTO scale_result VALUES('recovery',i,a.d-b.d,a.w-b.w,a.c-b.c);
 END LOOP;
 IF (SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id BETWEEN 30000001 AND 30000003)<>3
   OR (SELECT responded_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=30000001) IS NULL THEN
   RAISE EXCEPTION 'scale: registration or event mark missing';
 END IF;
END;
$scale$;
SELECT json_build_object('function_md5',(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'::regprocedure),
  'calls',(SELECT json_agg(json_build_object('step',step,'call',call,'details',details_rows,'watches',watch_rows,'campaigns',campaign_rows) ORDER BY step,call) FROM scale_result)) AS scale;
ROLLBACK;
