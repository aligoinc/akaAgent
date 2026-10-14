// Use the existing linked Management API; no SQL pool or history-preparation DDL.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v401_web_enrichment_defaults'
const directory = path.join(root, 'migrations/snapshots/web-enrichment-defaults-v401')
const read = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
const write = (file, value) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const quote = value => "'" + value.replace(/'/g, "''") + "'"
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const manifest = read('manifest.json'), before = read('before.json')
const signature = 'public.' + manifest.signature
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-defaults-v401-'))
  try {
    const file = path.join(temp, 'query.sql'); fs.writeFileSync(file, sql, { mode: 0o600 })
    return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'], {
      cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    })).rows
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const snapshotSql = `SELECT jsonb_build_object(
 'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),
 'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl,
 'protectedFunctions',(SELECT jsonb_object_agg(q.oid::regprocedure::text,md5(pg_get_functiondef(q.oid))) FROM pg_proc q
   WHERE q.pronamespace='public'::regnamespace AND q.proname IN ('auto_assert_automation_identity','aka_agent_facebook_random_run',
     'aka_agent_claim_campaign_runtime_checked','aka_agent_cleanup_failed_campaign_runtime')),
 'accountSettingsMd5',(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(a.id,a.facebook_web_enrichment_enabled,a.facebook_web_enrichment_config) ORDER BY a.id)::text,'[]'))
   FROM public.auto_accounts a WHERE a.flatform_type='facebook')
) snapshot FROM pg_proc p WHERE p.oid=to_regprocedure('${signature}');`
const snapshot = () => query(`BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; ${snapshotSql} COMMIT;`)[0].snapshot
function verify(value, expectedMd5, baseline) {
  assert.equal(value.md5, expectedMd5)
  for (const key of ['owner', 'securityDefiner', 'volatility', 'config', 'acl']) assert.deepEqual(value[key], before[key], key)
  if (baseline) {
    assert.deepEqual(value.protectedFunctions, baseline.protectedFunctions, 'unrelated RPCs')
    assert.equal(value.accountSettingsMd5, baseline.accountSettingsMd5, 'saved account settings')
  }
}
const sql = fs.readFileSync(path.join(root, `migrations/${name}.sql`), 'utf8')
const smoke = fs.readFileSync(path.join(root, `migrations/tests/${name}_smoke.sql`), 'utf8')
const rollback = fs.readFileSync(path.join(root, `migrations/tests/${name}_rollback.sql`), 'utf8')
const mode = process.argv[2]
if (mode === 'smoke') {
  const baseline = snapshot(); verify(baseline, manifest.source_md5)
  const trial = query(sql.replace(/COMMIT;\s*$/, `${smoke}\n${snapshotSql}\nROLLBACK;`))[0].snapshot
  verify(trial, manifest.target_md5)
  assert.deepEqual(trial.protectedFunctions, baseline.protectedFunctions)
  verify(snapshot(), manifest.source_md5, baseline)
  write('baseline.json', baseline)
  write('smoke.json', { passed: true, at: new Date().toISOString(), migration_sha256: hash(sql), rolled_back: true })
  console.log('PASS rollback smoke: three-site save, invalid counts/duplicates, CAS, ownership/credentials/ACL, legacy read/disable; production unchanged')
} else if (mode === 'apply') {
  assert.equal(read('smoke.json').migration_sha256, hash(sql))
  assert.equal(read('smoke.json').passed, true)
  assert(!fs.existsSync(path.join(directory, 'apply.json')), 'Already applied; use verify')
  const baseline = snapshot(); verify(baseline, manifest.source_md5, read('baseline.json'))
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const guarded = sql.replace('BEGIN;\n', `BEGIN;\nDO $history$ BEGIN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v401_%') THEN
      RAISE EXCEPTION 'V401 history already occupied'; END IF; END $history$;\n`)
  const after = query(guarded.replace(/COMMIT;\s*$/, () => `
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
    ${snapshotSql} COMMIT;`))[0].snapshot
  verify(after, manifest.target_md5, baseline)
  write('apply.json', { applied: true, project_ref: ref, version, name, at: new Date().toISOString(), migration_sha256: hash(sql) })
  write('after.json', after)
  console.log({ applied: true, version, source_md5: manifest.source_md5, target_md5: after.md5 })
} else if (mode === 'post-smoke') {
  const baseline = snapshot(); verify(baseline, manifest.target_md5)
  query(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'; ${smoke} ROLLBACK; SELECT 'PASS' result;`)
  verify(snapshot(), manifest.target_md5, baseline)
  write('post-smoke.json', { passed: true, at: new Date().toISOString(), rolled_back: true })
  console.log('PASS post-apply behavior/ownership/credentials/CAS smoke; fixtures rolled back')
} else if (mode === 'rollback-smoke') {
  const baseline = snapshot(); verify(baseline, manifest.target_md5)
  const trial = query(rollback.replace(/COMMIT;\s*$/, `${snapshotSql} ROLLBACK;`))[0].snapshot
  verify(trial, manifest.source_md5, baseline)
  verify(snapshot(), manifest.target_md5, baseline)
  write('rollback-smoke.json', { passed: true, at: new Date().toISOString(), production_keeps_v401: true })
  console.log('PASS rollback rehearsal restores exact source definition/ACL; production keeps V401')
} else if (mode === 'verify') {
  verify(snapshot(), manifest.target_md5, read('baseline.json'))
  const history = query(`SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
  assert.equal(history.length, 1); assert.equal(history[0].version, read('apply.json').version); assert.deepEqual(history[0].statements, [sql])
  console.log('PASS live checksum/attributes/ACL/history, protected RPCs and saved account settings unchanged')
} else throw Error('Expected smoke, apply, post-smoke, rollback-smoke or verify')
