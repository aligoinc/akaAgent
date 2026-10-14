// Data-only migration via the existing linked Management API; no SQL pool or history DDL.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v402_campaign_action_limits_ai', code = 'app_campaign_action_limits'
const dir = path.join(root, 'migrations/snapshots/campaign-limits-ai-v402')
const sql = fs.readFileSync(path.join(root, `migrations/${name}.sql`), 'utf8')
const quote = value => "'" + value.replace(/'/g, "''") + "'"
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const write = (file, value) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }) }
function query(text) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-ai-db-'))
  try {
    const file = path.join(temp, 'query.sql'); fs.writeFileSync(file, text, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'],
      { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })).rows
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const snapshotSql = `SELECT jsonb_build_object(
 'models_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'[]')) FROM public.ai_model m),
 'other_prompts_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]')) FROM public.ai_prompt p WHERE code <> '${code}'),
 'other_usings_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'[]')) FROM public.ai_using u WHERE code <> '${code}'),
 'prompts',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.ai_prompt p WHERE code='${code}'),
 'usings',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]') FROM public.ai_using u WHERE code='${code}')
) AS snapshot;`
const snapshot = () => query(`BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; ${snapshotSql} COMMIT;`)[0].snapshot
function verify(current, before, active) {
  for (const key of ['models_md5', 'other_prompts_md5', 'other_usings_md5']) assert.equal(current[key], before[key], key)
  assert.equal(current.prompts.length, 1); assert.equal(current.usings.length, 1)
  const prompt = current.prompts[0], using = current.usings[0]
  assert.equal(prompt.prompt_system, sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)[1])
  assert.equal(prompt.prompt_user, '{{limitsContext}}'); assert.equal(prompt.is_active, true)
  assert.equal(using.prompt_id, prompt.id); assert.equal(using.model_id, 21); assert.equal(using.timeout_ms, 120000)
  assert.equal(using.is_active, active); assert.equal(using.is_system, true); assert.equal(using.organization_id, null)
}
function smoke() {
  const before = snapshot(); assert.equal(before.prompts.length, 0); assert.equal(before.usings.length, 0)
  const trial = query(sql.replace(/COMMIT;\s*$/, `${snapshotSql} ROLLBACK;`))[0].snapshot
  verify(trial, before, true); assert.deepEqual(snapshot(), before)
  write('before.json', before)
  write('smoke.json', { passed: true, at: new Date().toISOString(), migration_sha256: hash(sql), rolled_back: true })
  console.log('PASS two AI rows in rollback transaction; all models and other AI settings unchanged')
}
function apply() {
  assert.equal(read('smoke.json').migration_sha256, hash(sql)); assert.equal(read('smoke.json').passed, true)
  const before = read('before.json'); assert.deepEqual(snapshot(), before)
  assert.equal(read('candidate-live.json').passed, true); assert.equal(read('candidate-live.json').migration_sha256, hash(sql))
  assert(!fs.existsSync(path.join(dir, 'apply.json')), 'Already applied; use verify')
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const guarded = sql.replace('BEGIN;\n', `BEGIN;\nDO $history$ BEGIN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v402_%') THEN
      RAISE EXCEPTION 'v402 history already occupied'; END IF;
    END $history$;\n`)
  const after = query(guarded.replace(/COMMIT;\s*$/, () => `
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
    ${snapshotSql} COMMIT;`))[0].snapshot
  verify(after, before, true)
  write('apply.json', { at: new Date().toISOString(), project_ref: ref, history_version: version, name, migration_sha256: hash(sql), applied: true })
  write('after.json', after)
  console.log({ applied: true, version, prompt_id: after.prompts[0].id, using_id: after.usings[0].id, model_id: after.usings[0].model_id })
}
function rollbackSmoke() {
  const rollback = fs.readFileSync(path.join(root, `migrations/tests/${name}_disable.sql`), 'utf8')
  const current = snapshot()
  const trial = query(rollback.replace(/COMMIT;\s*$/, `${snapshotSql} ROLLBACK;`))[0].snapshot
  verify(trial, read('before.json'), false); assert.deepEqual(snapshot(), current)
  write('rollback-smoke.json', { passed: true, at: new Date().toISOString(), disable_sha256: hash(rollback), production_keeps_enabled: true })
  console.log('PASS disable/rollback rehearsal; production remains enabled, logs retained')
}
async function api() {
  const source = fs.readFileSync(path.join(root, 'src/main/data/supabaseClient.ts'), 'utf8')
  const key = source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/ai_using?code=eq.${code}&select=id,code,model_id,prompt_id,is_active`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200); const rows = await response.json(); assert.equal(rows.length, 1); assert.equal(rows[0].is_active, true)
  write('api.json', { at: new Date().toISOString(), passed: true, status: response.status, rows })
  console.log('PASS existing Data API reads new binding without schema reload')
}
async function main() {
  const mode = process.argv[2]
  if (mode === 'smoke') smoke()
  else if (mode === 'apply') apply()
  else if (mode === 'rollback-smoke') rollbackSmoke()
  else if (mode === 'api') await api()
  else if (mode === 'preflight') {
    const history = query("SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;")
    assert(!history.some(row => row.name?.startsWith('migration_v402_')))
    assert.equal(snapshot().prompts.length, 0); assert.equal(snapshot().usings.length, 0)
    const model = query("SELECT id,model,md5(to_jsonb(m)::text) AS md5 FROM public.ai_model m WHERE id=21;")
    assert.equal(model[0].model, 'gpt-6.1-sol'); assert.equal(model[0].md5, '304b03d3ec8a09e04f36f4bb1d035cdb')
    console.log({ history, model })
  }
  else if (mode === 'verify') {
    verify(snapshot(), read('before.json'), true)
    const history = query(`SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
    assert.equal(history.length, 1); assert.equal(history[0].version, read('apply.json').history_version); assert.deepEqual(history[0].statements, [sql])
    console.log('PASS live binding/prompt/model and migration history; other AI configuration unchanged')
  } else throw new Error('Expected smoke, apply, verify, rollback-smoke or api')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
