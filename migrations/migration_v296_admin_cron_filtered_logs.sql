-- Production cgjbsmqtfhqvttudyjzq; source captured via pg_get_functiondef on 2026-09-20.
-- Exact source matches v294. Preserve signature, auth, owner, ACL, settings, jobs/detail.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $preflight$
BEGIN
  IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.aka_agent_admin_cron(bigint,text,text,text,jsonb)'))
      IS DISTINCT FROM '3560ba2bf0ae9f63f380ef343c0c7313' THEN
    RAISE EXCEPTION 'admin_cron_source_checksum_mismatch';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_admin_cron(p_staff_id bigint, p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
 SET statement_timeout TO '8s'
 SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_rows jsonb; v_result jsonb; v_status text := nullif(p_data->>'status','');
  v_cursor bigint := nullif(p_data->>'cursor','')::bigint;
  v_job_id bigint := nullif(p_data->>'job_id','')::bigint;
  v_filtered boolean := v_job_id IS NOT NULL OR v_status IS NOT NULL;
BEGIN
  PERFORM public.aka_agent_admin_assert_access(p_staff_id,p_username,p_password);
  IF p_action='jobs' THEN
    RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',jobid::text,'name',coalesce(jobname,jobid::text),'schedule',schedule,'is_active',active) ORDER BY jobid),'[]') FROM cron.job),
      'timezone',coalesce(current_setting('cron.timezone',true),'GMT'));
  ELSIF p_action='runs' THEN
    IF v_status IS NOT NULL AND v_status NOT IN ('succeeded','failed','running') THEN RAISE EXCEPTION 'admin_invalid_value'; END IF;
    -- The extension table has only a runid index. A backwards index scan for a
    -- sparse/disabled job can read the entire heap randomly before finding 101 rows.
    -- Try a bounded recent window first; frequent jobs and the unfiltered view
    -- stay on the primary-key fast path. EXECUTE replans for each cursor/filter.
    EXECUTE $query$
      WITH recent AS MATERIALIZED (
        SELECT runid,jobid,status,start_time,end_time FROM cron.job_run_details
        WHERE ($1 IS NULL OR runid<$1) ORDER BY runid DESC LIMIT $4
      )
      SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.runid DESC),'[]') FROM (
        SELECT * FROM recent r
        WHERE ($2 IS NULL OR r.jobid=$2)
          AND ($3 IS NULL OR ($3='running' AND r.status NOT IN ('succeeded','failed')) OR r.status=$3)
        ORDER BY r.runid DESC LIMIT 101
      ) q
    $query$ INTO v_rows USING v_cursor,v_job_id,v_status,CASE WHEN v_filtered THEN 5000 ELSE 101 END;

    IF v_filtered AND jsonb_array_length(v_rows)<101 THEN
      -- A sparse filter needs the older history too. runid+0 keeps the exact
      -- ordering but prevents an unbounded, filter-after-PK random heap scan.
      -- PostgreSQL can filter sequentially and use a bounded top-N sort instead.
      -- No new SQL pool, background worker, table/index or timeout increase.
      EXECUTE $query$
        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.runid DESC),'[]') FROM (
          SELECT runid,jobid,status,start_time,end_time FROM cron.job_run_details r
          WHERE ($1 IS NULL OR r.runid<$1) AND ($2 IS NULL OR r.jobid=$2)
            AND ($3 IS NULL OR ($3='running' AND r.status NOT IN ('succeeded','failed')) OR r.status=$3)
          ORDER BY (r.runid+0) DESC LIMIT 101
        ) q
      $query$ INTO v_rows USING v_cursor,v_job_id,v_status;
    END IF;
    -- Resolve names only for the page being returned, preserving deleted jobs.
    RETURN jsonb_build_object('items',(
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',x->>'runid','job_id',x->>'jobid',
        'job_name',coalesce(j.jobname,x->>'jobid'),'status',x->>'status',
        'start_time',x->'start_time','end_time',x->'end_time') ORDER BY n),'[]')
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(x,n)
      LEFT JOIN cron.job j ON j.jobid=(x->>'jobid')::bigint WHERE n<=100),
      'next_cursor',CASE WHEN jsonb_array_length(v_rows)>100 THEN v_rows->99->>'runid' END);
  ELSIF p_action='detail' THEN
    SELECT jsonb_build_object('id',r.runid::text,'job_id',r.jobid::text,'job_name',coalesce(j.jobname,r.jobid::text),'status',r.status,
      'start_time',r.start_time,'end_time',r.end_time,'command',r.command,'return_message',r.return_message) INTO v_result
    FROM cron.job_run_details r LEFT JOIN cron.job j ON j.jobid=r.jobid WHERE r.runid=(p_data->>'id')::bigint;
    IF v_result IS NULL THEN RAISE EXCEPTION 'admin_not_found'; END IF;
    RETURN v_result;
  END IF;
  RAISE EXCEPTION 'admin_invalid_action';
END;
$function$
;
-- Only function body changed; no API metadata or explicit schema reload needed.
COMMIT;
