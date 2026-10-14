// Data-only prompt update via the existing linked Management API; no history DDL or reload.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v403_campaign_form_ai_repeat'
const dir = path.join(root, 'migrations/snapshots/campaign-form-ai-v403')
const quote = value => "'" + value.replace(/'/g, "''") + "'"
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const write = (file, value) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }) }
const migration = () => fs.readFileSync(path.join(root, `migrations/${name}.sql`), 'utf8')
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-form-ai-v403-'))
  try {
    const file = path.join(temp, 'query.sql'); fs.writeFileSync(file, sql, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'],
      { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })).rows
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const snapshotSql = `SELECT jsonb_build_object(
 'models_md5',(SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text) FROM public.ai_model m),
 'model_md5',(SELECT md5(to_jsonb(m)::text) FROM public.ai_model m WHERE id=21),
 'other_prompts_md5',(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM public.ai_prompt p WHERE id NOT IN (49,52)),
 'usings_md5',(SELECT md5(jsonb_agg(to_jsonb(u) ORDER BY id)::text) FROM public.ai_using u),
 'prompts',(SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(p),'md5',md5(to_jsonb(p)::text),
   'metadata_md5',md5((to_jsonb(p)-'prompt_system'-'updated_at')::text)) ORDER BY id) FROM public.ai_prompt p WHERE id IN (49,52)),
 'usings',(SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(u),'md5',md5(to_jsonb(u)::text)) ORDER BY id) FROM public.ai_using u WHERE id IN (47,50))
) AS snapshot;`
const snapshot = () => query(`BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; ${snapshotSql} COMMIT;`)[0].snapshot
function verify(current, before, prompts) {
  for (const key of ['models_md5', 'model_md5', 'other_prompts_md5', 'usings_md5']) assert.equal(current[key], before[key], key)
  assert.deepEqual(current.usings, before.usings)
  assert.equal(current.prompts.length, 2)
  for (const p of current.prompts) {
    assert.equal(p.metadata_md5, before.prompts.find(old => old.row.id === p.row.id).metadata_md5)
    assert.equal(p.row.prompt_system, prompts[p.row.id])
  }
}
function main() {
  const mode = process.argv[2]
  if (mode === 'snapshot') {
    const history = query("SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8;")
    assert(!history.some(row => row.name?.startsWith('migration_v403_')), 'V403 already occupied')
    const before = snapshot()
    assert.deepEqual(before.prompts.map(p => [p.row.id,p.row.code]), [[49,'app_campaign_schedule'],[52,'app_campaign_action_limits']])
    assert.deepEqual(before.usings.map(u => [u.row.id,u.row.prompt_id,u.row.model_id,u.row.is_active]), [[47,49,21,true],[50,52,21,true]])
    write('before.json', before); write('history-before.json', history)
    console.log('PASS live source snapshot: prompts 49/52, bindings 47/50, model 21; V403 available')
    return
  }
  const sql = migration(), before = read('before.json')
  const prompts = Object.fromEntries([49,52].map(id => [id, sql.match(new RegExp(`\\$prompt${id}\\$([\\s\\S]*?)\\$prompt${id}\\$`))[1]]))
  if (mode === 'smoke') {
    assert.deepEqual(snapshot(), before)
    const trial = query(sql.replace(/COMMIT;\s*$/, `${snapshotSql} ROLLBACK;`))[0].snapshot
    verify(trial, before, prompts); assert.deepEqual(snapshot(), before)
    write('smoke.json', { at: new Date().toISOString(), passed: true, migration_sha256: hash(sql), rolled_back: true })
    console.log('PASS prompt update rehearsal; every model/binding/other prompt unchanged')
  } else if (mode === 'apply') {
    for (const file of ['smoke.json', 'candidate-live.json']) {
      assert.equal(read(file).passed, true); assert.equal(read(file).migration_sha256, hash(sql))
    }
    assert.deepEqual(snapshot(), before)
    assert(!fs.existsSync(path.join(dir, 'apply.json')), 'Already applied; use verify')
    const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
    const guarded = sql.replace('BEGIN;\n', `BEGIN;\nDO $history$ BEGIN
      IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v403_%') THEN
        RAISE EXCEPTION 'V403 history already occupied'; END IF;
      END $history$;\n`)
    const after = query(guarded.replace(/COMMIT;\s*$/, () => `
      INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
      ${snapshotSql} COMMIT;`))[0].snapshot
    verify(after, before, prompts)
    write('apply.json', { at: new Date().toISOString(), project_ref: ref, history_version: version, name, migration_sha256: hash(sql), applied: true })
    write('after.json', after)
    console.log({ applied: true, version, prompt_ids: [49,52], using_ids: [47,50], model_id: 21 })
  } else if (mode === 'rollback-smoke') {
    const rollback = fs.readFileSync(path.join(root, `migrations/tests/${name}_rollback.sql`), 'utf8'), current = snapshot()
    const trial = query(rollback.replace(/COMMIT;\s*$/, `${snapshotSql} ROLLBACK;`))[0].snapshot
    verify(trial, before, Object.fromEntries(before.prompts.map(p => [p.row.id,p.row.prompt_system])))
    assert.deepEqual(snapshot(), current)
    write('rollback-smoke.json', { at: new Date().toISOString(), passed: true, rollback_sha256: hash(rollback), production_keeps_v403: true })
    console.log('PASS rollback rehearsal; live keeps V403')
  } else if (mode === 'verify') {
    verify(snapshot(), before, prompts)
    const history = query(`SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
    assert.equal(history.length, 1); assert.equal(history[0].version, read('apply.json').history_version); assert.deepEqual(history[0].statements, [sql])
    console.log('PASS live prompts/history; every model/binding/other prompt unchanged')
  } else throw new Error('Expected snapshot, smoke, apply, rollback-smoke or verify')
}
main()
