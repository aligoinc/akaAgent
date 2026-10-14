// DB-only rollout and repeatable isolated smoke; no application imports/connections.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const audit = path.join(root, 'docs/audits/auto-table-logs-v383')
const name = 'migration_v383_auto_table_config_logs'
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
const receipt = (file, value) => fs.writeFileSync(path.join(audit, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
function manifest() {
  return { project_ref: ref, migration_sha256: sha(migration()), smoke_sha256: sha(smoke()), before_sha256: sha(read('before.json')) }
}
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v383-query-'))
  try {
    fs.writeFileSync(path.join(dir, 'query.sql'), sql, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', path.join(dir, 'query.sql'), '--output', 'json'],
      { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })).rows
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
function preserved(after) {
  const before = json('before.json')
  const strip = data => structuredClone(data.sources).map(s => ({ ...s, triggers: s.triggers.filter(t => t.name !== 'trg_auto_table_log') }))
  assert.deepEqual(strip(after), strip(before), 'business schema/triggers/functions changed')
  assert.deepEqual(after.ddl_triggers, before.ddl_triggers, 'DDL triggers changed')
  const captures = after.sources.flatMap(s => s.triggers.filter(t => t.name === 'trg_auto_table_log'))
  assert.equal(captures.length, 2)
  for (const t of captures) {
    assert.equal(t.enabled, 'O')
    assert.equal(t.function.owner, 'postgres')
    assert.equal(t.function.security_definer, true)
    assert.equal(t.function.volatility, 'v')
    assert.deepEqual(t.function.config, ['search_path=pg_catalog'])
    assert.deepEqual(t.function.acl, ['postgres=X/postgres'])
  }
  assert.deepEqual(captures[0].function, captures[1].function)
  return captures[0].function
}
const snapshot = () => query(`BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; ${snapshotSQL()}; ROLLBACK;`)[0]
function local() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v383-pg-'))
  const bin = process.env.PG_TEST_BINDIR || '/opt/homebrew/opt/postgresql@16/bin'
  const pg = (tool, args) => execFileSync(path.join(bin, tool), args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8*1024*1024, stdio: ['ignore','pipe','pipe'] })
  const psql = sql => {
    fs.writeFileSync(path.join(dir, 'query.sql'), sql)
    return pg('psql', ['-X','-qAt','-h',dir,'-p','25483','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-f',path.join(dir,'query.sql')])
  }
  try {
    pg('initdb', ['-D',path.join(dir,'db'),'-U','postgres','-A','trust','--encoding=UTF8','--locale=C'])
    pg('pg_ctl', ['-D',path.join(dir,'db'),'-l',path.join(dir,'server.log'),'-o',`-h '' -k ${dir} -p 25483 -c max_connections=8`,'-w','start'])
    let seed = 'CREATE SCHEMA private;\n'
    for (const role of ['anon','authenticated','service_role','aka_agent_chat_api']) seed += `CREATE ROLE ${role}; GRANT USAGE ON SCHEMA public,private TO ${role};\n`
    for (const table of json('before.json').sources) {
      seed += `CREATE TABLE public.${ident(table.name)} (${table.columns.map(c => ident(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')+(c.default && !c.default.includes('nextval(')?' DEFAULT '+c.default:'')).join(',')},PRIMARY KEY(id));\n`
      for (const trigger of table.triggers.filter(t => t.name !== 'trg_auto_table_log')) seed += trigger.function.definition + ';\n'
    }
    // Original log DDL only; existing capture body comes from this turn's live snapshot.
    const v382 = fs.readFileSync(path.join(root, 'migrations/migration_v382_auto_table_logs.sql'), 'utf8')
    seed += v382.slice(v382.indexOf('CREATE TABLE private.auto_table_logs'), v382.indexOf('-- BEGIN CAPTURE FUNCTION'))
    seed += read('source-function.sql') + `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;\n`
    seed += "INSERT INTO private.auto_table_logs(table_name,record_pk,operation,new_data) VALUES('legacy_fixture','{\"id\":1}','INSERT','{\"log\":\"retained\"}');\n"
    psql(seed)
    psql('BEGIN;\n' + migration().split('$preflight$;')[1])
    psql('BEGIN;\n' + smoke() + '\nROLLBACK;')
    assert.equal(psql("SELECT new_data->>'log' FROM private.auto_table_logs WHERE table_name='legacy_fixture';").trim(), 'retained')
    const target = JSON.parse(psql(`SELECT json_build_object('md5',md5(pg_get_functiondef(${quote(signature)}::regprocedure)));`).trim())
    const detach=read('rollback.sql').replace(/^BEGIN;$/m,'').replace(/COMMIT;\s*$/,'')
    psql(`BEGIN; ${detach}
      DO $retained$ BEGIN
        IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_auto_table_log'
          AND tgrelid IN ('public.auto_campaigns'::regclass,'public.auto_error'::regclass))
          OR NOT EXISTS(SELECT 1 FROM private.auto_table_logs WHERE table_name='legacy_fixture' AND new_data->>'log'='retained') THEN
          RAISE EXCEPTION 'rollback must detach only capture triggers and retain history';
        END IF;
      END $retained$; ROLLBACK;`)
    const benchmark = []
    // One warmed connection per scenario, same 256-KiB incompressible source log.
    for (const mode of ['v382_runtime', 'v383_runtime', 'v383_config']) {
      const body = mode === 'v382_runtime' ? read('source-function.sql') : migration().split('$preflight$;')[1].split('CREATE OR REPLACE TRIGGER')[0]
      const args = mode === 'v382_runtime' ? "'id'" : "'campaign_config_v1','id'"
      const stmt = mode === 'v383_config' ? "name=name||'.'" : "log=log||'.',updated_at=clock_timestamp()"
      let sql = `BEGIN; ${body}
        CREATE TABLE public.__v383_bench (LIKE public.auto_campaigns INCLUDING DEFAULTS);
        INSERT INTO public.__v383_bench(id,name,log) SELECT 1,'bench',string_agg(md5(i::text),'') FROM generate_series(1,8192)i;
        CREATE TRIGGER capture AFTER INSERT OR UPDATE ON public.__v383_bench FOR EACH ROW EXECUTE FUNCTION ${signature.replace('()', '('+args+')')};
        UPDATE public.__v383_bench SET ${stmt};`
      for (let i=0; i<5; i++) sql += `
        SELECT pg_current_wal_insert_lsn() AS before_lsn \\gset
        EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) UPDATE public.__v383_bench SET ${stmt};
        SELECT json_build_object('wal_bytes',pg_wal_lsn_diff(pg_current_wal_insert_lsn(),:'before_lsn'));`
      sql += "SELECT json_build_object('log_count',count(*),'payload_bytes',coalesce(sum(pg_column_size(old_data)+pg_column_size(new_data)),0)) FROM private.auto_table_logs WHERE table_name='__v383_bench'; ROLLBACK;"
      // JSON EXPLAIN spans multiple lines: parse successive top-level JSON values.
      const output = psql(sql)
      const values = []
      let start = 0, depth = 0, quoted = false, escaped = false
      for (let i=0; i<output.length; i++) {
        const ch=output[i]
        if (quoted) { if (escaped) escaped=false; else if(ch==='\\') escaped=true; else if(ch==='"') quoted=false; continue }
        if (ch==='"') quoted=true
        else if(ch==='[' || ch==='{') { if(depth++===0) start=i }
        else if(ch===']' || ch==='}') { if(--depth===0) values.push(JSON.parse(output.slice(start,i+1))) }
      }
      benchmark.push({ mode, execution_ms: values.filter(Array.isArray).map(v=>v[0]['Execution Time']), wal_bytes: values.filter(v=>v.wal_bytes!==undefined).map(v=>v.wal_bytes), totals:values.at(-1) })
    }
    // Each invocation writes a new receipt; committed rollout evidence stays immutable.
    const file = `local-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
    receipt(file, { ...manifest(), at:new Date().toISOString(), verified:true, target_md5:target.md5, benchmark })
    console.log(JSON.stringify({ verified:true, receipt:file, ...target, benchmark },null,2))
  } finally {
    try { pg('pg_ctl', ['-D',path.join(dir,'db'),'-m','immediate','-w','stop']) } catch {}
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
function matchingLocal() {
  const m=manifest()
  const files=fs.readdirSync(audit).filter(f=>/^local-.*\.json$/.test(f)).sort().reverse()
  const result=files.map(json).find(r=>r.verified && r.migration_sha256===m.migration_sha256 && r.smoke_sha256===m.smoke_sha256 && r.before_sha256===m.before_sha256)
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
  const file=`${applied?'post-smoke':'rehearsal'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
  receipt(file,{...manifest(),verified:true,rolled_back:true,customer_writes:0,target:fn,duration:result.duration})
  console.log({verified:true,receipt:file,target_md5:fn.md5,duration:result.duration})
}
function apply() {
  const localResult=matchingLocal(),m=manifest()
  const rehearsals=fs.readdirSync(audit).filter(f=>/^rehearsal-.*\.json$/.test(f)).map(json)
  assert(rehearsals.some(r=>r.verified && r.migration_sha256===m.migration_sha256 && r.smoke_sha256===m.smoke_sha256 && r.target.md5===localResult.target_md5),'Matching linked rehearsal required')
  assert(!fs.existsSync(path.join(audit,'apply-intent.json')),'Apply already attempted; inspect history and live state, never blind-retry')
  const version=new Date().toISOString().replace(/\D/g,'').slice(0,14)
  receipt('apply-intent.json',{...m,history_version:version,at:new Date().toISOString()})
  const sql=migration()
  const result=query(sql.replace(/COMMIT;\s*$/,()=>`
    DO $target$ BEGIN IF md5(pg_get_functiondef(${quote(signature)}::regprocedure)) IS DISTINCT FROM ${quote(localResult.target_md5)} THEN RAISE EXCEPTION 'v383 target mismatch'; END IF; END $target$;
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
    SELECT true applied,clock_timestamp()-transaction_timestamp() duration,coalesce((SELECT max(id) FROM private.auto_table_logs),0) log_id_boundary;
    COMMIT;`))[0]
  assert.equal(result.applied,true)
  receipt('apply.json',{...m,...result,history_version:version,at:new Date().toISOString()})
  console.log(result)
}
function verify() {
  const after=snapshot(),fn=preserved(after),localResult=matchingLocal()
  assert.equal(fn.md5,localResult.target_md5)
  for (const s of after.sources) {
    const trigger=s.triggers.find(t=>t.name==='trg_auto_table_log')
    const profile=s.name==='auto_campaigns'?'campaign_config_v1':'error_config_v1'
    assert(trigger.definition.includes(`('${profile}', 'id')`))
  }
  const history=query(`SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
  assert.equal(history.length,1)
  assert.equal(history[0].version,json('apply.json').history_version)
  assert.deepEqual(history[0].statements,[migration()])
  const file=`verification-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
  receipt(file,{...manifest(),verified:true,target:fn,after})
  console.log({verified:true,receipt:file,target_md5:fn.md5})
}
async function api() {
  const source=fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8')
  const key=source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const results=[]
  for(const table of ['auto_campaigns','auto_error']) {
    const response=await fetch(`https://${ref}.supabase.co/rest/v1/${table}?select=id&limit=0`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)})
    assert.equal(response.status,200);assert.deepEqual(await response.json(),[])
    results.push({table,status:response.status,customer_rows:0})
  }
  receipt(`api-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,{at:new Date().toISOString(),results})
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
