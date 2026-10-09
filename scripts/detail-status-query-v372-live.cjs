// Rollback rehearsals and single-migration apply, via the existing linked API.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const v = require('./detail-status-query-v372.cjs')
const q = x => x == null ? 'NULL' : typeof x === 'number' ? String(x) : v.quote(x)
const cases = []
function add(name,scope,options={}) {
  for(const version of [1,2]) {
    const a = {...{search:null,status:null,from:null,to:null,offset:0,limit:100,sort:'created_desc',engagement:null},...options}
    const args=[...scope,a.search,a.status,a.from,a.to,a.offset,a.limit,a.sort,null,null]
    if(version===2) args.push(a.engagement)
    cases.push({name:name+'_v'+version,sql:`SELECT public.aka_agent_list_campaign_details_page${version===2?'_v2':''}(${args.map(q)})`,samples:options.samples||1})
  }
}
for(const [staff,org,campaign] of [[385,365,7370],[521,500,10022],[659,636,11980]]) {
  for(const status of [null,'thành công','chờ duyệt bài']) add(`${staff}_${status===null?'all':status==='thành công'?'success':'sub'}`,[staff,org,campaign],{status,samples:3})
}
add('deep_page',[659,636,11980],{offset:30000,status:'thành công'})
add('empty_page',[385,365,7370],{offset:400000,status:'thành công'})
add('search_secondary',[659,636,11980],{search:'Chờ duyệt bài'})
add('combined_filters',[385,365,7370],{status:'thành công',search:'zalo',from:'2026-09-01',to:'2026-10-10',offset:10,limit:17,sort:'created_asc',engagement:'none',samples:3})
add('case_whitespace',[521,500,10022],{status:'  THÀNH CÔNG  ',limit:3})
add('unknown_status',[659,636,11980],{status:'__missing_v372__'})
add('managed_not_found',[1123,990,25449],{status:'không tồn tại',samples:3})
add('managed_success',[1123,990,25449],{status:'thành công',samples:3})
add('ownership',[385,365,11980])
add('invalid_sort',[385,365,7370],{sort:'x'})
add('invalid_dates',[385,365,7370],{from:'2026-10-10',to:'2026-10-01'})
function verifyFiles() {
  assert.equal(fs.readFileSync(path.join(v.root,'migrations',v.name+'.sql'),'utf8'),v.migration)
  assert.equal(fs.readFileSync(path.join(v.dir,'rollback.sql'),'utf8'),v.rollback)
  assert.equal(v.read('build-manifest.json').migration_sha256,v.hash(v.migration))
  assert.equal(v.read('local-smoke.json').migration_sha256,v.hash(v.migration))
}
const service = "SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role';"
const reset = 'RESET ROLE;'
const boundary = expected => `DO $guard$ BEGIN ${v.guards(expected)} END $guard$;`
function measure(phase) {
  return `${service}
DO $measure$
DECLARE c record; payload jsonb; plan jsonb; timings jsonb; result_hash text; result_total bigint; failure text;
BEGIN
  FOR c IN SELECT * FROM v372_cases ORDER BY name LOOP
    payload:=NULL; timings:='[]'::jsonb; failure:=NULL;
    BEGIN
      EXECUTE c.sql INTO payload;
      FOR i IN 1..c.samples LOOP
        EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '||c.sql INTO plan;
        timings:=timings||jsonb_build_array(jsonb_build_object('ms',plan->0->'Execution Time',
          'hit_blocks',plan->0->'Plan'->'Shared Hit Blocks','read_blocks',plan->0->'Plan'->'Shared Read Blocks'));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN failure:=SQLSTATE||':'||SQLERRM;
    END;
    INSERT INTO v372_results VALUES(c.name,${q(phase)},md5(payload::text),(payload->>'total')::bigint,
      jsonb_array_length(payload->'items'),failure,timings);
  END LOOP;
END $measure$;
${reset}`
}
function smoke(applied=false) {
  verifyFiles()
  const expected = applied?v.targets:v.before.functions
  v.check(v.query(`SELECT ${v.functionRows()} functions`)[0].functions,expected)
  // REPEATABLE READ compares complete JSON against exactly the same data,
  // including active campaigns receiving results while this rehearsal runs.
  const begin=`BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
${boundary(expected)}
CREATE TEMP TABLE v372_cases(name text,sql text,samples integer) ON COMMIT DROP;
CREATE TEMP TABLE v372_results(name text,phase text,hash text,total bigint,item_count integer,error text,timings jsonb) ON COMMIT DROP;
GRANT ALL ON v372_cases,v372_results TO service_role;
INSERT INTO v372_cases VALUES ${cases.map(c=>`(${q(c.name)},${q(c.sql)},${c.samples})`).join(',')};`
  // Post-apply rehearsal restores the old body only inside the rolled-back
  // transaction; other sessions continue seeing the committed current body.
  const sql=`${begin}
${applied?v.before.functions.map(f=>f.definition+';').join('\n'):''}
${boundary(v.before.functions)}
${measure('before')}
${v.targets.map(f=>f.definition+';').join('\n')}
${boundary(v.targets)}
${measure('after')}
DO $check$ BEGIN
  IF EXISTS(SELECT 1 FROM v372_results a JOIN v372_results b USING(name)
    WHERE a.phase='before' AND b.phase='after' AND (a.hash IS DISTINCT FROM b.hash OR a.error IS DISTINCT FROM b.error))
  THEN RAISE EXCEPTION 'v372 result/guard mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM v372_results WHERE error IS NOT NULL AND name NOT LIKE 'ownership_%' AND name NOT LIKE 'invalid_%')
  THEN RAISE EXCEPTION 'v372 unexpected RPC error'; END IF;
END $check$;
SELECT true verified,${v.functionRows()} functions,(SELECT jsonb_agg(to_jsonb(r) ORDER BY name,phase) FROM v372_results r) measurements;
${v.rollback.replace(/^.*?BEGIN;/s,'').replace(/COMMIT;\s*$/,'')}
${boundary(v.before.functions)}
ROLLBACK;`
  fs.writeFileSync(path.join(v.dir,applied?'post-smoke.sql':'live-smoke.sql'),sql,{flag:'wx'})
  const result=v.query(sql)[0]
  assert.equal(result.verified,true);v.check(result.functions,v.targets)
  v.save(applied?'post-smoke.json':'live-smoke.json',{at:new Date().toISOString(),project_ref:v.ref,migration_sha256:v.hash(v.migration),rolled_back:true,production_data_writes:0,...result})
  v.check(v.query(`SELECT ${v.functionRows()} functions`)[0].functions,expected)
  console.log({verified:true,cases:cases.length,rolled_back:true,guards:result.measurements.filter(x=>x.phase==='after'&&x.error).map(x=>({name:x.name,error:x.error}))})
  for(const c of cases.filter(x=>x.samples===3)) console.log({name:c.name,...Object.fromEntries(result.measurements.filter(x=>x.name===c.name).map(x=>[x.phase,x.timings.map(y=>y.ms)]))})
}
function apply() {
  verifyFiles()
  assert.equal(v.read('live-smoke.json').migration_sha256,v.hash(v.migration))
  assert(!fs.existsSync(path.join(v.dir,'apply.json')),'Already applied; inspect live history')
  const history=new Date().toISOString().replace(/\D/g,'').slice(0,14)
  v.save('apply-intent.json',{at:new Date().toISOString(),project_ref:v.ref,history_version:history,name:v.name,migration_sha256:v.hash(v.migration)})
  const sql=v.migration.replace(/COMMIT;\s*$/,()=>`
DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v372_%') THEN RAISE EXCEPTION 'v372 already recorded'; END IF; END $$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${q(history)},${q(v.name)},ARRAY[${q(v.migration)}]);
SELECT true applied,${v.functionRows()} functions;
COMMIT;`)
  const result=v.query(sql)[0];assert.equal(result.applied,true);v.check(result.functions,v.targets)
  v.save('apply.json',{at:new Date().toISOString(),project_ref:v.ref,history_version:history,name:v.name,migration_sha256:v.hash(v.migration),...result})
  verify()
}
function verify() {
  const result=v.query(`BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SELECT clock_timestamp() captured_at,${v.functionRows()} functions,
    (SELECT jsonb_agg(to_jsonb(i)) FROM pg_indexes i WHERE schemaname='public' AND tablename IN ('auto_campaign_details','auto_status')) indexes,
    (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name=${q(v.name)}) history; ROLLBACK;`)[0]
  v.check(result.functions,v.targets)
  const sort = x => [...x].sort((a,b)=>a.indexname.localeCompare(b.indexname))
  assert.deepEqual(sort(result.indexes),sort(v.before.indexes))
  assert.equal(result.history.length,1)
  v.save('after.json',result)
  v.save('after-manifest.json',{at:new Date().toISOString(),project_ref:v.ref,after_sha256:v.hash(fs.readFileSync(path.join(v.dir,'after.json'))),rollback_sha256:v.hash(v.rollback),verified:true})
  console.log({verified:true,history:result.history})
}
if(require.main===module) {
  const commands={smoke,'post-smoke':()=>smoke(true),apply,verify}
  assert(commands[process.argv[2]],'smoke|post-smoke|apply|verify')
  commands[process.argv[2]]()
}
module.exports={cases,smoke}
