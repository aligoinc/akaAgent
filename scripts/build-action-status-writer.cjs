const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const m=require('./action-status-policy-migration.cjs');
const directory=path.join(m.root,'migrations/snapshots/action-status-policies-v363');
const before=JSON.parse(fs.readFileSync(path.join(directory,'before.json'),'utf8'));
assert.equal(before.project_ref,m.ref);
const funcs=['aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)',
 'aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)',
 'aka_agent_guard_result_policy_identity_v363()'];
if(!fs.existsSync(path.join(directory,'config-before.json'))) {
 const config=m.snapshot();m.validateSnapshot(config);
 fs.writeFileSync(path.join(directory,'config-before.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
 const absent=m.query(`SELECT jsonb_object_agg(signature,to_regprocedure('public.'||signature) IS NULL) absent FROM unnest(${m.quote('{'+funcs.map(s=>'"'+s+'"').join(',')+'}') }::text[]) signature`)[0].absent;
 assert(Object.values(absent).every(x=>x===true));
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({project_ref:m.ref,before_sha256:m.hash(fs.readFileSync(path.join(directory,'before.json'))),config_sha256:m.hash(fs.readFileSync(path.join(directory,'config-before.json'))),new_functions:funcs,absent},null,2)+'\n',{flag:'wx'});
}
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
assert.equal(manifest.before_sha256,m.hash(fs.readFileSync(path.join(directory,'before.json'))));
assert.equal(manifest.config_sha256,m.hash(fs.readFileSync(path.join(directory,'config-before.json'))));
const config=JSON.parse(fs.readFileSync(path.join(directory,'config-before.json'),'utf8'));
const guards=before.functions.map(f=>`IF to_regprocedure('public.${f.signature}') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.${f.signature}')))<>${m.quote(f.md5)} THEN RAISE EXCEPTION 'v363 live source drift: ${f.signature}'; END IF;`).join('\n');
const absence=funcs.map(f=>`IF to_regprocedure('public.${f}') IS NOT NULL THEN RAISE EXCEPTION 'v363 function already exists: ${f}'; END IF;`).join('\n');
const body=fs.readFileSync(path.join(m.root,'migrations/templates/action-status-writer-v363.sql'),'utf8');
const sql=`-- Verified live dependencies are retained in the v363 snapshot; no existing business RPC is replaced.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
${guards}
${absence}
IF (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)->>'id',to_jsonb(t)->>'code'),'')) FROM public.auto_account_action_status_policies t)<>${m.quote(config.tables.auto_account_action_status_policies.md5)} THEN RAISE EXCEPTION 'v363 policy seed drift'; END IF;
IF EXISTS (SELECT 1 FROM public.auto_account_action_status_policies p JOIN public.auto_status s ON s.id=p.status_id WHERE s.code IN ('campaign_detail_tag_not_found','campaign_detail_invalid_parameter')) THEN RAISE EXCEPTION 'v363 auxiliary seed already configured'; END IF;
END $preflight$;
${body}
COMMIT;
`;
fs.writeFileSync(path.join(m.root,'migrations/migration_v363_action_status_writer.sql'),sql);
console.log(JSON.stringify({functions:funcs,sha256:m.hash(sql),applied:false}));
