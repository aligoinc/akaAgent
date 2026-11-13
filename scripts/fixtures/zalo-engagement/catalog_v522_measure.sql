-- V522 catalog measurement on catalog_v522_scale.sql (owner s=0: staff 2000000, organization
-- 1000000). The runner prepends PREPARE q510/q522(staff,org,from,until,id) = the catalog SELECT
-- of each migration with the PL/pgSQL variables as parameters, and creates
-- public.zalo_engagement_batch_v510_ref (the V510 body). One transaction, rolled back.
-- 1. Full sweep through each function body: response per page (must match), rows read per
--    table (pg_stat_xact_user_tables) and time; PL/pgSQL may switch to a generic plan after 5 calls.
-- 2. For every page cursor of that sweep: EXPLAIN (ANALYZE, BUFFERS) EXECUTE q510/q522 with
--    plan_cache_mode force_custom_plan and force_generic_plan.
-- Prints one JSON line.
BEGIN;
SET LOCAL client_min_messages = warning;
SET LOCAL stats_fetch_consistency = 'none';
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
CREATE TEMP TABLE bench_call(body text, page int, cursor jsonb, items int, done boolean, ms numeric,
  watch_rows bigint, detail_rows bigint, campaign_rows bigint, account_rows bigint, response_md5 text);
CREATE TEMP TABLE bench_plan(body text, mode text, page int, buffers bigint, ms numeric, watch_rows bigint, sorted boolean, watch_index text);
CREATE FUNCTION pg_temp.reads() RETURNS bigint[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT COALESCE((SELECT seq_tup_read+COALESCE(idx_tup_fetch,0) FROM pg_stat_xact_user_tables WHERE relid=t::regclass),0)
    FROM unnest(ARRAY['public.auto_campaign_detail_zalo_engagement','public.auto_campaign_details','public.auto_campaigns','public.auto_accounts']) WITH ORDINALITY u(t,n) ORDER BY n) $$;
