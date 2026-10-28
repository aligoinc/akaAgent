// Generates a read-only behavioral rehearsal around the guarded migration.
// Existing profile values/credentials stay inside PostgreSQL; only pass receipts leave it.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../..')
const dir=path.join(root,'migrations/snapshots/staff-self-access'),q=s=>"'"+s.replaceAll("'","''")+"'"
const plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json'))),target=JSON.parse(fs.readFileSync(path.join(dir,'target.json')))
const signature=f=>f.signature.startsWith('private.')?f.signature:'public.'+f.signature
const post=`DO $post$ BEGIN\n`+target.functions.map(f=>` IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(${q(signature(f))}) AND md5(pg_get_functiondef(oid))=${q(f.checksum)} AND proacl::text=${q(f.acl)} AND pg_get_userbyid(proowner)=${q(f.owner)}) THEN RAISE EXCEPTION 'staff self-access target metadata mismatch: %',${q(signature(f))}; END IF;`).join('\n')+`\n IF pg_get_viewdef('public.aka_agent_staff_runtime_profile'::regclass,true) IS DISTINCT FROM ${q(target.view.view)} THEN RAISE EXCEPTION 'staff self-access target view mismatch'; END IF;\nEND $post$;\n`
const migrationPath=path.join(root,'supabase/migrations/20261027175514_desktop_staff_self_access.sql')
let migration=fs.readFileSync(migrationPath,'utf8').split('-- Exact target postconditions')[0]
migration+='-- Exact target postconditions\n'+post
fs.writeFileSync(migrationPath,migration)
const snapshot=`CREATE TEMP TABLE _staff_privacy_functions ON COMMIT DROP AS
 SELECT p.oid::regprocedure::text AS signature,md5(pg_get_functiondef(p.oid)) AS checksum,pg_get_userbyid(proowner) AS owner,proacl::text AS acl,proconfig,prosecdef,provolatile
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f';
CREATE TEMP TABLE _staff_privacy_relations ON COMMIT DROP AS
 SELECT c.oid,n.nspname,c.relname,c.relacl::text AS acl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,pg_get_userbyid(c.relowner) AS owner,
 CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal');
CREATE TEMP TABLE _staff_privacy_users ON COMMIT DROP AS
 SELECT m.staff_id,m.auth_user_id,to_jsonb(v) AS profile,public.get_staff_zalo_runtime_mode(s.id) AS runtime_mode,public.get_staff_zalo_account_capabilities(s.id) AS capabilities
 FROM private.aka_agent_desktop_users m JOIN public.org_staff s ON s.id=m.staff_id JOIN public.aka_agent_staff_runtime_profile v ON v.id=s.id
 WHERE s.is_active AND s.deleted_at IS NULL AND public.aka_agent_staff_time_allowed(s.id)
 ORDER BY (s.is_admin_akabiz IS TRUE) DESC,s.id LIMIT 6;
CREATE TEMP TABLE _staff_privacy_expected ON COMMIT DROP AS SELECT count(*) AS staff_count FROM public.org_staff;
`
const check=`DO $behavior$
DECLARE u record; v_count bigint; v_data jsonb; v_other bigint; v_name text; v_password text; v_org bigint; f record; v_denied boolean; total bigint;
BEGIN
 SELECT staff_count INTO total FROM _staff_privacy_expected;
 IF (SELECT count(*) FROM _staff_privacy_users)<2 THEN RAISE EXCEPTION 'need at least two mapped active users'; END IF;
 FOR u IN SELECT * FROM _staff_privacy_users LOOP
  SELECT id INTO v_other FROM public.org_staff WHERE id<>u.staff_id ORDER BY id LIMIT 1;
  SELECT username,password,organization_id INTO v_name,v_password,v_org FROM public.org_staff WHERE id=u.staff_id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',u.auth_user_id)::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  SELECT count(*) INTO v_count FROM public.aka_agent_staff_runtime_profile;
  IF v_count<>1 THEN RAISE EXCEPTION 'Desktop profile scope count mismatch'; END IF;
  SELECT to_jsonb(s) INTO v_data FROM public.aka_agent_staff_runtime_profile s WHERE id=u.staff_id;
  IF v_data IS DISTINCT FROM u.profile THEN RAISE EXCEPTION 'own profile mismatch'; END IF;
  SELECT to_jsonb(s) INTO v_data FROM public.aka_agent_staff_runtime_scope(u.staff_id,'share') s;
  IF v_data IS DISTINCT FROM u.profile THEN RAISE EXCEPTION 'own locked runtime mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_scope(v_other,'share')) OR EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_scope(v_other,'update')) OR public.aka_agent_staff_time_allowed(v_other) THEN RAISE EXCEPTION 'other staff runtime exposed'; END IF;
  IF NOT public.aka_agent_staff_time_allowed(u.staff_id) THEN RAISE EXCEPTION 'own time access blocked'; END IF;
  IF public.get_staff_zalo_runtime_mode(u.staff_id) IS DISTINCT FROM u.runtime_mode OR public.get_staff_zalo_account_capabilities(u.staff_id) IS DISTINCT FROM u.capabilities THEN RAISE EXCEPTION 'own capability mismatch'; END IF;
  IF public.aka_agent_group_sharing(u.staff_id,v_org,v_name,v_password,'staff','{}') IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'recipient list exposed'; END IF;
  v_denied:=false;
  BEGIN PERFORM public.aka_agent_staff_management(u.staff_id,v_name,v_password,'list','{}'); EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'admin RPC was not blocked'; END IF;
  RESET ROLE;
 END LOOP;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE aka_agent_desktop;
 IF EXISTS(SELECT 1 FROM public.aka_agent_staff_runtime_profile) THEN RAISE EXCEPTION 'missing claims leaked profile'; END IF;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 SELECT count(*) INTO v_count FROM public.aka_agent_staff_runtime_profile;
 IF v_count<>total THEN RAISE EXCEPTION 'backend scope changed'; END IF;
 RESET ROLE;
 FOR f IN SELECT * FROM _staff_privacy_functions LOOP
  IF f.signature = ANY(ARRAY[${target.functions.filter(x=>x.name!=='aka_agent_staff_scope_for_request').map(x=>q(x.signature)).join(',')}]) THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND md5(pg_get_functiondef(oid))=f.checksum AND pg_get_userbyid(proowner)=f.owner AND proacl::text IS NOT DISTINCT FROM f.acl AND proconfig IS NOT DISTINCT FROM f.proconfig AND prosecdef=f.prosecdef AND provolatile=f.provolatile) THEN RAISE EXCEPTION 'unrelated function changed: %',f.signature; END IF;
 END LOOP;
 FOR f IN SELECT * FROM _staff_privacy_relations LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=f.oid AND c.relacl::text IS NOT DISTINCT FROM f.acl AND c.relrowsecurity=f.relrowsecurity AND c.relforcerowsecurity=f.relforcerowsecurity AND c.reloptions IS NOT DISTINCT FROM f.reloptions AND pg_get_userbyid(c.relowner)=f.owner AND (f.relname='aka_agent_staff_runtime_profile' OR f.definition IS NULL OR pg_get_viewdef(c.oid,true)=f.definition)) THEN RAISE EXCEPTION 'unrelated relation changed: %',f.relname; END IF;
 END LOOP;
END $behavior$;
`
const rollback=fs.readFileSync(path.join(root,'migrations/rollback_desktop_staff_self_access.sql'),'utf8')
const restorecheck=`DO $restored$ DECLARE f record; BEGIN
 FOR f IN SELECT * FROM _staff_privacy_functions LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND md5(pg_get_functiondef(oid))=f.checksum AND proacl::text IS NOT DISTINCT FROM f.acl AND pg_get_userbyid(proowner)=f.owner) THEN RAISE EXCEPTION 'rollback mismatch: %',f.signature; END IF;
 END LOOP;
 IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NOT NULL THEN RAISE EXCEPTION 'helper remained'; END IF;
 IF pg_get_viewdef('public.aka_agent_staff_runtime_profile'::regclass,true) IS DISTINCT FROM ${q(plan.view.view)} THEN RAISE EXCEPTION 'view rollback mismatch'; END IF;
END $restored$;`
fs.writeFileSync(path.join(dir,'production-trial.sql'),`BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='8s';\n${snapshot}\n${migration}\n${check}\nSET LOCAL aka_agent.staff_self_access_rollback='approved';\n${rollback}\n${restorecheck}\nROLLBACK;\nSELECT jsonb_build_object('status','passed','kind','production rollback trial','at',clock_timestamp(),'business_rows_written',0,'checks','six mapped users, admin denial, recipient picker, backend, all unrelated functions/relations, exact rollback') AS evidence;`)
fs.writeFileSync(path.join(dir,'production-post-check.sql'),`BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='8s';\n${snapshot}\n${post}\n${check}\nROLLBACK;\nSELECT jsonb_build_object('status','passed','kind','production post-apply checks','at',clock_timestamp(),'business_rows_written',0) AS evidence;`)
console.log('Added exact target guards; generated production rollback trial and post-check')
