-- Linked production: cgjbsmqtfhqvttudyjzq. Source audit: all six exact signatures
-- and public.auto_admin_api_docs were absent on 2026-09-20. No live RPC replaced.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
DO $preflight$
DECLARE v_signature text;
BEGIN
  IF to_regclass('public.auto_admin_api_docs') IS NOT NULL THEN
    RAISE EXCEPTION 'admin_preflight_table_already_exists';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_admin_assert_access(bigint,text,text)',
    'public.aka_agent_admin_docs(bigint,text,text,text,jsonb)',
    'public.aka_agent_admin_notifications(bigint,text,text,text,jsonb)',
    'public.aka_agent_admin_settings(bigint,text,text,text,jsonb)',
    'public.aka_agent_admin_cron(bigint,text,text,text,jsonb)',
    'public.aka_agent_admin_triggers(bigint,text,text,text,jsonb)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NOT NULL THEN
      RAISE EXCEPTION 'admin_preflight_function_already_exists: %', v_signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE TABLE public.auto_admin_api_docs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  url text NOT NULL CHECK (length(url) <= 4096 AND url ~* '^https?://[^/@[:space:]]+([/?#]|$)'),
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auto_admin_api_docs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_admin_api_docs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.auto_admin_api_docs_id_seq FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.auto_admin_api_docs(name,url,description)
VALUES ('API akaChat','https://chat.akabiz.biz/developers','Tài liệu API akaChat');

CREATE FUNCTION public.aka_agent_admin_assert_access(p_staff_id bigint,p_username text,p_password text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff s
    WHERE s.id = p_staff_id AND s.username = p_username AND s.password = p_password
      AND s.is_active IS TRUE AND s.is_admin IS TRUE AND s.organization_id = 1
  ) THEN RAISE EXCEPTION 'admin_access_denied' USING ERRCODE = '42501'; END IF;
END;
$function$;

CREATE FUNCTION public.aka_agent_admin_docs(p_staff_id bigint,p_username text,p_password text,p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' SET statement_timeout = '8s' SET lock_timeout = '3s'
AS $function$
DECLARE v_doc public.auto_admin_api_docs%ROWTYPE; v_id bigint := (p_data->>'id')::bigint;
BEGIN
  PERFORM public.aka_agent_admin_assert_access(p_staff_id,p_username,p_password);
  IF p_action = 'list' THEN
    RETURN (SELECT coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('version',md5(to_jsonb(d)::text)) ORDER BY d.sort_order,d.id),'[]') FROM public.auto_admin_api_docs d);
  END IF;
  IF p_action NOT IN ('get','save','delete') OR p_action IS NULL THEN RAISE EXCEPTION 'admin_invalid_action'; END IF;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.auto_admin_api_docs WHERE id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'admin_not_found'; END IF;
    IF p_action <> 'get' AND (p_data->>'expected_version') IS DISTINCT FROM md5(to_jsonb(v_doc)::text) THEN RAISE EXCEPTION 'admin_conflict'; END IF;
  ELSIF p_action <> 'save' THEN RAISE EXCEPTION 'admin_not_found'; END IF;
  IF p_action = 'delete' THEN
    DELETE FROM public.auto_admin_api_docs WHERE id=v_id;
    RETURN '{}'::jsonb;
  ELSIF p_action = 'save' THEN
    IF v_id IS NULL THEN
      INSERT INTO public.auto_admin_api_docs(name,url,description,sort_order,is_active)
      VALUES (btrim(p_data->>'name'),btrim(p_data->>'url'),p_data->>'description',coalesce((p_data->>'sort_order')::integer,0),coalesce((p_data->>'is_active')::boolean,true)) RETURNING * INTO v_doc;
    ELSE
      UPDATE public.auto_admin_api_docs SET name=btrim(p_data->>'name'),url=btrim(p_data->>'url'),description=p_data->>'description',
        sort_order=(p_data->>'sort_order')::integer,is_active=(p_data->>'is_active')::boolean,updated_at=clock_timestamp()
      WHERE id=v_id RETURNING * INTO v_doc;
    END IF;
  END IF;
  RETURN to_jsonb(v_doc) || jsonb_build_object('version',md5(to_jsonb(v_doc)::text));
END;
$function$;

