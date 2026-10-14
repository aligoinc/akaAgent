// Single canonical V393 migration over the existing linked CLI connection.
// Do not run CLI SQL processes concurrently: temporary login roles can conflict.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/facebook-random-run-boundaries-v393')
const name = 'migration_v393_facebook_random_run_boundaries'
const body = fs.readFileSync(path.join(root, 'migrations', name + '.sql'), 'utf8')
const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json')))
const target = JSON.parse(fs.readFileSync(path.join(dir, 'target.json')))
const quote = s => "'" + s.replaceAll("'", "''") + "'"
const sha = crypto.createHash('sha256').update(body).digest('hex')
const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n')
const metadata = "SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(x) FROM unnest(ARRAY[" + source.map(f => quote(f.signature)).join(',') + "]) x) ORDER BY 1;"
const smoke = fs.readFileSync(path.join(root, 'migrations/tests/migration_v393_facebook_random_run_boundaries_rollback.sql'), 'utf8')
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), 'cgjbsmqtfhqvttudyjzq')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v393-sql-'))
  try {
    const file = path.join(tmp, 'query.sql'); fs.writeFileSync(file, sql)
    const r = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
    if (r.status !== 0) throw Error(r.stderr || r.error?.message || 'SQL failed; inspect live history before retrying any apply')
    return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)).rows
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
const finish = (sql, tail) => sql.replace(/\nCOMMIT;\s*$/, () => '\n' + tail + '\n')
const compare = (actual, expected) => assert.deepEqual(actual, expected)
const command = process.argv[2]
if (command === 'audit') {
  compare(query(finish(body, metadata + '\nROLLBACK;')), target)
  save('audit.json', { at: new Date().toISOString(), migration_sha256: sha, attributes_preserved: true, rollback: true, support_functions_unchanged: true })
  const result = query(finish(body, '') + smoke.replace('BEGIN;', ''))
  save('preapply-smoke.json', { at: new Date().toISOString(), result, migration_sha256: sha, external_operations: 0 })
  console.log({ audit: 'PASS', functions: target.length, result })
} else if (command === 'apply') {
  for (const file of ['audit.json', 'preapply-smoke.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(dir, file))).migration_sha256, sha)
  compare(query(metadata), source)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const sql = finish(body.replace('BEGIN;', () => "BEGIN; DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name=" + quote(name) + ") THEN RAISE EXCEPTION 'v393 already applied'; END IF; END $$;"), "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(" + quote(version) + ',' + quote(name) + ',ARRAY[' + quote(body) + ']); COMMIT;')
  query(sql)
  save('apply.json', { at: new Date().toISOString(), project_ref: 'cgjbsmqtfhqvttudyjzq', version, name, migration_sha256: sha })
  console.log({ applied: true, version, name })
} else if (command === 'verify') {
  const functions = query(metadata); compare(functions, target)
  const history = query('SELECT version,name FROM supabase_migrations.schema_migrations WHERE name=' + quote(name))
  assert.equal(history.length, 1)
  const triggers = query("SELECT tgenabled enabled,md5(pg_get_triggerdef(oid)) md5 FROM pg_trigger WHERE tgrelid='public.auto_campaigns'::regclass AND tgname='facebook_random_finalize_on_release';")
  assert.deepEqual(triggers, [{ enabled: 'O', md5: 'dd0ac9f39049a53820c839a62d85cac2' }])
  const shape = query('SELECT count(*) FILTER(WHERE facebook_random_run_enabled) enabled_accounts,(SELECT count(*) FROM auto_account_random_run_days) day_rows FROM auto_accounts;')
  const result = query(smoke)
  save('after.json', { at: new Date().toISOString(), functions, history, triggers, shape, migration_sha256: sha })
  save('rollback-smoke.json', { at: new Date().toISOString(), result, migration_sha256: sha, external_operations: 0 })
  console.log({ verified: true, history, shape, result })
} else throw Error('Use audit | apply | verify')
