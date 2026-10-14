// One prompt row through the linked Management API. No SQL client/pool or history setup DDL.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/campaign-diagnostics-prompt-v394')
const name = 'migration_v394_campaign_diagnostics_prompt'
const ref = 'cgjbsmqtfhqvttudyjzq'
const read = file => fs.readFileSync(path.join(dir, file), 'utf8')
const json = file => JSON.parse(read(file))
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const quote = value => "'" + value.replace(/'/g, "''") + "'"
const migration = () => fs.readFileSync(path.join(root, 'migrations', name + '.sql'), 'utf8')
const rollback = () => fs.readFileSync(path.join(root, 'migrations/tests', name + '_rollback.sql'), 'utf8')
const snapshotSQL = () => read('snapshot.sql').slice(read('snapshot.sql').indexOf('SELECT jsonb_build_object')).replace(/; COMMIT;\s*$/, '')
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-prompt-v394-'))
  try {
    const file = path.join(temp, 'query.sql')
    fs.writeFileSync(file, sql, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    })).rows
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const snapshot = () => query(`BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; ${snapshotSQL()}; COMMIT;`)[0].snapshot
function checkManifest() {
  const manifest = json('manifest.json')
  assert.equal(manifest.project_ref, ref)
  for (const [file, key] of [['before.json','before_sha256'], ['target.json','target_sha256']]) assert.equal(hash(read(file)), manifest[key])
  assert.equal(hash(migration()), manifest.migration_sha256)
  assert.equal(hash(rollback()), manifest.rollback_sha256)
}
function verifyState(current, applied) {
  const before = json('before.json')
  for (const key of ['all_models_md5', 'other_prompts_md5', 'other_usings_md5', 'usings', 'models', 'prompt_references']) {
    assert.deepEqual(current[key], before[key], 'Unexpected AI configuration change: ' + key)
  }
  assert.equal(current.prompts.length, 1)
  const withoutUpdated = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updated_at'))
  assert.deepEqual(withoutUpdated(current.prompts[0]), withoutUpdated(applied ? json('target.json').prompt : before.prompts[0]))
}
function smoke() {
  checkManifest()
  const result = query(migration().replace(/COMMIT;\s*$/, () => `${snapshotSQL()}; ROLLBACK;`))[0].snapshot
  verifyState(result, true)
  verifyState(snapshot(), false)
  write('smoke.json', { at: new Date().toISOString(), passed: true, rolled_back: true, prompt_id: 47, migration_sha256: hash(migration()) })
  console.log('PASS target prompt update and rollback; other prompts, bindings and models unchanged')
}
function apply() {
  checkManifest()
  assert.equal(json('smoke.json').migration_sha256, hash(migration()))
  assert.equal(json('smoke.json').passed, true)
  assert(!fs.existsSync(path.join(dir, 'apply.json')), 'Already applied: use verify')
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const sql = migration()
  const guarded = sql.replace('BEGIN;\n', `BEGIN;
    DO $history_guard$ BEGIN
      IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name=${quote(name)})
        OR (SELECT max((regexp_match(name,'^migration_v([0-9]+)_'))[1]::integer) FROM supabase_migrations.schema_migrations) >= 394 THEN
        RAISE EXCEPTION 'v394 migration version already used; inspect live history';
      END IF;
    END $history_guard$;
  `)
  const result = query(guarded.replace(/COMMIT;\s*$/, () => `
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
    ${snapshotSQL()}; COMMIT;`))[0].snapshot
  verifyState(result, true)
  write('apply.json', { at: new Date().toISOString(), project_ref: ref, history_version: version, name, migration_sha256: hash(sql), prompt_id: 47, applied: true })
  write('after.json', result)
  console.log({ applied: true, history_version: version, prompt_id: 47 })
}
function verify() {
  checkManifest()
  verifyState(snapshot(), true)
  const history = query(`SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
  assert.equal(history.length, 1)
  assert.equal(history[0].version, json('apply.json').history_version)
  assert.deepEqual(history[0].statements, [migration()])
  console.log('PASS live prompt, unchanged other AI configuration and migration history')
}
function rollbackSmoke() {
  checkManifest()
  const restored = query(rollback().replace(/COMMIT;\s*$/, () => `${snapshotSQL()}; ROLLBACK;`))[0].snapshot
  verifyState(restored, false)
  verifyState(snapshot(), true)
  write('rollback-smoke.json', { at: new Date().toISOString(), passed: true, rolled_back: true, production_keeps_new_prompt: true })
  console.log('PASS rollback rehearsal; production keeps the new prompt')
}
async function api() {
  checkManifest()
  const source = fs.readFileSync(path.join(root, 'src/main/data/supabaseClient.ts'), 'utf8')
  const key = source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/ai_prompt?id=eq.47&select=id,code,prompt_system,prompt_user`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000)
  })
  assert.equal(response.status, 200)
  const rows = await response.json()
  assert.equal(rows.length, 1)
  const target = json('target.json').prompt
  for (const key of ['id','code','prompt_system','prompt_user']) assert.deepEqual(rows[0][key], target[key])
  write('api.json', { at: new Date().toISOString(), http_status: response.status, prompt_id: 47, prompt_sha256: hash(rows[0].prompt_system), passed: true })
  console.log('PASS Data API reads the updated prompt without schema reload')
}
async function main() {
  const mode = process.argv[2]
  if (mode === 'smoke') smoke()
  else if (mode === 'apply') apply()
  else if (mode === 'verify') verify()
  else if (mode === 'rollback-smoke') rollbackSmoke()
  else if (mode === 'api') await api()
  else throw new Error('Expected smoke, apply, verify, rollback-smoke or api')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
