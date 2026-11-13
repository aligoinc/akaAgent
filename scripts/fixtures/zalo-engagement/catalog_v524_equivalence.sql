-- V524 catalog equivalence: the V510 body (public.zalo_engagement_batch_v510_ref, created by
-- scripts/run-zalo-engagement-v524-smoke.cjs from the V510 migration text) and the V524 body
-- must return the same JSON page after page: same rows, order, catalogCursor and catalogDone.
-- Every row the V510 joins reject is interleaved with valid rows; tracking_until values tie
-- inside and across page boundaries; several accounts, owners and tenants share the table.
-- One transaction (now() is fixed for both bodies), rolled back. Prints one JSON line.
BEGIN;
SET LOCAL client_min_messages = warning;
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
INSERT INTO org_staff VALUES
 (7000101,7000001,true,'eq1','password'),(7000102,7000001,true,'eq2','password'),
 (7000103,7000003,true,'eq3','password'),(7000104,7000004,true,'eq4','password'),(7000105,7000005,true,'eq5','password');
INSERT INTO zalo_accounts VALUES
 (7100,'o1-a'),(7101,'o1-b-stale'),(7102,'o1-c'),(7103,'o1-d'),(7104,'o1-e'),(7105,'o1-f'),(7107,'o1-h'),
 (7108,'o1-i'),(7109,'o1-j'),(7110,'o1-k'),(7111,'o1-l'),(7300,'o3-a'),(7400,'o4-a'),(7500,'o5-a');
-- Owner 1 = staff 7000101 / organization 7000001. Comment = what the V510 joins decide.
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id,is_delete,is_zalo_show_web) VALUES
 (7100,7000101,7000001,7100,false,false),  -- valid, UID from zalo_accounts
 (7101,7000101,7000001,7101,false,false),  -- valid, active Chat binding overrides the stale zalo UID
 (7102,7000101,7000001,7102,false,false),  -- valid, inactive binding ignored
 (7103,7000101,7000001,7103,true,false),   -- deleted
 (7104,7000101,7000001,7104,false,true),   -- Zalo web account
 (7105,7000101,7000001,7105,false,NULL),   -- NULL is_zalo_show_web counts as false: valid
 (7106,7000101,7000001,NULL,false,false),  -- no UID at all: never matches
 (7107,7000102,7000001,7107,false,false),  -- another staff of the same organization
 (7108,7000101,7000001,7108,NULL,false),   -- NULL is_delete: rejected
 (7109,7000101,7000001,7109,false,false),  -- active binding without a Chat profile: zalo UID
 (7110,7000101,7000001,7110,false,false),  -- active binding, profile zalo_id NULL: zalo UID
 (7111,7000101,7000002,7111,false,false),  -- same staff id, another organization
 (7300,7000103,7000003,7300,false,false),(7400,7000104,7000004,7400,true,false),(7500,7000105,7000005,7500,false,false);
INSERT INTO chat_zalo_account VALUES (7101,'o1-b'),(7102,'o1-c-chat'),(7110,NULL);
INSERT INTO chat_zalo_account_organization VALUES
 (7101,7101,7000001,7101,true),(7102,7102,7000001,7102,false),(7109,7109,7000001,7999,true),(7110,7110,7000001,7110,true);
INSERT INTO auto_campaigns(id,staff_id,organization_id,is_delete) VALUES
 (7200,7000101,7000001,false),(7201,7000101,7000001,false),(7206,7000101,7000001,false),
 (7202,7000101,7000001,true),   -- deleted
 (7203,7000102,7000001,false),  -- another staff
 (7204,7000101,7000002,false),  -- another organization
 (7205,7000101,7000001,NULL),   -- NULL is_delete
 (7300,7000103,7000003,false),(7400,7000104,7000004,false),(7500,7000105,7000005,false);

CREATE TEMP TABLE eq_uid(account_id bigint PRIMARY KEY, uid text);
INSERT INTO eq_uid VALUES (7100,'o1-a'),(7101,'o1-b'),(7102,'o1-c'),(7103,'o1-d'),(7104,'o1-e'),(7105,'o1-f'),
 (7106,'o1-g'),(7107,'o1-h'),(7108,'o1-i'),(7109,'o1-j'),(7110,'o1-k'),(7111,'o1-l');
CREATE TEMP TABLE eq_result(seed int, label text, pages int, items int, boundary_ties int, expected int);

