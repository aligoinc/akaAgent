// One intended migration through the existing linked Management API; no SQL pool
// or migration-history setup DDL. Unknown apply outcomes require verify, not retry.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'docs/audits/new-zalo-runtime-v371')
const ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v371_org_new_zalo_runtime_flag'
const signature = 'private.aka_agent_org_default_new_zalo_runtime()'
const read = file => fs.readFileSync(path.join(dir, file), 'utf8')
const json = file => JSON.parse(read(file))
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const write = (file, data) => fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
const migration = () => fs.readFileSync(path.join(root, 'migrations', name + '.sql'), 'utf8')
const smokeSQL = () => fs.readFileSync(path.join(root, 'migrations/tests', name + '_smoke.sql'), 'utf8')
const snapshotSQL = () => read('snapshot.sql').trim().replace(/;$/, '')
const quote = value => "'" + value.replace(/'/g, "''") + "'"
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-v371-'))
  try {
    const file = path.join(temp, 'query.sql')
    fs.writeFileSync(file, sql, { mode: 0o600 })
    const output = execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'],
      { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(output).rows
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const snapshot = () => query(snapshotSQL())[0]
function checkManifest() {
  const manifest = json('before-manifest.json')
  assert.equal(manifest.project_ref, ref)
  assert.equal(manifest.before_sha256, hash(read('before-apply.json')))
  assert.equal(manifest.migration_sha256, hash(migration()))
  assert.equal(manifest.smoke_sha256, hash(smokeSQL()))
  assert.equal(manifest.snapshot_sha256, hash(read('snapshot.sql')))
  return manifest
}
const stableSchema = table => {
  const { bytes, estimated_rows, ...stable } = table
  return stable
}
function checkPreserved(before, after, applied) {
  assert.deepEqual(after.ddl_triggers, before.ddl_triggers, 'Existing event triggers/functions drifted')
  assert.deepEqual(after.triggers.filter(t => t.function.signature !== signature), before.triggers, 'Existing table triggers/functions drifted')
  const schema = stableSchema(after.table_schema)
  if (applied) schema.columns = schema.columns.filter(c => c.name !== 'use_new_zalo_runtime')
  assert.deepEqual(schema, stableSchema(before.table_schema), 'Existing schema/ACL/RLS changed')
}
function checkTarget(after) {
  assert.equal(after.target_signature, signature)
  assert.deepEqual(after.target_overloads, [signature])
  const func = after.triggers.find(t => t.function.signature === signature)?.function
  assert(func, 'Missing new trigger function')
  assert.equal(func.owner, 'postgres')
  assert.equal(func.security_definer, false)
  assert.equal(func.volatility, 'v')
  assert.deepEqual(func.config, ['search_path=pg_catalog'])
  assert.deepEqual(func.acl, ['postgres=X/postgres'])
  assert.match(func.definition, /NEW\.use_new_zalo_runtime := true;/)
  const col = after.table_schema.columns.find(c => c.name === 'use_new_zalo_runtime')
  assert.equal(col.type, 'boolean')
  assert.equal(col.not_null, true)
  assert.equal(col.default, 'true')
  assert.equal(col.acl, null)
  return func
}
function capture() {
  const before = snapshot()
  assert.equal(before.target_signature, null)
  assert.deepEqual(before.target_overloads, [])
  assert(!before.recent_migrations.some(m => /^migration_v371_/.test(m.name)))
  write('before-apply.json', before)
  write('before-manifest.json', { project_ref: ref, at: new Date().toISOString(),
    before_sha256: hash(read('before-apply.json')), migration_sha256: hash(migration()),
    smoke_sha256: hash(smokeSQL()), snapshot_sha256: hash(read('snapshot.sql')) })
  checkManifest()
  console.log('Captured and re-read source snapshot, exact absent signature and manifest')
}
function smoke(applied = false) {
  checkManifest()
  const before = json('before-apply.json')
  const prefix = applied ? "BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';" : migration().replace(/COMMIT;\s*$/, '')
  const result = query(`${prefix}\nSAVEPOINT fixture;\n${smokeSQL()}\nROLLBACK TO fixture;
    WITH snapshot AS (${snapshotSQL()}) SELECT true verified,
      clock_timestamp()-transaction_timestamp() duration, to_jsonb(snapshot) snapshot FROM snapshot;
    ROLLBACK;`)[0]
  assert.equal(result.verified, true)
  const func = checkTarget(result.snapshot)
  checkPreserved(before, result.snapshot, true)
  const restored = snapshot()
  checkPreserved(before, restored, applied)
  if (applied) assert.deepEqual(checkTarget(restored), json('live-rollback-smoke.json').target)
  else { assert.equal(restored.target_signature, null); assert(!restored.table_schema.columns.some(c => c.name === 'use_new_zalo_runtime')) }
  write(applied ? 'live-post-apply-smoke.json' : 'live-rollback-smoke.json', {
    at: new Date().toISOString(), project_ref: ref, verified: true, rolled_back: true,
    customer_writes: 0, external_operations: 0, duration: result.duration,
    migration_sha256: hash(migration()), smoke_sha256: hash(smokeSQL()), target: func })
  console.log({ verified: true, rolled_back: true, duration: result.duration, target_md5: func.md5 })
}
function apply() {
  checkManifest()
  assert(!fs.existsSync(path.join(dir, 'apply.json')), 'Apply receipt already exists; verify instead')
  const rehearsal = json('live-rollback-smoke.json')
  assert.equal(rehearsal.verified, true)
  assert.equal(rehearsal.migration_sha256, hash(migration()))
  assert.equal(rehearsal.smoke_sha256, hash(smokeSQL()))
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const sql = migration()
  const result = query(sql.replace(/COMMIT;\s*$/, () => `
    DO $target$ BEGIN
      IF md5(pg_get_functiondef(${quote(signature)}::regprocedure)) IS DISTINCT FROM ${quote(rehearsal.target.md5)} THEN
        RAISE EXCEPTION 'v371 target checksum mismatch';
      END IF;
    END; $target$;
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      VALUES (${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
    SELECT true applied, count(*) org_count, count(*) FILTER (WHERE NOT use_new_zalo_runtime) legacy_false_count,
      clock_timestamp()-transaction_timestamp() duration FROM public.org_organization;
    COMMIT;`))[0]
  assert.equal(result.applied, true)
  write('apply.json', { at: new Date().toISOString(), project_ref: ref, name, history_version: version,
    migration_sha256: hash(sql), ...result })
  console.log({ ...result, history_version: version })
}
function verify() {
  checkManifest()
  const after = snapshot()
  checkPreserved(json('before-apply.json'), after, true)
  const func = checkTarget(after)
  assert.deepEqual(func, json('live-rollback-smoke.json').target)
  const receipt = json('apply.json')
  const history = query(`SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
  assert.equal(history.length, 1)
  assert.equal(history[0].version, receipt.history_version)
  assert.deepEqual(history[0].statements, [migration()])
  const counts = query(`SELECT count(*) total, count(*) FILTER (WHERE use_new_zalo_runtime) new_runtime,
    count(*) FILTER (WHERE NOT use_new_zalo_runtime) legacy_runtime,
    count(*) FILTER (WHERE use_new_zalo_runtime IS NULL) null_flags FROM public.org_organization;`)[0]
  assert.equal(counts.null_flags, 0)
  write('after.json', after)
  write('verification.json', { at: new Date().toISOString(), project_ref: ref, verified: true,
    after_sha256: hash(read('after.json')), target_md5: func.md5, history_version: receipt.history_version, counts })
  console.log({ verified: true, target_md5: func.md5, counts })
}
async function api() {
  const source = fs.readFileSync(path.join(root, 'src/main/data/supabaseClient.ts'), 'utf8')
  const key = source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/org_organization?select=use_new_zalo_runtime&limit=0`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200, `Schema/API check returned ${response.status}`)
  assert.deepEqual(await response.json(), [])
  write('api-after.json', { at: new Date().toISOString(), project_ref: ref, status: response.status,
    new_column_resolved: true, customer_rows_returned: 0 })
  console.log({ status: response.status, new_column_resolved: true, customer_rows_returned: 0 })
}
const commands = { capture, smoke, apply, verify, 'post-smoke': () => smoke(true), api }
assert(commands[process.argv[2]], 'capture|smoke|apply|verify|post-smoke|api')
Promise.resolve().then(() => commands[process.argv[2]]()).catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