CREATE FUNCTION public.aka_agent_admin_notifications(p_staff_id bigint,p_username text,p_password text,p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' SET statement_timeout = '8s' SET lock_timeout = '3s'
AS $function$
DECLARE v_value text; v_id bigint := (p_data->>'staff_id')::bigint; v_rows jsonb; v_setting public.auto_system_settings%ROWTYPE;
BEGIN
  PERFORM public.aka_agent_admin_assert_access(p_staff_id,p_username,p_password);
  IF p_action = 'global' THEN
    SELECT * INTO v_setting FROM public.auto_system_settings WHERE key='app.notification';
    IF NOT FOUND THEN RAISE EXCEPTION 'admin_not_found'; END IF;
    RETURN jsonb_build_object('staff_id',NULL,'username','Toàn bộ khách hàng','organization_id',NULL,'organization_name','Toàn hệ thống',
      'raw_value',coalesce(v_setting.value,''),'version',md5(coalesce(v_setting.value,'')),'is_active',v_setting.is_active);
  ELSIF p_action IN ('list','search') THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.staff_id),'[]') INTO v_rows FROM (
      SELECT s.id AS staff_id,s.username,s.organization_id,coalesce(o.name,'') AS organization_name,
        coalesce(s.app_notification,'') AS raw_value,md5(coalesce(s.app_notification,'')) AS version,s.is_active
      FROM public.org_staff s LEFT JOIN public.org_organization o ON o.id=s.organization_id
      WHERE (p_action='list' AND nullif(btrim(s.app_notification),'') IS NOT NULL AND s.id>coalesce((p_data->>'cursor')::bigint,0))
         OR (p_action='search' AND length(btrim(coalesce(p_data->>'search','')))>=2 AND s.username ILIKE '%' || replace(replace(replace(left(p_data->>'search',100),E'\\',E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%')
      ORDER BY s.id LIMIT 101
    ) q;
    IF p_action='search' THEN RETURN (SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(x,n) WHERE n<=100); END IF;
    RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(x,n) WHERE n<=100),
      'next_cursor',CASE WHEN jsonb_array_length(v_rows)>100 THEN v_rows->99->>'staff_id' END);
  ELSIF p_action='save' THEN
    v_value := p_data->>'raw_value';
    IF v_value IS NULL OR length(v_value)>100000 THEN RAISE EXCEPTION 'admin_invalid_value'; END IF;
    IF v_id IS NULL THEN
      SELECT * INTO v_setting FROM public.auto_system_settings WHERE key='app.notification' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'admin_not_found'; END IF;
      IF (p_data->>'expected_version') IS DISTINCT FROM md5(coalesce(v_setting.value,'')) THEN RAISE EXCEPTION 'admin_conflict'; END IF;
      UPDATE public.auto_system_settings SET value=v_value,updated_at=clock_timestamp() WHERE id=v_setting.id;
    ELSE
      PERFORM 1 FROM public.org_staff WHERE id=v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'admin_not_found'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id=v_id AND md5(coalesce(app_notification,''))=p_data->>'expected_version') THEN RAISE EXCEPTION 'admin_conflict'; END IF;
      UPDATE public.org_staff SET app_notification=v_value,updated_at=clock_timestamp() WHERE id=v_id;
    END IF;
    RETURN '{}'::jsonb;
  END IF;
  RAISE EXCEPTION 'admin_invalid_action';
END;
$function$;

CREATE FUNCTION public.aka_agent_admin_settings(p_staff_id bigint,p_username text,p_password text,p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' SET statement_timeout = '8s' SET lock_timeout = '3s'
AS $function$
DECLARE v_setting public.auto_system_settings%ROWTYPE; v_version text;
BEGIN
  PERFORM public.aka_agent_admin_assert_access(p_staff_id,p_username,p_password);
  IF p_action='list' THEN
    RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'key',s.key,'description',s.description,'is_secret',s.is_secret,'is_active',s.is_active,
      'value',CASE WHEN s.is_secret THEN NULL ELSE s.value END,'version',md5(to_jsonb(s)::text)) ORDER BY s.key),'[]') FROM public.auto_system_settings s);
  ELSIF p_action IN ('reveal','save') THEN
    SELECT * INTO v_setting FROM public.auto_system_settings WHERE id=(p_data->>'id')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'admin_not_found'; END IF;
    v_version := md5(to_jsonb(v_setting)::text);
    IF p_action='reveal' THEN RETURN to_jsonb(v_setting) || jsonb_build_object('version',v_version); END IF;
    IF (p_data->>'expected_version') IS DISTINCT FROM v_version THEN RAISE EXCEPTION 'admin_conflict'; END IF;
    IF length(coalesce(p_data->>'value',''))>1000000 OR length(coalesce(p_data->>'description',''))>10000 THEN RAISE EXCEPTION 'admin_invalid_value'; END IF;
    IF p_data ? 'value' AND jsonb_typeof(p_data->'value') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'admin_invalid_value'; END IF;
    UPDATE public.auto_system_settings SET description=p_data->>'description',
      value=CASE WHEN p_data ? 'value' THEN p_data->>'value' ELSE value END,updated_at=clock_timestamp()
    WHERE id=v_setting.id;
    RETURN '{}'::jsonb;
  END IF;
  RAISE EXCEPTION 'admin_invalid_action';
END;
$function$;