CREATE FUNCTION pg_temp.sweep(p_body text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text := (SELECT updated_at::text FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled');
 cur jsonb := '{}'; res jsonb; b bigint[]; a bigint[]; t timestamptz; n int := 0;
BEGIN
 LOOP
   n := n+1; b := pg_temp.reads(); t := clock_timestamp();
   IF p_body='v510' THEN
     res := public.zalo_engagement_batch_v510_ref(2000000,1000000,r,jsonb_build_array(jsonb_build_object('catalog',cur)),'read','bench0','password');
   ELSE
     res := public.aka_agent_campaign_engagement_batch(2000000,1000000,r,jsonb_build_array(jsonb_build_object('catalog',cur)),'read','bench0','password');
   END IF;
   a := pg_temp.reads();
   INSERT INTO bench_call VALUES (p_body,n,cur,jsonb_array_length(res->'items'),(res->>'catalogDone')::boolean,
     round(extract(epoch FROM clock_timestamp()-t)*1000,2),a[1]-b[1],a[2]-b[2],a[3]-b[3],a[4]-b[4],md5(res::text));
   EXIT WHEN (res->>'catalogDone')::boolean OR n>=500;
   cur := res->'catalogCursor';
 END LOOP;
END $$;
SELECT pg_temp.sweep('v510');
SELECT pg_temp.sweep('v522');

DO $explain$
DECLARE c record; q text; mode text; plan jsonb; w jsonb;
BEGIN
 IF (SELECT count(*) FROM bench_call WHERE body='v510')<>(SELECT count(*) FROM bench_call WHERE body='v522')
   OR EXISTS (SELECT 1 FROM bench_call x JOIN bench_call y ON y.page=x.page AND y.body='v522'
     WHERE x.body='v510' AND (x.response_md5<>y.response_md5 OR x.cursor<>y.cursor)) THEN
   RAISE EXCEPTION 'bench sweep: V510 and V522 pages differ';
 END IF;
 FOR c IN SELECT page,cursor FROM bench_call WHERE body='v522' ORDER BY page LOOP
   FOREACH q IN ARRAY ARRAY['q510','q522'] LOOP
     FOREACH mode IN ARRAY ARRAY['force_custom_plan','force_generic_plan'] LOOP
       PERFORM set_config('plan_cache_mode',mode,true);
       -- Same defaults as the function: from=now(), until=from, id=0.
       EXECUTE format('EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) EXECUTE %s(2000000,1000000,%L::timestamptz,%L::timestamptz,%L::bigint)',q,
         COALESCE(c.cursor->>'from',now()::text),COALESCE(c.cursor->>'until',c.cursor->>'from',now()::text),COALESCE(c.cursor->>'id','0')) INTO plan;
       SELECT jsonb_agg(x) INTO w FROM jsonb_path_query(plan,'strict $.**?(@."Relation Name"=="auto_campaign_detail_zalo_engagement")') x;
       INSERT INTO bench_plan VALUES (q,mode,c.page,
         (plan->0->'Plan'->>'Shared Hit Blocks')::bigint+(plan->0->'Plan'->>'Shared Read Blocks')::bigint,
         round((plan->0->>'Execution Time')::numeric,2),
         (SELECT sum((x->>'Actual Rows')::bigint*(x->>'Actual Loops')::bigint) FROM jsonb_array_elements(w) x),
         jsonb_path_exists(plan,'strict $.**?(@."Node Type"=="Sort")'),
         (SELECT string_agg(DISTINCT x->>'Index Name',',') FROM jsonb_array_elements(w) x));
     END LOOP;
   END LOOP;
 END LOOP;
 PERFORM set_config('plan_cache_mode','auto',true);
END
$explain$;

SELECT json_build_object(
 'owner',json_build_object('watches',(SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE staff_id=2000000),
   'live',(SELECT count(*) FROM auto_campaign_detail_zalo_engagement WHERE staff_id=2000000 AND tracking_until>=now()),
   'returned',(SELECT sum(items) FROM bench_call WHERE body='v522'),'pages',(SELECT count(*) FROM bench_call WHERE body='v522')),
 'table',json_build_object('watches',(SELECT count(*) FROM auto_campaign_detail_zalo_engagement),'details',(SELECT count(*) FROM auto_campaign_details)),
 'sweep',(SELECT json_object_agg(body,s) FROM (SELECT body,json_build_object('ms',sum(ms),'firstPageMs',min(ms) FILTER (WHERE page=1),
   'watchRows',sum(watch_rows),'detailRows',sum(detail_rows),'campaignRows',sum(campaign_rows),'accountRows',sum(account_rows),
   'firstPage',json_build_object('watchRows',min(watch_rows) FILTER (WHERE page=1),'detailRows',min(detail_rows) FILTER (WHERE page=1)),
   'maxPageWatchRows',max(watch_rows),'maxPageDetailRows',max(detail_rows)) s FROM bench_call GROUP BY body) t),
 'explain',(SELECT json_object_agg(body||' '||mode,s) FROM (SELECT body,mode,json_build_object('buffers',sum(buffers),'firstPageBuffers',min(buffers) FILTER (WHERE page=1),
   'maxPageBuffers',max(buffers),'ms',sum(ms),'firstPageMs',min(ms) FILTER (WHERE page=1),'watchRows',sum(watch_rows),
   'maxPageWatchRows',max(watch_rows),'sortedPages',count(*) FILTER (WHERE sorted),'watchIndexes',string_agg(DISTINCT watch_index,',')) s
   FROM bench_plan GROUP BY body,mode) t),
 'pages',(SELECT json_agg(json_build_object('page',p.page,'items',p.items,'v510Buffers',
   (SELECT buffers FROM bench_plan WHERE body='q510' AND mode='force_generic_plan' AND page=p.page),'v522Buffers',
   (SELECT buffers FROM bench_plan WHERE body='q522' AND mode='force_generic_plan' AND page=p.page)) ORDER BY p.page)
   FROM bench_call p WHERE p.body='v522' AND (p.page IN (1,2) OR p.page%10=0 OR p.done))) AS measure;
ROLLBACK;