-- Owner 1 (+ owner 2 and a foreign-tenant copy of owner 1's staff id) for one seed: 40 tied
-- deadlines (some with microseconds) around now(); IDs uncorrelated with deadlines.
CREATE FUNCTION pg_temp.seed_owner1(p_seed int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE base timestamptz := date_trunc('minute',now())-interval '3 hours';
BEGIN
 DELETE FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id BETWEEN 7500000 AND 7599999;
 DELETE FROM auto_campaign_details WHERE id BETWEEN 7500000 AND 7599999;
 CREATE TEMP TABLE IF NOT EXISTS eq_gen(n int, h2 int, h3 int, h4 int, h5 int, acc bigint);
 TRUNCATE eq_gen;
 INSERT INTO eq_gen SELECT n,abs(hashtextextended(n::text,p_seed*10+2))%1000,abs(hashtextextended(n::text,p_seed*10+3))%1000,
   abs(hashtextextended(n::text,p_seed*10+4))%1000,abs(hashtextextended(n::text,p_seed*10+5))%1000,
   CASE WHEN n%37=0 THEN 7107 ELSE  -- owner 2's own account
     (ARRAY[7100,7100,7100,7101,7101,7101,7102,7102,7105,7109,7110,7100,7101,7103,7104,7106,7107,7108,7111,7100])[1+abs(hashtextextended(n::text,p_seed*10+6))%20] END
 FROM generate_series(1,3200) n;
 INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data,is_delete)
 SELECT 7500000+n,
   CASE WHEN n%37=0 THEN 7203 WHEN h3%97=0 THEN NULL ELSE (ARRAY[7200,7201,7206,7200,7201,7206,7200,7201,7206,7200,7201,7206,7200,7201,7202,7203,7204,7205,7200,7201])[1+h3%20] END,
   acc,'zalo_message_friend','Gửi','thành công','{}',CASE WHEN h4%23=0 THEN true WHEN h4%29=0 THEN NULL ELSE false END
 FROM eq_gen;
 INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
 SELECT 7500000+n,
   CASE WHEN n%41=0 THEN 7000002 ELSE 7000001 END,               -- foreign tenant, same staff id
   CASE WHEN n%37=0 THEN 7000102 ELSE 7000101 END,               -- owner 2 rows in the same organization
   acc,
   CASE WHEN h2%20=0 THEN CASE acc WHEN 7101 THEN 'o1-b-stale' WHEN 7102 THEN 'o1-c-chat' ELSE 'stale-'||acc END
     ELSE (SELECT uid FROM eq_uid WHERE account_id=acc) END,
   't'||n,'message',base-interval '7 days',
   base+(h5%40)*interval '17 minutes'+CASE WHEN h5%7=0 THEN interval '123456 microseconds' ELSE interval '0' END,
   ARRAY['m'||n]
 FROM eq_gen;
END $$;

-- Owner 3: exactly 1,000 valid rows (every 11th rejected) then 200 rejected rows.
-- Owner 4: 700 rows of a deleted account only. Owner 5: exactly 500 valid among 550.
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data,is_delete)
SELECT 7600000+n,o,o,'zalo_message_friend','Gửi','thành công','{}',
  (n<=1300 AND (n%11=0 OR n>1100)) OR (n>2000 AND n%11=0)
FROM generate_series(1,2550) n, LATERAL (SELECT CASE WHEN n<=1300 THEN 7300 WHEN n<=2000 THEN 7400 ELSE 7500 END o) x;
INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
SELECT 7600000+n,7000000+(o-7000)/100,7000100+(o-7000)/100,o,'o'||((o-7000)/100)||'-a','t'||n,'message',now()-interval '1 day',
  now()+(n/7)*interval '1 second',ARRAY['m']
FROM generate_series(1,2550) n, LATERAL (SELECT CASE WHEN n<=1300 THEN 7300 WHEN n<=2000 THEN 7400 ELSE 7500 END o) x;