CREATE FUNCTION public.aka_agent_admin_cron(p_staff_id bigint,p_username text,p_password text,p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' SET statement_timeout = '8s' SET lock_timeout = '3s'
AS $function$
DECLARE v_rows jsonb; v_result jsonb; v_status text := nullif(p_data->>'status','');
BEGIN
  PERFORM public.aka_agent_admin_assert_access(p_staff_id,p_username,p_password);
  IF p_action='jobs' THEN
    RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',jobid::text,'name',coalesce(jobname,jobid::text),'schedule',schedule,'is_active',active) ORDER BY jobid),'[]') FROM cron.job),
      'timezone',coalesce(current_setting('cron.timezone',true),'GMT'));
  ELSIF p_action='runs' THEN
    IF v_status IS NOT NULL AND v_status NOT IN ('succeeded','failed','running') THEN RAISE EXCEPTION 'admin_invalid_value'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.sort_id DESC),'[]') INTO v_rows FROM (
      SELECT r.runid AS sort_id,r.runid::text AS id,r.jobid::text AS job_id,coalesce(j.jobname,r.jobid::text) AS job_name,r.status,r.start_time,r.end_time
      FROM cron.job_run_details r LEFT JOIN cron.job j ON j.jobid=r.jobid
      WHERE (nullif(p_data->>'cursor','') IS NULL OR r.runid<(p_data->>'cursor')::bigint)
        AND (nullif(p_data->>'job_id','') IS NULL OR r.jobid=(p_data->>'job_id')::bigint)
        AND (v_status IS NULL OR (v_status='running' AND r.status NOT IN ('succeeded','failed')) OR r.status=v_status)
      ORDER BY r.runid DESC LIMIT 101
    ) q;
    RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(x-'sort_id'),'[]') FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(x,n) WHERE n<=100),
      'next_cursor',CASE WHEN jsonb_array_length(v_rows)>100 THEN v_rows->99->>'id' END);
  ELSIF p_action='detail' THEN
    SELECT jsonb_build_object('id',r.runid::text,'job_id',r.jobid::text,'job_name',coalesce(j.jobname,r.jobid::text),'status',r.status,
      'start_time',r.start_time,'end_time',r.end_time,'command',r.command,'return_message',r.return_message) INTO v_result
    FROM cron.job_run_details r LEFT JOIN cron.job j ON j.jobid=r.jobid WHERE r.runid=(p_data->>'id')::bigint;
    IF v_result IS NULL THEN RAISE EXCEPTION 'admin_not_found'; END IF;
    RETURN v_result;
  END IF;
  RAISE EXCEPTION 'admin_invalid_action';
END;
$function$;

CREATE FUNCTION public.aka_agent_admin_triggers(p_staff_id bigint,p_username text,p_password text,p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '8s'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.aka_agent_admin_assert_access(p_staff_id,p_username,p_password);
  IF p_action NOT IN ('list','detail') OR p_action IS NULL THEN RAISE EXCEPTION 'admin_invalid_action'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.oid::text,'name',t.tgname,'table_name',format('%I.%I',n.nspname,c.relname),
    'timing',CASE WHEN (t.tgtype & 2)<>0 THEN 'BEFORE' WHEN (t.tgtype & 64)<>0 THEN 'INSTEAD OF' ELSE 'AFTER' END,
    'events',concat_ws(' OR ',CASE WHEN (t.tgtype & 4)<>0 THEN 'INSERT' END,CASE WHEN (t.tgtype & 8)<>0 THEN 'DELETE' END,
      CASE WHEN (t.tgtype & 16)<>0 THEN 'UPDATE' || coalesce((SELECT ' OF ' || string_agg(quote_ident(a.attname),', ' ORDER BY k.n)
        FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY k(attnum,n) JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.attnum),'') END,
      CASE WHEN (t.tgtype & 32)<>0 THEN 'TRUNCATE' END),
    'condition',CASE WHEN t.tgqual IS NOT NULL THEN substring(pg_get_triggerdef(t.oid,true) FROM ' WHEN \((.*)\) EXECUTE (?:FUNCTION|PROCEDURE) ') END,
    'function_name',format('%I.%I(%s)',pn.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    'is_active',t.tgenabled<>'D') || CASE WHEN p_action='detail' THEN jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'function_body',pg_get_functiondef(p.oid)) ELSE '{}'::jsonb END
    ORDER BY c.relname,t.tgname),'[]') INTO v_result
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
  WHERE NOT t.tgisinternal AND n.nspname='public' AND (p_action='list' OR t.oid=(p_data->>'id')::oid);
  IF p_action='detail' THEN
    IF jsonb_array_length(v_result)=0 THEN RAISE EXCEPTION 'admin_not_found'; END IF;
    RETURN v_result->0;
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_admin_assert_access(bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $permissions$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['docs','notifications','settings','cron','triggers'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_admin_%I(bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role',v_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.aka_agent_admin_%I(bigint,text,text,text,jsonb) TO anon,authenticated',v_name);
  END LOOP;
END;
$permissions$;
-- New API metadata requires a PostgREST schema refresh, once after this commit.
NOTIFY pgrst, 'reload schema';
COMMIT;
