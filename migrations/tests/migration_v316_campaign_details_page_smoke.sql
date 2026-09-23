-- Fixtures and every mutation in this smoke roll back.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
DO $smoke$
DECLARE
  v_staff bigint; v_org bigint; v_username text; v_password text;
  v_other_staff bigint; v_other_org bigint; v_other_username text; v_other_password text;
  v_base constant bigint := 8800316000000000;
  v_page jsonb; v_expected bigint[]; v_actual bigint[]; v_sort text;
  v_role text; v_search text; v_status text; v_offset integer; v_rejected boolean;
  v_rpc regprocedure := to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text)');
BEGIN
  IF v_rpc IS NULL OR md5(pg_get_functiondef(v_rpc)) <> '9652783556c25109e6250375da031fa3' THEN
    RAISE EXCEPTION 'v316: unexpected target definition';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_rpc AND
    (NOT prosecdef OR provolatile <> 's' OR pg_get_userbyid(proowner) <> 'postgres'
      OR proconfig <> ARRAY['search_path=pg_catalog, public','statement_timeout=60s']))
    OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid=v_rpc AND a.grantee=0)
  THEN RAISE EXCEPTION 'v316: invalid RPC attributes or PUBLIC grant'; END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT has_function_privilege(v_role,v_rpc,'EXECUTE') THEN RAISE EXCEPTION 'v316: missing grant %',v_role; END IF;
  END LOOP;
  SELECT id,organization_id,username,password INTO v_staff,v_org,v_username,v_password
  FROM public.org_staff WHERE is_active=true AND organization_id IS NOT NULL
    AND username IS NOT NULL AND password IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id,organization_id,username,password INTO v_other_staff,v_other_org,v_other_username,v_other_password
  FROM public.org_staff WHERE is_active=true AND organization_id <> v_org
    AND username IS NOT NULL AND password IS NOT NULL ORDER BY id LIMIT 1;
  IF v_staff IS NULL OR v_other_staff IS NULL THEN RAISE EXCEPTION 'v316: no fixture identities'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-v316-smoke',0));
  IF EXISTS (SELECT 1 FROM public.auto_accounts WHERE id BETWEEN v_base+1 AND v_base+2)
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id BETWEEN v_base+3 AND v_base+4)
    OR EXISTS (SELECT 1 FROM public.auto_campaign_details WHERE id BETWEEN v_base+11 AND v_base+17)
  THEN RAISE EXCEPTION 'v316: fixture collision'; END IF;
  INSERT INTO public.auto_accounts(id,name,flatform_type,is_zalo_show_web,is_zalo_server,login_status,status,is_active,staff_id,organization_id,is_delete)
  OVERRIDING SYSTEM VALUE VALUES
    (v_base+1,'__v316_local__','zalo',false,false,'đã đăng nhập','chờ xử lý',true,v_staff,v_org,false),
    (v_base+2,'__v316_server__','zalo',false,true,'đã đăng nhập','chờ xử lý',true,v_staff,v_org,false);
  INSERT INTO public.auto_campaigns(id,name,action_id,account_id,status,content,schedule,original_schedule,data_target_source_mode,staff_id,organization_id,is_delete)
  OVERRIDING SYSTEM VALUE VALUES
    (v_base+3,'__v316_local__','zalo_message_phone',v_base+1,'hoàn thành','',now(),now(),'direct',v_staff,v_org,false),
    (v_base+4,'__v316_server__','zalo_message_phone',v_base+2,'hoàn thành','',now(),now(),'direct',v_staff,v_org,false);
  INSERT INTO public.auto_campaign_details(id,campaign_id,account_id,action_name,status,log,post_url,data,created_at,is_delete,counts_toward_limit)
  OVERRIDING SYSTEM VALUE VALUES
    (v_base+11,v_base+3,v_base+1,'smoke search-target','lỗi','payload-11',NULL,'{"x":11}','2026-01-01Z',false,false),
    (v_base+12,v_base+3,v_base+1,'smoke','thành công','search-target payload-12',NULL,'{"x":12}','2026-01-02 00:00:00.000100Z',false,false),
    (v_base+13,v_base+3,v_base+1,'smoke','lỗi','payload-13','https://example.test/search-target','{"x":13}','2026-01-02 00:00:00.000900Z',false,false),
    (v_base+14,v_base+3,v_base+1,'smoke','thành công','payload-14',NULL,'{"x":14}','2026-01-02 00:00:00.000900Z',false,false),
    (v_base+15,v_base+3,v_base+1,'smoke','lỗi','payload-15',NULL,'{"x":15}','2026-01-03Z',false,false),
    (v_base+16,v_base+3,v_base+1,'smoke search-target','lỗi','deleted',NULL,'{}','2026-01-04Z',true,false),
    (v_base+17,v_base+4,v_base+2,'smoke server','lỗi','payload-17',NULL,'{}','2026-01-01Z',false,false);

  -- The real table cannot contain NULL order keys; preserve this invariant.
  v_rejected := false;
  BEGIN UPDATE public.auto_campaign_details SET created_at=NULL WHERE id=v_base+11;
  EXCEPTION WHEN not_null_violation THEN v_rejected := true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v316: created_at unexpectedly nullable'; END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',v_role);
    PERFORM set_config('request.jwt.claim.role',v_role,true);
    PERFORM set_config('aka_agent.zalo_runtime_target','desktop',true);
    FOREACH v_sort IN ARRAY ARRAY['created_desc','created_asc'] LOOP
      v_expected := CASE v_sort WHEN 'created_desc' THEN ARRAY[15,14,13,12,11]::bigint[] ELSE ARRAY[11,12,13,14,15]::bigint[] END;
      FOR v_offset IN 0..3 LOOP
        v_page := public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,v_offset*2,2,v_sort,v_username,v_password);
        SELECT COALESCE(array_agg((item->>'id')::bigint-v_base ORDER BY ord),'{}'::bigint[]) INTO v_actual
        FROM jsonb_array_elements(v_page->'items') WITH ORDINALITY AS p(item,ord);
        IF v_actual IS DISTINCT FROM COALESCE(v_expected[(v_offset*2+1):(v_offset*2+2)],'{}'::bigint[])
          OR (v_page->>'total')::bigint <> 5 THEN RAISE EXCEPTION 'v316: wrong page % % %',v_role,v_sort,v_offset; END IF;
      END LOOP;
    END LOOP;
    v_page := public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+4,NULL,NULL,NULL,NULL,0,100,'created_desc',v_username,v_password);
    IF (v_page->>'total')::bigint <> 1 OR (v_page#>>'{items,0,id}')::bigint <> v_base+17
      OR current_setting('aka_agent.zalo_runtime_target') <> 'desktop' THEN
      RAISE EXCEPTION 'v316: server history/routing regression'; END IF;
    -- Query text is always bound, never interpreted as SQL.
    v_page := public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,$q$' OR true --$q$,NULL,NULL,NULL,0,100,'created_desc',v_username,v_password);
    IF v_page <> '{"items":[],"total":0}'::jsonb THEN RAISE EXCEPTION 'v316: search injection'; END IF;
    v_rejected := false;
    BEGIN PERFORM public.aka_agent_list_campaign_details_page(v_other_staff,v_other_org,v_base+3,NULL,NULL,NULL,NULL,0,100,'created_desc',v_other_username,v_other_password);
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'campaign_not_found' THEN RAISE; END IF; v_rejected:=true; END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'v316: cross-tenant accepted'; END IF;
    IF v_role <> 'service_role' THEN
      v_rejected:=false;
      BEGIN PERFORM public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,0,100,'created_desc',v_username,'__wrong__');
      EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'automation_auth_invalid' THEN RAISE; END IF; v_rejected:=true; END;
      IF NOT v_rejected THEN RAISE EXCEPTION 'v316: bad password accepted'; END IF;
    END IF;
    EXECUTE 'RESET ROLE';
  END LOOP;

  PERFORM set_config('request.jwt.claim.role','anon',true);
  -- Compare complete payload, total and order with the old SQL for combinations
  -- of optional filters; this also verifies inclusive date boundaries.
  FOREACH v_sort IN ARRAY ARRAY['created_desc','created_asc'] LOOP
    FOREACH v_search IN ARRAY ARRAY[NULL,'search-target','missing','lỗi','payload_1'] LOOP
      FOREACH v_status IN ARRAY ARRAY[NULL,'lỗi','thành công'] LOOP
        v_page := public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,v_search,v_status,'2026-01-01Z','2026-01-02 00:00:00.000900Z',0,2,v_sort,v_username,v_password);
        IF v_page IS DISTINCT FROM (
          WITH filtered AS MATERIALIZED (
            SELECT d.* FROM public.auto_campaign_details d
            WHERE campaign_id=v_base+3 AND is_delete=false
              AND (v_status IS NULL OR status=v_status)
              AND created_at >= '2026-01-01Z' AND created_at <= '2026-01-02 00:00:00.000900Z'
              AND (v_search IS NULL OR action_name ILIKE '%'||v_search||'%' OR action_code ILIKE '%'||v_search||'%'
                OR status ILIKE '%'||v_search||'%' OR error_code ILIKE '%'||v_search||'%' OR log ILIKE '%'||v_search||'%' OR post_url ILIKE '%'||v_search||'%')
          ), page AS (SELECT * FROM filtered ORDER BY
            CASE WHEN v_sort='created_asc' THEN created_at END ASC NULLS LAST,
            CASE WHEN v_sort='created_desc' THEN created_at END DESC NULLS LAST,
            CASE WHEN v_sort='created_asc' THEN id END ASC, CASE WHEN v_sort='created_desc' THEN id END DESC LIMIT 2)
          SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered))
        ) THEN RAISE EXCEPTION 'v316: payload/filter mismatch % % %',v_sort,v_search,v_status; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  v_rejected:=false;
  BEGIN PERFORM public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,-1,100,'created_desc',v_username,v_password);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'invalid_campaign_details_page' THEN RAISE; END IF; v_rejected:=true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v316: negative offset accepted'; END IF;
  v_rejected:=false;
  BEGIN PERFORM public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,NULL,NULL,'2026-02-01Z','2026-01-01Z',0,100,'created_desc',v_username,v_password);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'invalid_campaign_details_date_range' THEN RAISE; END IF; v_rejected:=true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v316: reverse date range accepted'; END IF;
  v_rejected:=false;
  BEGIN PERFORM public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,0,100,'created_desc',NULL,NULL);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'automation_auth_required' THEN RAISE; END IF; v_rejected:=true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v316: missing credentials accepted'; END IF;
  FOREACH v_sort IN ARRAY ARRAY['bad-sort','created_desc'] LOOP
    v_rejected:=false;
    BEGIN PERFORM public.aka_agent_list_campaign_details_page(v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,0,CASE WHEN v_sort='bad-sort' THEN 100 ELSE 501 END,v_sort,v_username,v_password);
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT IN ('invalid_campaign_details_sort','invalid_campaign_details_page') THEN RAISE; END IF; v_rejected:=true; END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'v316: invalid query accepted'; END IF;
  END LOOP;
END;
$smoke$;
SELECT 'PASS v316: pagination, ties/microseconds, NOT NULL invariant, full payload/filter parity, empty-page totals, credentials, tenant and real anon/authenticated/service_role, Desktop/Server history' AS result;
ROLLBACK;
