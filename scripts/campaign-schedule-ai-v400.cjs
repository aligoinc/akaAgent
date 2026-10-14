// Prompt-only migration through the existing linked HTTP API. No history DDL/schema reload.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v400_campaign_schedule_natural_language', code = 'app_campaign_schedule'
const dir = path.join(root, 'migrations/snapshots/campaign-schedule-ai-v400')
const quote = value => "'" + value.replace(/'/g, "''") + "'"
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const write = (file, value) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }) }
const migration = () => fs.readFileSync(path.join(root, `migrations/${name}.sql`), 'utf8')
function query(text) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-ai-v400-db-'))
  try {
    const file = path.join(temp, 'query.sql'); fs.writeFileSync(file, text, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'],
      { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })).rows
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const snapshotSql = `SELECT jsonb_build_object(
 'models_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'[]')) FROM public.ai_model m),
 'model_md5',(SELECT md5(to_jsonb(m)::text) FROM public.ai_model m WHERE id=21),
 'other_prompts_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]')) FROM public.ai_prompt p WHERE code <> '${code}'),
 'usings_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'[]')) FROM public.ai_using u),
 'prompt_md5',(SELECT md5(to_jsonb(p)::text) FROM public.ai_prompt p WHERE id=49),
 'prompt_metadata_md5',(SELECT md5((to_jsonb(p)-'prompt_system'-'updated_at')::text) FROM public.ai_prompt p WHERE id=49),
 'using_md5',(SELECT md5(to_jsonb(u)::text) FROM public.ai_using u WHERE id=47),
 'prompts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.ai_prompt p WHERE code='${code}'),
 'usings',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.ai_using u WHERE code='${code}')
) AS snapshot;`
const snapshot = () => query(`BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; ${snapshotSql} COMMIT;`)[0].snapshot
function verify(current, before, prompt) {
  for (const key of ['models_md5', 'model_md5', 'other_prompts_md5', 'usings_md5', 'using_md5', 'prompt_metadata_md5']) assert.equal(current[key], before[key], key)
  assert.equal(current.prompts.length, 1); assert.deepEqual(current.usings, before.usings)
  assert.equal(current.prompts[0].prompt_system, prompt)
  assert.equal(current.prompts[0].id, 49); assert.equal(current.usings[0].model_id, 21)
}
function main() {
  const mode = process.argv[2]
  if (mode === 'snapshot') {
    const history = query("SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8;")
    assert(!history.some(row => row.name?.startsWith('migration_v400_')), 'V400 already occupied')
    const before = snapshot()
    assert.equal(before.prompts.length, 1); assert.equal(before.usings.length, 1)
    assert.equal(before.prompts[0].id, 49); assert.equal(before.usings[0].id, 47)
    assert.equal(before.usings[0].model_id, 21); assert.equal(before.usings[0].prompt_id, 49)
    write('before.json', before); write('history-before.json', history)
    console.log({ history, prompt_md5: before.prompt_md5, prompt_metadata_md5: before.prompt_metadata_md5, using_md5: before.using_md5, model_md5: before.model_md5 })
    return
  }
  const sql = migration(), before = read('before.json'), prompt = sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)[1]
  if (mode === 'smoke') {
    assert.deepEqual(snapshot(), before)
    const trial = query(sql.replace(/COMMIT;\s*$/, `${snapshotSql} ROLLBACK;`))[0].snapshot
    verify(trial, before, prompt); assert.deepEqual(snapshot(), before)
    write('smoke.json', { at: new Date().toISOString(), passed: true, migration_sha256: hash(sql), rolled_back: true })
    console.log('PASS prompt-only migration in rollback transaction; other AI settings unchanged')
  } else if (mode === 'apply') {
    assert.equal(read('smoke.json').migration_sha256, hash(sql))
    assert.equal(read('candidate-live.json').passed, true)
    assert.equal(read('candidate-live.json').migration_sha256, hash(sql))
    assert.deepEqual(snapshot(), before)
    assert(!fs.existsSync(path.join(dir, 'apply.json')), 'Already applied; use verify')
    const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
    const guarded = sql.replace('BEGIN;\n', `BEGIN;\nDO $history$ BEGIN
      IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v400_%') THEN
        RAISE EXCEPTION 'V400 history already occupied'; END IF;
      END $history$;\n`)
    const after = query(guarded.replace(/COMMIT;\s*$/, () => `
      INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
      ${snapshotSql} COMMIT;`))[0].snapshot
    verify(after, before, prompt)
    write('apply.json', { at: new Date().toISOString(), project_ref: ref, history_version: version, name, migration_sha256: hash(sql), applied: true })
    write('after.json', after)
    console.log({ applied: true, version, prompt_id: 49, using_id: 47, model_id: 21 })
  } else if (mode === 'rollback-smoke') {
    const sqlRollback = fs.readFileSync(path.join(root, `migrations/tests/${name}_rollback.sql`), 'utf8')
    const current = snapshot()
    const trial = query(sqlRollback.replace(/COMMIT;\s*$/, `${snapshotSql} ROLLBACK;`))[0].snapshot
    verify(trial, before, before.prompts[0].prompt_system); assert.deepEqual(snapshot(), current)
    write('rollback-smoke.json', { at: new Date().toISOString(), passed: true, rollback_sha256: hash(sqlRollback), production_keeps_v400: true })
    console.log('PASS rollback rehearsal; production keeps V400')
  } else if (mode === 'verify') {
    verify(snapshot(), before, prompt)
    const history = query(`SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
    assert.equal(history.length, 1); assert.equal(history[0].version, read('apply.json').history_version); assert.deepEqual(history[0].statements, [sql])
    console.log('PASS live prompt/history; every model, binding and other prompt unchanged')
  } else throw new Error('Expected snapshot, smoke, apply, rollback-smoke or verify')
}
main()
