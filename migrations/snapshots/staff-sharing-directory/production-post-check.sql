BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='8s';
CREATE TEMP TABLE _directory_functions ON COMMIT DROP AS SELECT p.oid,p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f';
CREATE TEMP TABLE _directory_view ON COMMIT DROP AS SELECT pg_get_viewdef(oid,true) definition,relacl::text acl,reloptions FROM pg_class WHERE oid='public.aka_agent_staff_runtime_profile'::regclass;

DO $post$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)') AND md5(pg_get_functiondef(oid))='af95bdbae9bfc75343ddd96eda51dcc7' AND pg_get_userbyid(proowner)='postgres' AND proacl::text='{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}') THEN RAISE EXCEPTION 'sharing directory target mismatch'; END IF;
END $post$;
DO $behavior$
DECLARE u record; expected jsonb; actual jsonb; other_id bigint; row_count bigint; denied boolean; fn record; tested integer:=0;
BEGIN
 FOR u IN SELECT s.id,s.organization_id,s.username,s.password,m.auth_user_id FROM private.aka_agent_desktop_users m JOIN public.org_staff s ON s.id=m.staff_id WHERE s.is_active AND s.deleted_at IS NULL LOOP
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',coalesce(nullif(s.name,''),'Nhân viên #'||s.id)) ORDER BY s.name,s.id),'[]'::jsonb) INTO expected FROM public.org_staff s WHERE s.organization_id=u.organization_id AND s.is_active AND s.deleted_at IS NULL AND s.id<>u.id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',u.auth_user_id)::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  actual:=public.aka_agent_group_sharing(u.id,u.organization_id,u.username,u.password,'staff','{}');
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'recipient list mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(actual) x WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) IS DISTINCT FROM ARRAY['id','name']) THEN RAISE EXCEPTION 'unexpected staff field'; END IF;
  SELECT count(*) INTO row_count FROM public.aka_agent_staff_runtime_profile;
  IF row_count<>1 THEN RAISE EXCEPTION 'own profile scope broken'; END IF;
  IF jsonb_array_length(actual)>0 THEN
   other_id:=(actual->0->>'id')::bigint;
   IF EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_profile WHERE id=other_id) OR EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_scope(other_id,'share')) OR public.aka_agent_staff_time_allowed(other_id) THEN RAISE EXCEPTION 'staff ID granted profile access'; END IF;
   denied:=false;
   BEGIN PERFORM public.aka_agent_group_sharing(other_id,u.organization_id,u.username,u.password,'staff','{}'); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'group_sharing_access_denied' THEN RAISE; END IF; denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'caller staff spoof accepted'; END IF;
  END IF;
  IF has_table_privilege('aka_agent_desktop','public.org_staff','SELECT') OR has_column_privilege('aka_agent_desktop','public.org_staff','password','SELECT') OR has_function_privilege('aka_agent_desktop','public.aka_agent_staff_management(bigint,text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'staff privileges widened'; END IF;
  RESET ROLE;
  tested:=tested+1;
 END LOOP;
 IF tested<2 THEN RAISE EXCEPTION 'insufficient test identities'; END IF;
 FOR fn IN SELECT * FROM _directory_functions WHERE signature<>'aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)' LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn.oid AND md5(pg_get_functiondef(oid))=fn.checksum AND pg_get_userbyid(proowner)=fn.owner AND proacl::text IS NOT DISTINCT FROM fn.acl) THEN RAISE EXCEPTION 'unrelated function changed: %',fn.signature; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN _directory_view v WHERE c.oid='public.aka_agent_staff_runtime_profile'::regclass AND pg_get_viewdef(c.oid,true)=v.definition AND c.relacl::text=v.acl AND c.reloptions=v.reloptions) THEN RAISE EXCEPTION 'runtime view changed'; END IF;
END $behavior$;

ROLLBACK;
SELECT jsonb_build_object('status','passed','at',clock_timestamp(),'kind','directory production post-check','business_rows_written',0) AS evidence;
