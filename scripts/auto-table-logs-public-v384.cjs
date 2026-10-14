// DB-only schema move. Production queries use the existing linked Management API.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const audit = path.join(root, 'docs/audits/auto-table-logs-v384')
const name = 'migration_v384_auto_table_logs_public'
const signature = 'private.aka_agent_capture_table_change()'
const ref = 'cgjbsmqtfhqvttudyjzq'
const read = f => fs.readFileSync(path.join(audit, f), 'utf8')
const json = f => JSON.parse(read(f))
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const quote = value => "'" + value.replace(/'/g, "''") + "'"
const ident = value => '"' + value.replace(/"/g, '""') + '"'
const migration = () => fs.readFileSync(path.join(root, 'migrations', name + '.sql'), 'utf8')
const smoke = () => fs.readFileSync(path.join(root, 'migrations/tests', name + '_smoke.sql'), 'utf8')
const snapshotSQL = () => read('snapshot.sql').trim().replace(/;$/, '')
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
const receipt = (file, value) => fs.writeFileSync(path.join(audit, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
function manifest() {
  return { project_ref: ref, migration_sha256: sha(migration()), smoke_sha256: sha(smoke()), before_sha256: sha(read('before.json')) }
}
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v384-query-'))
  try {
    fs.writeFileSync(path.join(dir, 'query.sql'), sql, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', path.join(dir, 'query.sql'), '--output', 'json'],
      { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })).rows
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
function preserved(after) {
  const before = json('before.json')
  const strip = data => structuredClone(data.base.sources).map(s => ({ ...s, triggers: s.triggers.map(t => {
    if (t.name === 'trg_auto_table_log') {
      delete t.function.definition
      delete t.function.md5
    }
    return t
  }) }))
  assert.deepEqual(strip(after), strip(before), 'source schema/triggers/business functions or capture attributes changed')
  assert.deepEqual(after.base.ddl_triggers, before.base.ddl_triggers, 'DDL triggers changed')
  const expected = structuredClone(before.log_catalog)
  expected.schema = 'public'
  expected.sequence.schema = 'public'
  for (const i of expected.indexes) {
    i.schema = 'public'
    i.definition = i.definition.replace('ON private.auto_table_logs ', 'ON public.auto_table_logs ')
  }
  assert.deepEqual(after.log_catalog, expected, 'table/TOAST/index/sequence OIDs, files, owner, columns, RLS, ACL or constraints changed')
  const captures = after.base.sources.flatMap(s => s.triggers.filter(t => t.name === 'trg_auto_table_log'))
  assert.equal(captures.length, 2)
  assert.deepEqual(captures[0].function, captures[1].function)
  assert.equal(after.base.target_table, null, 'old table name remains')
  assert.equal(after.base.target_sequence, null, 'old sequence name remains')
  return captures[0].function
}
const snapshot = () => query(`BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; ${snapshotSQL()}; ROLLBACK;`)[0]
function rollbackSQL(targetMd5) {
  return `-- V384 reverse move only: retain all data and V383 config-only logging.\nBEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.auto_campaigns,public.auto_error IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.auto_table_logs IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF current_user<>'postgres' OR md5(pg_get_functiondef('${signature}'::regprocedure)) IS DISTINCT FROM '${targetMd5}'
    OR to_regclass('private.auto_table_logs') IS NOT NULL OR to_regtype('private.auto_table_logs') IS NOT NULL
    OR to_regclass('private.auto_table_logs_id_seq') IS NOT NULL
    OR to_regclass('private.auto_table_logs_pkey') IS NOT NULL
    OR to_regclass('private.idx_auto_table_logs_record_time') IS NOT NULL THEN
    RAISE EXCEPTION 'v384 rollback drift; inspect current state';
  END IF;
END $guard$;
ALTER TABLE public.auto_table_logs SET SCHEMA private;
${read('source-function.sql')}
DO $verify$ BEGIN
  IF md5(pg_get_functiondef('${signature}'::regprocedure))<>'1cd8e9bc61b39e7ac7f8e6020ba3e953'
    OR pg_get_serial_sequence('private.auto_table_logs','id')<>'private.auto_table_logs_id_seq' THEN
    RAISE EXCEPTION 'v384 rollback contract failed';
  END IF;
END $verify$;
-- Existing DDL watcher reloads schema. Do not delete migration history.\nCOMMIT;\n`
}
function local() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v384-pg-'))
  const bin = process.env.PG_TEST_BINDIR || '/opt/homebrew/opt/postgresql@16/bin'
  const pg = (tool, args) => execFileSync(path.join(bin, tool), args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8*1024*1024, stdio: ['ignore','pipe','pipe'] })
  const psql = sql => {
    fs.writeFileSync(path.join(dir, 'query.sql'), sql)
    return pg('psql', ['-X','-qAt','-h',dir,'-p','25484','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-f',path.join(dir,'query.sql')])
  }
  try {
    pg('initdb', ['-D',path.join(dir,'db'),'-U','postgres','-A','trust','--encoding=UTF8','--locale=C'])
    pg('pg_ctl', ['-D',path.join(dir,'db'),'-l',path.join(dir,'server.log'),'-o',`-h '' -k ${dir} -p 25484 -c max_connections=8`,'-w','start'])
    let seed = 'CREATE SCHEMA private; CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text,statements text[]);\n'
    for (const role of ['anon','authenticated','service_role','aka_agent_chat_api']) seed += `CREATE ROLE ${role}; GRANT USAGE ON SCHEMA public,private TO ${role};\n`
    for (const table of json('before.json').base.sources) {
      seed += `CREATE TABLE public.${ident(table.name)} (${table.columns.map(c => ident(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')+(c.default && !c.default.includes('nextval(')?' DEFAULT '+c.default:'')).join(',')},PRIMARY KEY(id));\n`
      for (const trigger of table.triggers.filter(t => t.name !== 'trg_auto_table_log')) seed += trigger.function.definition + ';\n'
    }
    // Log table DDL is immutable V382; the existing function comes from fresh live capture.
    const v382 = fs.readFileSync(path.join(root, 'migrations/migration_v382_auto_table_logs.sql'), 'utf8')
    seed += v382.slice(v382.indexOf('CREATE TABLE private.auto_table_logs'), v382.indexOf('-- BEGIN CAPTURE FUNCTION'))
    seed += read('source-function.sql') + `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;\n`
    for (const table of json('before.json').base.sources) seed += table.triggers.find(t=>t.name==='trg_auto_table_log').definition+';\n'
    seed += `INSERT INTO private.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('legacy_fixture','{"id":1}','INSERT','{"log":"retained"}');\n`
    psql(seed)
    // Exercise the whole preflight using this disposable cluster's catalog hashes.
    // Production retains the captured live hashes and never substitutes these values.
    const localBefore = JSON.parse(psql(`SELECT row_to_json(snapshot) FROM (${snapshotSQL()}) snapshot;`).trim())
    let localMigration = migration()
    for (const key of ['sources_md5','ddl_md5','catalog_md5']) localMigration = localMigration.replace(json('before.json')[key], localBefore[key])
    // Prepare and execute before and after DDL in the same backend to check cached plans.
    psql(`PREPARE edit_config AS UPDATE public.auto_campaigns SET name=name||'.' WHERE id=1;
      INSERT INTO public.auto_campaigns(id,name) VALUES(1,'cache fixture'); EXECUTE edit_config;
      ${localMigration}
      EXECUTE edit_config;
      DO $cached$ BEGIN IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='auto_campaigns')<>3 THEN RAISE EXCEPTION 'cached source statement did not log after schema move'; END IF; END $cached$;`)
    psql('BEGIN;\n' + smoke() + '\nROLLBACK;')
    assert.equal(psql("SELECT new_data->>'log' FROM public.auto_table_logs WHERE table_name='legacy_fixture';").trim(), 'retained')
    const target = JSON.parse(psql(`SELECT json_build_object('md5',md5(pg_get_functiondef(${quote(signature)}::regprocedure)));`).trim())
    // The table can no longer pass the general public-schema guard: reject recursion.
    psql(`BEGIN; CREATE TRIGGER self_capture AFTER INSERT OR UPDATE ON public.auto_table_logs
      FOR EACH ROW EXECUTE FUNCTION ${signature.replace('()', "('error_config_v1','id')")};
      INSERT INTO public.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('self_fixture','{"id":1}','INSERT','{}');
      DO $self$ BEGIN IF (SELECT count(*) FROM public.auto_table_logs WHERE table_name='self_fixture')<>1
        OR EXISTS(SELECT 1 FROM public.auto_table_logs WHERE table_name='auto_table_logs') THEN RAISE EXCEPTION 'audit self-recursion guard failed'; END IF; END $self$; ROLLBACK;`)
    const reverse = rollbackSQL(target.md5)
    const reversePath = path.join(audit,'rollback.sql')
    if (fs.existsSync(reversePath)) assert.equal(read('rollback.sql'), reverse, 'rollback source drift')
    else fs.writeFileSync(reversePath, reverse, {flag:'wx'})
    psql(reverse)
    assert.equal(psql("SELECT new_data->>'log' FROM private.auto_table_logs WHERE table_name='legacy_fixture';").trim(), 'retained')
    psql(`UPDATE public.auto_campaigns SET name='reverse fixture' WHERE id=1;
      DO $reverse$ BEGIN IF NOT EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='auto_campaigns' AND new_data->>'name'='reverse fixture') THEN RAISE EXCEPTION 'reverse move capture failed'; END IF; END $reverse$;`)
    const file = `local-${stamp()}.json`
    receipt(file, { ...manifest(), at:new Date().toISOString(), verified:true, target_md5:target.md5,
      rollback_sha256:sha(reverse), checks:['configuration filtering','SQL roles','history retained','cached statement invalidation','self-recursion guard','reverse move and capture'] })
    console.log({verified:true,receipt:file,target_md5:target.md5})
  } finally {
    try { pg('pg_ctl', ['-D',path.join(dir,'db'),'-m','immediate','-w','stop']) } catch {}
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
function matchingLocal() {
  const m=manifest()
  const files=fs.readdirSync(audit).filter(f=>/^local-.*\.json$/.test(f)).sort().reverse()
  const result=files.map(json).find(r=>r.verified && r.migration_sha256===m.migration_sha256 && r.smoke_sha256===m.smoke_sha256 && r.before_sha256===m.before_sha256 && r.rollback_sha256===sha(read('rollback.sql')))
  assert(result,'Run matching local verification first')
  return result
}
function rehearse(applied=false) {
  const localResult=matchingLocal()
  const prefix=applied ? "BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';" : migration().replace(/COMMIT;\s*$/,'')
  const result=query(`${prefix}\nSAVEPOINT fixture;\n${smoke()}\nROLLBACK TO fixture;
    WITH snapshot AS (${snapshotSQL()}) SELECT to_jsonb(snapshot) snapshot,clock_timestamp()-transaction_timestamp() duration FROM snapshot;
    ROLLBACK;`)[0]
  const fn=preserved(result.snapshot)
  assert.equal(fn.md5,localResult.target_md5)
  if (!applied) {
    const restored=snapshot()
    assert.deepEqual(restored.log_catalog,json('before.json').log_catalog)
    assert.equal(restored.sources_md5,json('before.json').sources_md5)
  }
  const file=`${applied?'post-smoke':'rehearsal'}-${stamp()}.json`
  receipt(file,{...manifest(),verified:true,rolled_back:true,customer_writes:0,target:fn,duration:result.duration})
  console.log({verified:true,receipt:file,target_md5:fn.md5,duration:result.duration})
}
function apply() {
  const localResult=matchingLocal(),m=manifest()
  const rehearsals=fs.readdirSync(audit).filter(f=>/^rehearsal-.*\.json$/.test(f)).map(json)
  assert(rehearsals.some(r=>r.verified && r.migration_sha256===m.migration_sha256 && r.smoke_sha256===m.smoke_sha256 && r.before_sha256===m.before_sha256 && r.target.md5===localResult.target_md5),'Matching linked rehearsal required')
  assert(!fs.existsSync(path.join(audit,'apply-intent.json')),'Apply already attempted; inspect history and live state, never blind-retry')
  const version=new Date().toISOString().replace(/\D/g,'').slice(0,14)
  receipt('apply-intent.json',{...m,history_version:version,at:new Date().toISOString()})
  const sql=migration()
  const result=query(sql.replace(/COMMIT;\s*$/,()=>`
    DO $target$ BEGIN IF md5(pg_get_functiondef(${quote(signature)}::regprocedure)) IS DISTINCT FROM ${quote(localResult.target_md5)} THEN RAISE EXCEPTION 'v384 target mismatch'; END IF; END $target$;
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
    SELECT true applied,clock_timestamp()-transaction_timestamp() duration;
    COMMIT;`))[0]
  assert.equal(result.applied,true)
  receipt('apply.json',{...m,...result,history_version:version,at:new Date().toISOString()})
  console.log(result)
}
function verify() {
  const after=snapshot(),fn=preserved(after),localResult=matchingLocal()
  assert.equal(fn.md5,localResult.target_md5)
  const history=query(`SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
  assert.equal(history.length,1)
  assert.equal(history[0].version,json('apply.json').history_version)
  assert.deepEqual(history[0].statements,[migration()])
  const file=`verification-${stamp()}.json`
  receipt(file,{...manifest(),verified:true,target:fn,after})
  console.log({verified:true,receipt:file,target_md5:fn.md5,table_oid:after.log_catalog.oid,heap_file:after.log_catalog.relfilenode})
}
async function api() {
  const source=fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8')
  const key=source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const results=[]
  for(const table of ['auto_campaigns','auto_error','auto_table_logs']) {
    const response=await fetch(`https://${ref}.supabase.co/rest/v1/${table}?select=id&limit=0`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)})
    const body=await response.json()
    if (table==='auto_table_logs') { assert([401,403].includes(response.status)); assert.equal(body.code,'42501') }
    else { assert.equal(response.status,200); assert.deepEqual(body,[]) }
    results.push({table,status:response.status,customer_rows:0,...(table==='auto_table_logs'?{code:body.code}:{})})
  }
  receipt(`api-${stamp()}.json`,{at:new Date().toISOString(),results})
  console.log(results)
}
async function main() {
  switch(process.argv[2]) {
    case 'local': return local()
    case 'rehearse': return rehearse()
    case 'post-smoke': return rehearse(true)
    case 'apply': return apply()
    case 'verify': return verify()
    case 'api': return api()
    default: throw new Error('Use local | rehearse | apply | verify | post-smoke | api')
  }
}
main().catch(err=>{console.error(err.message);if(err.stderr) console.error(err.stderr.toString());process.exitCode=1})
