// DB-only verification/deployment tooling. No application runtime imports.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'docs/audits/auto-table-logs-v382')
const ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v382_auto_table_logs'
const signature = 'private.aka_agent_capture_table_change()'
const read = f => fs.readFileSync(path.join(dir, f), 'utf8')
const json = f => JSON.parse(read(f))
const hash = s => crypto.createHash('sha256').update(s).digest('hex')
const quote = s => "'" + s.replace(/'/g, "''") + "'"
const ident = s => '"' + s.replace(/"/g, '""') + '"'
const write = (f, value) => fs.writeFileSync(path.join(dir, f), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const migration = () => fs.readFileSync(path.join(root, 'migrations', name + '.sql'), 'utf8')
const smokeSQL = () => fs.readFileSync(path.join(root, 'migrations/tests', name + '_smoke.sql'), 'utf8')
const snapshotSQL = () => read('snapshot.sql').trim().replace(/;$/, '')
const rollbackBody = () => read('rollback.sql').replace(/^BEGIN;$/m,'').replace(/COMMIT;\s*$/,'')
const rollbackTest = () => `SAVEPOINT detach;
  ${rollbackBody()}
  DO $retained$ BEGIN
    IF to_regclass('private.auto_table_logs') IS NULL
       OR (SELECT count(*) FROM private.auto_table_logs WHERE table_name='__v382_campaign_fixture')<16
       OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_auto_table_log'
          AND tgrelid IN ('public.auto_campaigns'::regclass,'public.auto_error'::regclass)) THEN
      RAISE EXCEPTION 'v382 rollback must detach only registrations and retain history';
    END IF;
  END $retained$;
  ROLLBACK TO detach;`
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v382-query-'))
  try {
    fs.writeFileSync(path.join(temp, 'query.sql'), sql, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', path.join(temp, 'query.sql'), '--output', 'json'],
      { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })).rows
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const snapshot = () => query(snapshotSQL())[0]
function preserved(after, applied) {
  const before = json('before.json')
  assert.deepEqual(after.ddl_triggers, before.ddl_triggers, 'Existing event triggers changed')
  const stripped = structuredClone(after.sources)
  if (applied) for (const t of stripped) t.triggers = t.triggers.filter(x => x.function.signature !== signature)
  assert.deepEqual(stripped, before.sources, 'Existing columns/constraints/ACLs/triggers/functions changed')
  if (!applied) {
    assert.equal(after.target_table, null)
    assert.equal(after.target_sequence, null)
    assert.equal(after.target_signature, null)
    assert.deepEqual(after.target_overloads, [])
  }
}
function target(after) {
  assert.equal(after.target_table, 'private.auto_table_logs')
  assert.equal(after.target_signature, signature)
  assert.deepEqual(after.target_overloads, [signature])
  const captures = after.sources.flatMap(t => t.triggers.filter(x => x.function.signature === signature))
  assert.equal(captures.length, 2)
  for (const t of captures) {
    assert.equal(t.name, 'trg_auto_table_log')
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
function manifest() {
  const m = { project_ref: ref, before_sha256: hash(read('before.json')), snapshot_sha256: hash(read('snapshot.sql')),
    migration_sha256: hash(migration()), smoke_sha256: hash(smokeSQL()), rollback_sha256:hash(read('rollback.sql')) }
  if (fs.existsSync(path.join(dir, 'manifest.json'))) assert.deepEqual(json('manifest.json'), m)
  else write('manifest.json', m)
  return m
}
function rehearse(applied = false) {
  const m = manifest()
  const localResult = json('local-verification.json')
  assert.equal(localResult.verified, true)
  assert.equal(localResult.migration_sha256, m.migration_sha256)
  assert.equal(localResult.smoke_sha256, m.smoke_sha256)
  const before = snapshot()
  preserved(before, applied)
  if (applied) target(before)
  const prefix = applied ? "BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';" : migration().replace(/COMMIT;\s*$/, '')
  // DROP TRIGGER needs ACCESS EXCLUSIVE. Exercise detach/retain on isolated
  // PostgreSQL only; do not upgrade a lock on live busy source tables in smoke.
  const result = query(`${prefix}\nSAVEPOINT fixture;\n${smokeSQL()}\nROLLBACK TO fixture;
    WITH snapshot AS (${snapshotSQL()}) SELECT true verified,pg_has_role(current_user,'aka_agent_chat_api','SET') chat_role_executed,
      clock_timestamp()-transaction_timestamp() duration,to_jsonb(snapshot) snapshot FROM snapshot;
    ROLLBACK;`)[0]
  preserved(result.snapshot, true)
  const func = target(result.snapshot)
  if (applied) assert.deepEqual(func, json('rehearsal.json').target)
  preserved(snapshot(), applied)
  write(applied ? 'post-apply-smoke.json' : 'rehearsal.json', { ...m, at: new Date().toISOString(), verified: true,
    rolled_back: true, customer_writes: 0, target: func, duration: result.duration,chat_role_executed:result.chat_role_executed })
  console.log({ verified: true, applied, duration: result.duration, target_md5: func.md5 })
}
function apply() {
  const m = manifest()
  const rehearsal = json('rehearsal.json')
  assert.equal(rehearsal.verified, true)
  assert.equal(rehearsal.migration_sha256, m.migration_sha256)
  assert.equal(rehearsal.smoke_sha256, m.smoke_sha256)
  assert.equal(json('local-verification.json').verified, true)
  assert.equal(json('local-verification.json').migration_sha256, m.migration_sha256)
  assert.equal(json('local-verification.json').smoke_sha256, m.smoke_sha256)
  assert(!fs.existsSync(path.join(dir, 'apply-intent.json')), 'Apply already attempted. Inspect history/objects; never retry an unknown outcome.')
  preserved(snapshot(), false)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  write('apply-intent.json', { ...m, at: new Date().toISOString(), history_version: version })
  const sql = migration()
  const result = query(sql.replace(/COMMIT;\s*$/, () => `
    DO $target$ BEGIN
      IF md5(pg_get_functiondef(${quote(signature)}::regprocedure)) IS DISTINCT FROM ${quote(rehearsal.target.md5)} THEN
        RAISE EXCEPTION 'v382 target checksum mismatch';
      END IF;
    END; $target$;
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      VALUES(${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
    SELECT true applied,clock_timestamp()-transaction_timestamp() duration;
    COMMIT;`))[0]
  assert.equal(result.applied, true)
  write('apply.json', { ...m, ...result, at: new Date().toISOString(), history_version: version })
  console.log({ ...result, history_version: version })
}
function verify() {
  manifest()
  const after = snapshot()
  preserved(after, true)
  const func = target(after)
  assert.deepEqual(func, json('rehearsal.json').target)
  const history = query(`SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
  assert.equal(history.length, 1)
  assert.equal(history[0].version, json('apply.json').history_version)
  assert.deepEqual(history[0].statements, [migration()])
  // No snapshot payload/customer values are returned or persisted in receipts.
  const catalog = query(`SELECT c.relrowsecurity,pg_get_userbyid(c.relowner) owner,c.relacl,
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
    (SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname='private' AND tablename='auto_table_logs') indexes
    FROM pg_class c WHERE c.oid='private.auto_table_logs'::regclass;`)[0]
  assert.equal(catalog.relrowsecurity, true)
  assert.equal(catalog.owner, 'postgres')
  assert.deepEqual(catalog.columns.map(c => c.name), ['id','created_at','table_name','record_pk','operation','old_data','new_data'])
  write('after.json', after)
  write('verification.json', { at: new Date().toISOString(), verified: true, project_ref: ref,
    target_md5: func.md5, history_version: history[0].version, after_sha256: hash(read('after.json')), catalog })
  console.log({ verified: true, target_md5: func.md5 })
}
async function api() {
  const source = fs.readFileSync(path.join(root, 'src/main/data/supabaseClient.ts'), 'utf8')
  const key = source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const results = []
  for (const table of ['auto_campaigns','auto_error']) {
    const response = await fetch(`https://${ref}.supabase.co/rest/v1/${table}?select=id&limit=0`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), [])
    results.push({ table, status: response.status, customer_rows_returned: 0 })
  }
  const privateResponse = await fetch(`https://${ref}.supabase.co/rest/v1/auto_table_logs?select=id&limit=0`,
    { headers: { apikey:key,Authorization:`Bearer ${key}`,'Accept-Profile':'private' },signal:AbortSignal.timeout(15000) })
  assert([401,403,404,406].includes(privateResponse.status),'Private log must not be readable through anon Data API')
  results.push({ table:'private.auto_table_logs',status:privateResponse.status,access_denied:true })
  write('api-after.json', { at: new Date().toISOString(), results })
  console.log(results)
}
function local() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v382-pg-'))
  const bin = process.env.PG_TEST_BINDIR || '/opt/homebrew/opt/postgresql@16/bin'
  const pg = (tool, args) => execFileSync(path.join(bin, tool), args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8*1024*1024, stdio: ['ignore','pipe','pipe'] })
  const psql = sql => {
    fs.writeFileSync(path.join(temp, 'query.sql'), sql)
    return pg('psql', ['-X','-qAt','-h',temp,'-p','25482','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-f',path.join(temp,'query.sql')])
  }
  try {
    pg('initdb', ['-D',path.join(temp,'db'),'-U','postgres','-A','trust','--encoding=UTF8','--locale=C'])
    pg('pg_ctl', ['-D',path.join(temp,'db'),'-l',path.join(temp,'server.log'),'-o',`-h '' -k ${temp} -p 25482 -c max_connections=8`,'-w','start'])
    const before = json('before.json')
    let seed = 'CREATE SCHEMA private;\n'
    for (const role of ['anon','authenticated','service_role','aka_agent_chat_api','v382_extra_default_role']) seed += `CREATE ROLE ${role}; GRANT USAGE ON SCHEMA public,private TO ${role};\n`
    // Adversarial default grants verify that migration revokes project-specific roles too.
    seed += 'ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ALL ON TABLES TO v382_extra_default_role;\nALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ALL ON SEQUENCES TO v382_extra_default_role;\nALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ALL ON FUNCTIONS TO v382_extra_default_role;\n'
    for (const t of before.sources) {
      seed += `CREATE TABLE public.${ident(t.name)} (${t.columns.map(c => ident(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')+(c.default && !c.default.includes('nextval(')?' DEFAULT '+c.default:'')).join(',')},PRIMARY KEY(id));\n`
      for (const trigger of t.triggers) seed += trigger.function.definition + ';\n'
    }
    psql(seed)
    // The captured production preflight is exercised on linked rehearsal.
    // Local fixture schemas intentionally omit unrelated business dependencies.
    const body = migration().split('$preflight$;')[1]
    assert(body && !body.includes('SOURCE_SNAPSHOT_PREFLIGHT'))
    psql('BEGIN;\n' + body)
    psql('BEGIN;\n' + smokeSQL() + '\n' + rollbackTest() + '\nROLLBACK;')
    // Actual auto_error name matters to its live component guard. Use the exact
    // captured definition on an isolated source fixture, never production rows.
    const error = before.sources.find(t => t.name==='auto_error')
    const errorTrigger = error.triggers[0]
    psql(`CREATE TABLE public.auto_status(id bigint PRIMARY KEY,component_type text);
      INSERT INTO public.auto_status VALUES(1,'campaign_detail'),(2,'other');
      ${errorTrigger.definition};
      INSERT INTO public.auto_error(id,error_type,error_name,error_code,detail_status_id) VALUES(382001,'fixture','fixture','fixture',1);
      DO $t$ BEGIN
        BEGIN UPDATE public.auto_error SET detail_status_id=2 WHERE id=382001;
          RAISE EXCEPTION 'live error component guard not preserved';
        EXCEPTION WHEN check_violation THEN NULL; END;
        IF (SELECT count(*) FROM private.auto_table_logs WHERE table_name='auto_error')<>1 THEN RAISE EXCEPTION 'source binding/failed write log'; END IF;
      END $t$;`)
    const func = JSON.parse(psql(`SELECT json_build_object('md5',md5(pg_get_functiondef(${quote(signature)}::regprocedure)));`).trim())
    const benchmark = localBenchmark(psql,temp)
    write('local-verification.json', { at: new Date().toISOString(), verified: true, migration_sha256: hash(migration()), smoke_sha256: hash(smokeSQL()),
      postgres: psql('SHOW server_version;').trim(), target_md5: func.md5, source_preflight: 'verified separately on linked rollback rehearsal', benchmark })
    console.log({ verified: true, ...func, storage: benchmark.storage,
      timings: benchmark.results.map(r => ({ size:r.size,enabled:r.enabled,
        milliseconds:r.trials.map(t=>t['Execution Time']),wal_bytes:r.trials.map(t=>t.total_wal_bytes) })) })
  } finally {
    try { pg('pg_ctl', ['-D',path.join(temp,'db'),'-m','immediate','-w','stop']) } catch {}
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
function localBenchmark(psql,temp) {
  const results = []
  // Fixed fixture data, source row shape from the captured live campaign table.
  // EXPLAIN ANALYZE/WAL measures synchronous statement cost, not commit latency.
  psql(`CREATE TABLE public.__v382_bench (LIKE public.auto_campaigns INCLUDING DEFAULTS);
    INSERT INTO public.__v382_bench(id,name,status,log) VALUES(1,'benchmark','chờ xử lý','small');`)
  for (const size of ['small','large']) {
    psql(`UPDATE public.__v382_bench SET log=${size==='small'?quote('small log'):"(SELECT string_agg(md5(i::text),'') FROM generate_series(1,8192)i)"};`)
    for (const enabled of [false,true]) {
      if (enabled) psql("CREATE TRIGGER v382_capture AFTER INSERT OR UPDATE ON public.__v382_bench FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('id');")
      const trials = []
      let workload = "BEGIN;\nUPDATE public.__v382_bench SET name='warmup';\n"
      for (let i=0;i<5;i++) {
        workload += `SELECT pg_current_wal_insert_lsn() AS start \\gset v382_\n\\o ${path.join(temp,`trial-${i}.json`)}\n`
        workload += `EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) UPDATE public.__v382_bench SET name='trial ${i}';\n`
        workload += `\\o ${path.join(temp,`wal-${i}.txt`)}\nSELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),:'v382_start'::pg_lsn);\n\\o\n`
      }
      psql(workload+'COMMIT;')
      for (let i=0;i<5;i++) {
        const trial = JSON.parse(fs.readFileSync(path.join(temp,`trial-${i}.json`),'utf8'))[0]
        // Plan-node WAL alone can omit AFTER-trigger writes. Whole-cluster LSN
        // delta includes nested trigger/TOAST/index writes in this isolated DB.
        trial.total_wal_bytes = Number(fs.readFileSync(path.join(temp,`wal-${i}.txt`),'utf8').trim())
        trials.push(trial)
      }
      results.push({ size, enabled, trials })
      if (enabled) psql('DROP TRIGGER v382_capture ON public.__v382_bench;')
    }
  }
  const storage = JSON.parse(psql(`SELECT json_build_object('rows',count(*),'avg_snapshot_bytes',avg(pg_column_size(old_data)+pg_column_size(new_data)),
    'total_relation_bytes',pg_total_relation_size('private.auto_table_logs')) FROM private.auto_table_logs WHERE table_name='__v382_bench';`).trim())
  return { results, storage }
}
const commands = { local, rehearse, apply, verify, 'post-smoke': () => rehearse(true), api }
assert(commands[process.argv[2]], 'local|rehearse|apply|verify|post-smoke|api')
Promise.resolve().then(() => commands[process.argv[2]]()).catch(error => {
  console.error(error.message)
  if (error.stderr) console.error(String(error.stderr))
  process.exitCode = 1
})
