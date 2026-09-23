-- Run after v314, or inside its rollback rehearsal. All fixtures roll back.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $smoke$
DECLARE
  v_staff bigint;
  v_org bigint;
  v_username text;
  v_password text;
  v_base constant bigint := 8800314000000000;
  v_sort text;
  v_ids bigint[] := ARRAY[v_base+11,v_base+12,v_base+13,v_base+14,v_base+15,v_base+16,v_base+17,v_base+18];
  v_invalid_ids bigint[];
  v_expected bigint[];
  v_actual bigint[];
  v_count bigint;
  v_rejected boolean;
  v_source_core regprocedure := to_regprocedure('public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)');
  v_source_wrapper regprocedure := to_regprocedure('public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text)');
  v_core regprocedure := to_regprocedure('public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,bigint[])');
  v_wrapper regprocedure := to_regprocedure('public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text,text,bigint[])');
BEGIN
  IF md5(pg_get_functiondef(v_source_core)) <> 'd0d1a242529d6fc83a1cdf557ee0cc63'
    OR md5(pg_get_functiondef(v_source_wrapper)) <> '2ac65746a79de69ba99911b3301e1340'
    OR v_core IS NULL OR v_wrapper IS NULL THEN
    RAISE EXCEPTION 'v314: missing target or changed legacy RPC';
  END IF;
  IF md5(pg_get_functiondef(v_core)) <> '3a4b00065a39f4172474d8a25d9dcdfc'
    OR md5(pg_get_functiondef(v_wrapper)) <> '6faf48dceae54faacb69b6c3aa3b5ca6' THEN
    RAISE EXCEPTION 'v314: unexpected target checksum';
  END IF;
  IF has_function_privilege('anon', v_core, 'EXECUTE')
    OR has_function_privilege('authenticated', v_core, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_core, 'EXECUTE')
    OR NOT has_function_privilege('anon', v_wrapper, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', v_wrapper, 'EXECUTE') THEN
    RAISE EXCEPTION 'v314: invalid grants';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (v_core, v_wrapper)
    AND (NOT prosecdef OR pg_get_userbyid(proowner) <> 'postgres'
      OR NOT ('statement_timeout=60s' = ANY(proconfig)))) THEN
    RAISE EXCEPTION 'v314: invalid owner/security/timeout';
  END IF;

  SELECT id, organization_id, username, password INTO v_staff, v_org, v_username, v_password
  FROM public.org_staff WHERE is_active = true AND organization_id IS NOT NULL
    AND username IS NOT NULL AND password IS NOT NULL ORDER BY id LIMIT 1;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'v314: no fixture staff'; END IF;
  PERFORM public.auto_assert_automation_identity(v_staff, v_org, v_username, v_password);
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-v314-sort-smoke', 0));
  IF EXISTS (SELECT 1 FROM public.auto_accounts WHERE id IN (v_base + 1, v_base + 2))
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id IN (v_base + 3, v_base + 4))
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id BETWEEN v_base + 11 AND v_base + 18) THEN
    RAISE EXCEPTION 'v314: fixture ID collision';
  END IF;
  INSERT INTO public.auto_accounts (id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active, staff_id, organization_id, is_delete)
  OVERRIDING SYSTEM VALUE VALUES
    (v_base+1, '__v314_local__', 'zalo', false, false, 'đã đăng nhập', 'chờ xử lý', true, v_staff, v_org, false),
    (v_base+2, '__v314_server__', 'zalo', false, true, 'đã đăng nhập', 'chờ xử lý', true, v_staff, v_org, false);
  INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, content, schedule,
    original_schedule, data_target_source_mode, staff_id, organization_id, is_delete)
  OVERRIDING SYSTEM VALUE VALUES
    (v_base+3, '__v314_local__', 'zalo_message_phone', v_base+1, 'hoàn thành', '', now(), now(), 'direct', v_staff, v_org, false),
    (v_base+4, '__v314_server__', 'zalo_message_phone', v_base+2, 'hoàn thành', '', now(), now(), 'direct', v_staff, v_org, false);
  INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, phone, status, is_delete, created_at, date_action)
  OVERRIDING SYSTEM VALUE VALUES
    (v_base+11,v_base+3,'sort-target-1','0900000001','hoàn thành',false,'2026-01-01Z','2026-01-05Z'),
    (v_base+12,v_base+3,'sort-target-2','0900000002','hoàn thành',false,'2026-01-02Z',NULL),
    (v_base+13,v_base+3,'sort-target-3','0900000003','tạm dừng',false,'2026-01-02Z','2026-01-04Z'),
    (v_base+14,v_base+3,'sort-target-4','0900000004','hoàn thành',false,'2026-01-03Z','2026-01-05Z'),
    (v_base+15,v_base+3,'sort-target-5','0900000005','hoàn thành',false,NULL,NULL),
    (v_base+16,v_base+3,'sort-target-6','0900000006','hoàn thành',false,NULL,'2026-01-06Z'),
    (v_base+17,v_base+4,'sort-server','0900000007','hoàn thành',false,'2026-01-01Z',NULL),
    (v_base+18,v_base+3,'sort-deleted','0900000008','hoàn thành',true,'2026-01-01Z',NULL);

  -- Real role switch tests the RPC-only grants, not just JWT claims.
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('aka_agent.zalo_runtime_target','server',true);
  FOREACH v_sort IN ARRAY ARRAY['created_desc','created_asc','processed_desc','processed_asc'] LOOP
    v_expected := CASE v_sort
      WHEN 'created_desc' THEN ARRAY[14,13,12,11,16,15]::bigint[]
      WHEN 'created_asc' THEN ARRAY[11,12,13,14,15,16]::bigint[]
      WHEN 'processed_desc' THEN ARRAY[16,14,11,13,12,15]::bigint[]
      ELSE ARRAY[12,13,11,14,16,15]::bigint[] END;
    SELECT array_agg((input_data->>'id')::bigint - v_base ORDER BY ord),max(total_count)
    INTO v_actual,v_count FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,'all',0,100,v_username,v_password,v_sort,v_ids
    ) WITH ORDINALITY AS p(input_data,origins,total_count,ord);
    IF v_actual IS DISTINCT FROM v_expected OR v_count <> 6 THEN
      RAISE EXCEPTION 'v314: wrong sort %: % expected %',v_sort,v_actual,v_expected;
    END IF;
    SELECT array_agg((input_data->>'id')::bigint - v_base ORDER BY ord),max(total_count)
    INTO v_actual,v_count FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      v_staff,v_org,v_base+3,'sort-target',NULL,NULL,NULL,'direct',0,2,v_username,v_password,v_sort,ARRAY[v_base+v_expected[3],v_base+v_expected[4]]
    ) WITH ORDINALITY AS p(input_data,origins,total_count,ord);
    IF v_actual IS DISTINCT FROM v_expected[3:4] OR v_count <> 2 THEN
      RAISE EXCEPTION 'v314: wrong page/search/origin %: %',v_sort,v_actual;
    END IF;
    IF current_setting('aka_agent.zalo_runtime_target',true) <> 'server' THEN
      RAISE EXCEPTION 'v314: local wrapper did not restore GUC';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.aka_agent_list_campaign_input_data_page_by_ids(
    v_staff,v_org,v_base+3,NULL,'tạm dừng','2026-01-02Z','2026-01-02Z','direct',0,100,v_username,v_password,'processed_desc',v_ids);
  IF v_count <> 1 THEN RAISE EXCEPTION 'v314: status/date filter failed'; END IF;
  PERFORM set_config('aka_agent.zalo_runtime_target','desktop',true);
  SELECT count(*) INTO v_count FROM public.aka_agent_list_campaign_input_data_page_by_ids(
    v_staff,v_org,v_base+4,NULL,NULL,NULL,NULL,'all',0,100,v_username,v_password,'created_desc',v_ids);
  IF v_count <> 1 OR current_setting('aka_agent.zalo_runtime_target',true) <> 'desktop' THEN
    RAISE EXCEPTION 'v314: Server wrapper routing/restore failed';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM * FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,'all',0,100,v_username,v_password,'invalid',v_ids);
  EXCEPTION WHEN raise_exception THEN v_rejected := SQLERRM = 'invalid_campaign_input_data_sort'; END;
  IF NOT v_rejected OR current_setting('aka_agent.zalo_runtime_target',true) <> 'desktop' THEN
    RAISE EXCEPTION 'v314: invalid sort/error restore failed';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM * FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      v_staff,v_org+1,v_base+3,NULL,NULL,NULL,NULL,'all',0,100,v_username,v_password,'created_desc',v_ids);
  EXCEPTION WHEN OTHERS THEN v_rejected := true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v314: cross-tenant read accepted'; END IF;
  FOREACH v_invalid_ids SLICE 1 IN ARRAY ARRAY[ARRAY[0::bigint],ARRAY[NULL::bigint]] LOOP
    v_rejected := false;
    BEGIN
      PERFORM * FROM public.aka_agent_list_campaign_input_data_page_by_ids(
        v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,'all',0,100,v_username,v_password,'created_desc',v_invalid_ids);
    EXCEPTION WHEN raise_exception THEN v_rejected := SQLERRM = 'invalid_campaign_input_data_selection'; END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'v314: invalid IDs accepted'; END IF;
  END LOOP;
  v_rejected := false;
  BEGIN
    PERFORM * FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,'all',0,500,v_username,v_password,'created_desc',
      ARRAY(SELECT generate_series(1,501)::bigint));
  EXCEPTION WHEN raise_exception THEN v_rejected := SQLERRM = 'invalid_campaign_input_data_selection'; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v314: oversized selection accepted'; END IF;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role';
  v_rejected := false;
  BEGIN
    PERFORM * FROM public.aka_agent_list_campaign_input_data_page_by_ids(
      v_staff,v_org,v_base+4,NULL,NULL,NULL,NULL,'all',0,100,'created_desc',v_ids);
  EXCEPTION WHEN raise_exception THEN v_rejected := SQLERRM = 'campaign_not_found'; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v314: core ownership guard failed'; END IF;
  EXECUTE 'RESET ROLE';
  -- Existing reset behavior deliberately removes date_action; sorting falls back to created_at.
  UPDATE public.auto_campaign_input_data SET date_action=NULL WHERE id=v_base+11;
  SELECT (input_data->>'id')::bigint-v_base INTO v_count
  FROM public.aka_agent_list_campaign_input_data_page_by_ids(
    v_staff,v_org,v_base+3,NULL,NULL,NULL,NULL,'all',0,1,v_username,v_password,'processed_asc',ARRAY[v_base+11]);
  IF v_count <> 11 THEN RAISE EXCEPTION 'v314: reset fallback failed'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text)'))) <> '26f1c96183a8d0e92ac76575e8c1df96'
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text,text)'))) <> '440e2c6163518d4c0563c275d33e8474' THEN
    RAISE EXCEPTION 'v314: v2 changed';
  END IF;
  RAISE NOTICE 'v314 PASS: fixed ID sets, deleted/other-campaign exclusion, selection validation, four orders, pagination, filters, null/reset fallback, legacy checksums, roles, tenant and runtime guards';
END;
$smoke$;
ROLLBACK;
