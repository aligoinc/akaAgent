// Generate bounded Management API rehearsal/checks. No network or apply here.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/group-sharing-revoke-ownership')
const source = JSON.parse(fs.readFileSync(path.join(dir, 'before.json')))
const target = JSON.parse(fs.readFileSync(path.join(dir, 'target.json')))
const quote = s => "'" + s.replaceAll("'", "''") + "'"
const signature = f => f.signature.startsWith('private.') ? f.signature : 'public.' + f.signature
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261028042624_group_sharing_revoke_ownership_compat.sql'), 'utf8')
const rollback = fs.readFileSync(path.join(root, 'migrations/rollback_group_sharing_revoke_ownership_compat.sql'), 'utf8')
const guards = migration.match(/DO \$guard\$[\s\S]*?END \$guard\$;/g)
assert.equal(guards.length, 2)
const schemas = "('public','private','aka_agent_desktop_internal')"
const fingerprint = masked => `SELECT md5(jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,${masked ? `CASE WHEN p.oid=${quote(signature(target))}::regprocedure THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END` : 'md5(pg_get_functiondef(p.oid))'},p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ${schemas} AND p.prokind='f'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${schemas}),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${schemas} AND a.attnum>0 AND NOT a.attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${schemas}),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${schemas} AND NOT t.tgisinternal)
 )::text)`
const eligibleUsers = `SELECT m.staff_id,m.auth_user_id,s.organization_id,s.username,s.password
 FROM private.aka_agent_desktop_users m JOIN public.org_staff s ON s.id=m.staff_id
 WHERE s.is_active AND s.deleted_at IS NULL AND public.aka_agent_staff_time_allowed(s.id)
 ORDER BY m.staff_id LIMIT 6`
const captureSql = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s';
SELECT clock_timestamp() AS captured_at,'cgjbsmqtfhqvttudyjzq' AS project,
 (SELECT jsonb_agg(jsonb_build_object('signature',w.signature,'definition',pg_get_functiondef(p.oid),'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig) ORDER BY w.signature)
  FROM (VALUES ${source.functions.map(f => '(' + quote(signature(f)) + ')').join(',')}) w(signature) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(w.signature)) AS functions,
 (${fingerprint(false)}) AS full_fingerprint,(${fingerprint(true)}) AS unchanged_fingerprint,
 (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ${schemas} AND p.prokind='f') AS function_count,
 (SELECT count(*) FROM (${eligibleUsers}) u) AS eligible_mappings,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations WHERE name='group_sharing_revoke_ownership_compat') AS migrations;
ROLLBACK;`
// Credentials stay inside the DB. This only exercises reads and rejected writes.
const behavior = `DO $behavior$
DECLARE u record; expected jsonb; actual jsonb; other_campaign bigint; denied boolean; users_checked integer:=0;
BEGIN
 IF has_function_privilege('anon',${quote(signature(target))},'EXECUTE') OR has_function_privilege('authenticated',${quote(signature(target))},'EXECUTE') THEN RAISE EXCEPTION 'legacy sharing access reopened'; END IF;
 IF NOT has_function_privilege('aka_agent_desktop',${quote(signature(target))},'EXECUTE') OR NOT has_function_privilege('service_role',${quote(signature(target))},'EXECUTE') THEN RAISE EXCEPTION 'required sharing access missing'; END IF;
 FOR u IN ${eligibleUsers} LOOP
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',COALESCE(NULLIF(s.name,''),'Nhân viên #'||s.id)) ORDER BY s.name,s.id),'[]'::jsonb) INTO expected FROM public.org_staff s WHERE s.organization_id=u.organization_id AND s.deleted_at IS NULL AND s.is_active AND s.id<>u.staff_id;
  SELECT id INTO other_campaign FROM public.auto_campaigns WHERE staff_id IS DISTINCT FROM u.staff_id ORDER BY id LIMIT 1;
  IF other_campaign IS NULL THEN RAISE EXCEPTION 'foreign campaign sample missing'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','aka_agent_desktop','sub',u.auth_user_id)::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  IF private.aka_agent_staff_scope_for_request() IS DISTINCT FROM u.staff_id THEN RAISE EXCEPTION 'staff binding mismatch'; END IF;
  actual:=public.aka_agent_group_sharing(u.staff_id,u.organization_id,u.username,u.password,'staff','{}');
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'sharing directory changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=other_campaign) THEN RAISE EXCEPTION 'foreign campaign exposed'; END IF;
  denied:=false;
  BEGIN PERFORM public.aka_agent_lock_campaign_input_serialization(other_campaign);
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM='desktop_campaign_scope_denied' THEN denied:=true; ELSE RAISE; END IF; END;
  IF NOT denied THEN RAISE EXCEPTION 'cross-staff lock guard failed'; END IF;
  denied:=false;
  BEGIN PERFORM public.aka_agent_group_sharing(u.staff_id+10000000,u.organization_id,'invalid','invalid','save','{}');
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='group_sharing_access_denied' THEN denied:=true; ELSE RAISE; END IF; END;
  IF NOT denied THEN RAISE EXCEPTION 'foreign sharing identity accepted'; END IF;
  RESET ROLE;
  users_checked:=users_checked+1;
 END LOOP;
 IF users_checked=0 THEN RAISE EXCEPTION 'active mapped users required'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE aka_agent_desktop;
 denied:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(-1,-1,'invalid','invalid','save','{}');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='group_sharing_access_denied' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'missing claims accepted'; END IF;
 RESET ROLE;
 SET LOCAL ROLE anon;
 denied:=false;
 BEGIN PERFORM public.aka_agent_group_sharing(-1,-1,'invalid','invalid','save','{}');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'anon sharing allowed'; END IF;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 IF private.aka_agent_staff_scope_for_request() IS NOT NULL THEN RAISE EXCEPTION 'backend scope changed'; END IF;
 RESET ROLE;
END $behavior$;`
const start = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';\n"
const snapshot = `CREATE TEMP TABLE sharing_revoke_original ON COMMIT DROP AS SELECT (${fingerprint(false)}) AS full_fingerprint,(${fingerprint(true)}) AS unchanged_fingerprint;`
const compare = (column, masked) => `DO $compare$ DECLARE original text; actual text; BEGIN SELECT ${column} INTO original FROM sharing_revoke_original; ${fingerprint(masked)} INTO actual; IF actual IS DISTINCT FROM original THEN RAISE EXCEPTION 'sharing rehearsal metadata changed: ${column}'; END IF; END $compare$;`
const trialSql = start + snapshot + '\n' + migration + '\n' + behavior + '\n' + compare('unchanged_fingerprint', true) + "\nSET LOCAL aka_agent.group_sharing_revoke_rollback='approved';\n" + rollback + '\n' + compare('full_fingerprint', false) + "\nROLLBACK; SELECT true AS production_rollback_trial_passed;\n"
const postSql = start + guards[1] + '\n' + behavior + "\nROLLBACK; SELECT true AS production_postcheck_passed;\n"
module.exports = { captureSql, trialSql, postSql, migration, signature, source, target }
if (require.main === module) {
 for (const [name, sql] of Object.entries({ 'production-capture.sql': captureSql, 'production-trial.sql': trialSql, 'production-post-check.sql': postSql })) fs.writeFileSync(path.join(dir, name), sql)
 console.log('Generated capture, rollback rehearsal and post-check SQL; no network or database changes.')
}
