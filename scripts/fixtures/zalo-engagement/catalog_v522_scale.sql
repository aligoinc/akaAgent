-- V522 catalog scale data (committed into a dedicated database by
-- scripts/run-zalo-engagement-v522-smoke.cjs, then VACUUM ANALYZE, like production after
-- autovacuum): 600 owners (staff 2000000+s, organization 1000000+s), ~174k watches like
-- akachat on 13/11/2026 (166k–171k). Owner s=0 sends ~22% of all Zalo results: ~38k watches,
-- ~33.7k still inside the window, ~30k of them valid; the rest are rejected the way V510
-- rejects them (deleted account, deleted detail, deleted campaign, old UID). Details are
-- interleaved in send order with the other owners' rows and as many non-engagement results.
SET client_min_messages = warning;
INSERT INTO org_staff SELECT 2000000+s,1000000+s,true,'bench'||s,'password' FROM generate_series(0,599) s;
-- Accounts: owner 0 has A (zalo uid), B (Chat binding overrides a stale zalo uid), C (deleted).
INSERT INTO zalo_accounts VALUES (3000000,'big-a'),(3000001,'big-b-stale'),(3000002,'big-c');
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id,is_delete) VALUES
 (3000000,2000000,1000000,3000000,false),(3000001,2000000,1000000,3000001,false),(3000002,2000000,1000000,3000002,true);
INSERT INTO chat_zalo_account VALUES (3000001,'big-b');
INSERT INTO chat_zalo_account_organization VALUES (3000001,3000001,1000000,3000001,true);
INSERT INTO zalo_accounts SELECT 3000000+10*s+k,'uid-'||s||'-'||k FROM generate_series(1,599) s, generate_series(0,2) k;
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id) SELECT 3000000+10*s+k,2000000+s,1000000+s,3000000+10*s+k FROM generate_series(1,599) s, generate_series(0,2) k;
-- Campaigns: owner 0 has 20 (the last one deleted); others 3 each.
INSERT INTO auto_campaigns SELECT 4000000+c,2000000,1000000,c=19 FROM generate_series(0,19) c;
INSERT INTO auto_campaigns SELECT 4000000+100*s+c,2000000+s,1000000+s,false FROM generate_series(1,599) s, generate_series(0,2) c;
CREATE TEMP TABLE bench_send AS
SELECT n, (n%2=0) AS watched,
  CASE WHEN n%2=0 AND abs(hashtextextended(n::text,7))%1000<222 THEN 0 ELSE 1+abs(hashtextextended(n::text,11))%599 END AS s,
  abs(hashtextextended(n::text,13))%1000 AS h,
  now()-interval '1 day'+(n/348000.0)*interval '8 days' AS until
FROM generate_series(1,348000) n;
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,log,data,is_delete)
SELECT 10000000+n,
  CASE WHEN s=0 THEN 4000000+(h%20) ELSE 4000000+100*s+(h%3) END,
  CASE WHEN s=0 THEN 3000000+CASE WHEN h<30 THEN 2 WHEN h<350 THEN 1 ELSE 0 END ELSE 3000000+10*s+(h%3) END,
  'zalo_message_stranger','Nhắn tin người lạ',CASE WHEN watched THEN 'thành công' ELSE 'thất bại' END,
  repeat('log ',30),
  jsonb_build_object('zaloEngagementSource',jsonb_build_object('version',1,'revision','2026-11-12 11:02:06.56172+00','accountZaloUid','x','targetZaloUid','t'||n,
    'actionType','message','sentAt',until-interval '168 hours','messageIds',jsonb_build_array('m'||n,'m2'||n)),'note',repeat('x',200)),
  s=0 AND h%100=7
FROM bench_send;
INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
SELECT 10000000+n,1000000+s,2000000+s,
  CASE WHEN s=0 THEN 3000000+CASE WHEN h<30 THEN 2 WHEN h<350 THEN 1 ELSE 0 END ELSE 3000000+10*s+(h%3) END,
  CASE WHEN s=0 THEN CASE WHEN h<30 THEN 'big-c' WHEN h<350 THEN 'big-b' WHEN h%50=3 THEN 'big-a-old' ELSE 'big-a' END ELSE 'uid-'||s||'-'||(h%3) END,
  't'||n,'message',until-interval '168 hours',until,ARRAY['m'||n,'m2'||n]
FROM bench_send WHERE watched;
DROP TABLE bench_send;
