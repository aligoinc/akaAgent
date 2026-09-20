-- Run within BEGIN/ROLLBACK; only reads cron metadata/history, never executes a job.
CREATE TEMP TABLE admin_cron_smoke_result(case_name text,elapsed_ms numeric,rows_returned integer) ON COMMIT DROP;
DO $smoke$
DECLARE a public.org_staff%ROWTYPE; result jsonb; next_page jsonb; expected jsonb;
  params jsonb; started timestamptz; elapsed numeric;
BEGIN
  SELECT * INTO STRICT a FROM public.org_staff WHERE organization_id=1 AND is_admin IS TRUE AND is_active IS TRUE ORDER BY id LIMIT 1;
  BEGIN
    PERFORM public.aka_agent_admin_cron(a.id,a.username,'__invalid_admin_smoke_password__','runs');
    RAISE EXCEPTION 'smoke_invalid_credentials_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  result:=public.aka_agent_admin_cron(a.id,a.username,a.password,'jobs');
  IF result->>'timezone' IS NULL OR jsonb_typeof(result->'items')<>'array' THEN RAISE EXCEPTION 'smoke_jobs_contract'; END IF;
  FOREACH params IN ARRAY ARRAY[
    '{"cursor":null,"job_id":"","status":""}'::jsonb,
    '{"cursor":"","job_id":"8","status":""}'::jsonb,
    '{"job_id":"-1","status":""}'::jsonb,
    '{"status":"failed"}'::jsonb
  ] LOOP
    started:=clock_timestamp();
    result:=public.aka_agent_admin_cron(a.id,a.username,a.password,'runs',params);
    elapsed:=extract(epoch FROM clock_timestamp()-started)*1000;
    IF elapsed>=8000 THEN RAISE EXCEPTION 'smoke_cron_timeout_regression'; END IF;
    IF jsonb_array_length(result->'items')>100 THEN RAISE EXCEPTION 'smoke_page_too_large'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(result->'items') x WHERE
      (nullif(params->>'job_id','') IS NOT NULL AND x->>'job_id'<>params->>'job_id') OR
      (params->>'status'='failed' AND x->>'status'<>'failed')) THEN RAISE EXCEPTION 'smoke_filter_not_applied'; END IF;
    INSERT INTO admin_cron_smoke_result VALUES(params::text,elapsed,jsonb_array_length(result->'items'));
    IF params->>'job_id'='8' THEN
      SELECT coalesce(jsonb_agg(runid::text ORDER BY runid DESC),'[]') INTO expected FROM
        (SELECT runid FROM cron.job_run_details WHERE jobid=8 ORDER BY (runid+0) DESC LIMIT 100) q;
      IF (SELECT coalesce(jsonb_agg(x->>'id' ORDER BY n),'[]') FROM jsonb_array_elements(result->'items') WITH ORDINALITY e(x,n))<>expected THEN RAISE EXCEPTION 'smoke_sparse_job_page_mismatch'; END IF;
      IF result->>'next_cursor' IS NOT NULL THEN
        next_page:=public.aka_agent_admin_cron(a.id,a.username,a.password,'runs',params||jsonb_build_object('cursor',result->>'next_cursor'));
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(next_page->'items') x WHERE (x->>'id')::bigint >= (result->>'next_cursor')::bigint) THEN RAISE EXCEPTION 'smoke_cursor_overlap'; END IF;
        SELECT coalesce(jsonb_agg(runid::text ORDER BY runid DESC),'[]') INTO expected FROM
          (SELECT runid FROM cron.job_run_details WHERE jobid=8 AND runid<(result->>'next_cursor')::bigint ORDER BY (runid+0) DESC LIMIT 100) q;
        IF (SELECT coalesce(jsonb_agg(x->>'id' ORDER BY n),'[]') FROM jsonb_array_elements(next_page->'items') WITH ORDINALITY e(x,n))<>expected THEN RAISE EXCEPTION 'smoke_cursor_missing_rows'; END IF;
      END IF;
    END IF;
    IF jsonb_array_length(result->'items')>0 THEN
      next_page:=public.aka_agent_admin_cron(a.id,a.username,a.password,'detail',jsonb_build_object('id',result->'items'->0->>'id'));
      IF next_page->>'id'<>result->'items'->0->>'id' OR NOT (next_page ? 'command') THEN RAISE EXCEPTION 'smoke_detail_contract'; END IF;
    END IF;
  END LOOP;
  BEGIN
    PERFORM public.aka_agent_admin_cron(a.id,a.username,a.password,'run');
    RAISE EXCEPTION 'smoke_job_execution_allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'admin_invalid_action' THEN RAISE; END IF; END;
END;
$smoke$;