CREATE FUNCTION pg_temp.catalog_page(p_ref boolean, p_staff bigint, p_org bigint, p_cursor jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r text := (SELECT updated_at::text FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled');
 u text := (SELECT username FROM org_staff WHERE id=p_staff); items jsonb := jsonb_build_array(jsonb_build_object('catalog',p_cursor));
BEGIN
 IF p_ref THEN RETURN public.zalo_engagement_batch_v510_ref(p_staff,p_org,r,items,'read',u,'password'); END IF;
 RETURN public.aka_agent_campaign_engagement_batch(p_staff,p_org,r,items,'read',u,'password');
END $$;

-- Each body follows its own cursor; every page must be the same JSON.
CREATE FUNCTION pg_temp.compare_walk(p_seed int, p_label text, p_staff bigint, p_org bigint, p_start jsonb, p_expected int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c_old jsonb := p_start; c_new jsonb := p_start; a jsonb; b jsonb; pages int := 0; items int := 0; ties int := 0; last_until text;
BEGIN
 LOOP
   a := pg_temp.catalog_page(true,p_staff,p_org,c_old);
   b := pg_temp.catalog_page(false,p_staff,p_org,c_new);
   pages := pages+1;
   IF a IS DISTINCT FROM b THEN
     RAISE EXCEPTION 'catalog mismatch seed % % page %: v510 % / v524 %',p_seed,p_label,pages,left(a::text,400),left(b::text,400);
   END IF;
   IF NOT (a->>'enabled')::boolean THEN RAISE EXCEPTION 'catalog disabled in %',p_label; END IF;
   IF last_until IS NOT NULL AND jsonb_array_length(a->'items')>0 AND a->'items'->0->>'tracking_until'=last_until THEN ties := ties+1; END IF;
   items := items+jsonb_array_length(a->'items');
   IF jsonb_array_length(a->'items')>0 THEN last_until := a->'items'->-1->>'tracking_until'; END IF;
   EXIT WHEN (a->>'catalogDone')::boolean;
   IF pages>=100 THEN RAISE EXCEPTION 'catalog walk did not finish: %',p_label; END IF;
   c_old := a->'catalogCursor'; c_new := b->'catalogCursor';
 END LOOP;
 IF p_expected IS NOT NULL AND items<>p_expected THEN RAISE EXCEPTION 'catalog % returned % rows, expected %',p_label,items,p_expected; END IF;
 INSERT INTO eq_result VALUES (p_seed,p_label,pages,items,ties,p_expected);
END $$;

-- Independent oracle for owner 1: rows the V510 joins keep, written as plain rules.
CREATE FUNCTION pg_temp.owner1_expected(p_from timestamptz) RETURNS int LANGUAGE sql AS $$
 SELECT count(*)::int FROM auto_campaign_detail_zalo_engagement e
 WHERE e.organization_id=7000001 AND e.staff_id=7000101 AND e.tracking_until>=p_from
   AND EXISTS (SELECT 1 FROM auto_campaign_details d JOIN auto_campaigns c ON c.id=d.campaign_id
     WHERE d.id=e.campaign_detail_id AND d.is_delete IS FALSE AND c.staff_id=7000101 AND c.organization_id=7000001 AND c.is_delete IS FALSE)
   AND e.account_id IN (7100,7101,7102,7105,7109,7110)
   AND e.account_zalo_uid=(SELECT uid FROM eq_uid WHERE account_id=e.account_id)
$$;

DO $eq$
DECLARE seed int; base timestamptz := date_trunc('minute',now())-interval '3 hours'; mid record; probe record; a jsonb; b jsonb; probes int := 0;
BEGIN
 FOR seed IN 1..3 LOOP
   PERFORM pg_temp.seed_owner1(seed);
   ANALYZE auto_campaign_detail_zalo_engagement;
   -- The data must exercise every rejection between valid rows.
   IF EXISTS (SELECT 1 FROM (VALUES ('detail deleted'),('detail NULL delete'),('detail without campaign'),('campaign deleted'),('campaign other staff'),
       ('campaign other org'),('campaign NULL delete'),('account deleted'),('account web'),('account no uid'),('account other staff'),
       ('account NULL delete'),('account other org'),('stale uid')) want(reason)
     WHERE NOT EXISTS (SELECT 1 FROM auto_campaign_detail_zalo_engagement e JOIN auto_campaign_details d ON d.id=e.campaign_detail_id
       LEFT JOIN auto_campaigns c ON c.id=d.campaign_id
       WHERE e.organization_id=7000001 AND e.staff_id=7000101 AND e.tracking_until>=now() AND want.reason=CASE
         WHEN d.is_delete THEN 'detail deleted' WHEN d.is_delete IS NULL THEN 'detail NULL delete' WHEN d.campaign_id IS NULL THEN 'detail without campaign'
         WHEN c.is_delete THEN 'campaign deleted' WHEN c.staff_id<>7000101 THEN 'campaign other staff' WHEN c.organization_id<>7000001 THEN 'campaign other org'
         WHEN c.is_delete IS NULL THEN 'campaign NULL delete' WHEN e.account_id=7103 THEN 'account deleted' WHEN e.account_id=7104 THEN 'account web'
         WHEN e.account_id=7106 THEN 'account no uid' WHEN e.account_id=7107 THEN 'account other staff' WHEN e.account_id=7108 THEN 'account NULL delete'
         WHEN e.account_id=7111 THEN 'account other org' WHEN e.account_zalo_uid<>(SELECT uid FROM eq_uid WHERE account_id=e.account_id) THEN 'stale uid' END)) THEN
     RAISE EXCEPTION 'seed % misses a rejection case',seed;
   END IF;
   PERFORM pg_temp.compare_walk(seed,'owner1 {}',7000101,7000001,'{}',pg_temp.owner1_expected(now()));
   PERFORM pg_temp.compare_walk(seed,'owner1 from base-1d',7000101,7000001,jsonb_build_object('from',base-interval '1 day'),pg_temp.owner1_expected(base-interval '1 day'));
   PERFORM pg_temp.compare_walk(seed,'owner1 from null',7000101,7000001,'{"from":null,"until":null,"id":null}',pg_temp.owner1_expected(now()));
   PERFORM pg_temp.compare_walk(seed,'owner1 until without from',7000101,7000001,jsonb_build_object('until',base+interval '5 hours'),NULL);
   PERFORM pg_temp.compare_walk(seed,'owner1 late from',7000101,7000001,jsonb_build_object('from',base+interval '10 hours'),pg_temp.owner1_expected(base+interval '10 hours'));
   PERFORM pg_temp.compare_walk(seed,'owner2 {}',7000102,7000001,'{}',NULL);
   -- Cursors in the middle of tie groups, on rejected rows, on IDs/deadlines that do not exist,
   -- in both serializations (to_jsonb ISO and ::text).
   FOR probe IN
     SELECT e.tracking_until t,e.campaign_detail_id i FROM auto_campaign_detail_zalo_engagement e
     WHERE e.campaign_detail_id BETWEEN 7500000 AND 7599999 AND abs(hashtextextended(e.campaign_detail_id::text,seed))%40=0
   LOOP
     FOR mid IN SELECT * FROM (VALUES
       (jsonb_build_object('from',base,'until',probe.t,'id',probe.i)),
       (jsonb_build_object('from',(base-interval '1 day')::text,'until',probe.t::text,'id',(probe.i-1)::text)),
       (jsonb_build_object('from',base,'until',probe.t+interval '1 microsecond','id',0)),
       (jsonb_build_object('until',probe.t,'id',probe.i+1))) v(c)
     LOOP
       a := pg_temp.catalog_page(true,7000101,7000001,mid.c); b := pg_temp.catalog_page(false,7000101,7000001,mid.c);
       IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'catalog probe mismatch seed % cursor %',seed,mid.c; END IF;
       probes := probes+1;
     END LOOP;
   END LOOP;
 END LOOP;
 PERFORM pg_temp.compare_walk(0,'owner3 exactly 1000 valid then rejected',7000103,7000003,'{}',1000);
 PERFORM pg_temp.compare_walk(0,'owner4 only rejected rows',7000104,7000004,'{}',0);
 PERFORM pg_temp.compare_walk(0,'owner5 exactly 500 valid',7000105,7000005,'{}',500);
 IF (SELECT pages FROM eq_result WHERE label LIKE 'owner3%')<>3 OR (SELECT pages FROM eq_result WHERE label LIKE 'owner4%')<>1
   OR (SELECT pages FROM eq_result WHERE label LIKE 'owner5%')<>2 THEN
   RAISE EXCEPTION 'page-boundary owners did not produce the expected empty last pages';
 END IF;
 -- Page boundaries must fall inside tie groups somewhere, or the tie-break is untested.
 IF (SELECT sum(boundary_ties) FROM eq_result WHERE label LIKE 'owner1%')=0 THEN RAISE EXCEPTION 'no tie across a page boundary'; END IF;
 INSERT INTO eq_result VALUES (0,'single-page probes',probes,0,0,NULL);
END
$eq$;
SELECT json_build_object('walks',(SELECT json_agg(json_build_object('seed',seed,'label',label,'pages',pages,'items',items,'boundaryTies',boundary_ties) ORDER BY seed,label) FROM eq_result)) AS equivalence;
ROLLBACK;
