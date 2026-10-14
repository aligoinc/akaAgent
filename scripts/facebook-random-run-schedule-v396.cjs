// Canonical V396; apply only this captured SQL through the existing linked Management API. SQL calls are sequential.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/facebook-random-run-schedule-v396')
// Preserve the name already committed before the concurrent V395 collision was noticed.
const name = 'migration_v395_facebook_random_run_schedule'
const body = fs.readFileSync(path.join(root, 'migrations', 'migration_v396_facebook_random_run_schedule.sql'), 'utf8')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const source = read('source.json'), target = read('target.json'), support = read('support.json')
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const hash = crypto.createHash('sha256').update(body).digest('hex')
const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n')
const metadata = `SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p WHERE p.oid=to_regprocedure(${quote('public.' + source[0].signature)});`
const supportMetadata = `SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) md5 FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(s) FROM unnest(ARRAY[${support.map(f => quote(f.signature)).join(',')}]) s) ORDER BY 1;`
const smoke = fs.readFileSync(path.join(root, 'migrations/tests/migration_v396_facebook_random_run_schedule_smoke.sql'), 'utf8')
const guards = fs.readFileSync(path.join(root, 'migrations/tests/migration_v393_facebook_random_run_boundaries_rollback.sql'), 'utf8')
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), 'cgjbsmqtfhqvttudyjzq')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v395-sql-'))
  try {
    const file = path.join(tmp, 'query.sql'); fs.writeFileSync(file, sql)
    const r = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
    if (r.status !== 0) throw Error(r.stderr || r.error?.message || 'Query failed; inspect live history before retrying apply')
    return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)).rows
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
const normalize = rows => rows.map(row => ({ ...row, proacl: typeof row.proacl === 'string' ? row.proacl.slice(1, -1).split(',') : row.proacl }))
const compare = (rows, expected) => assert.deepEqual(normalize(rows), normalize(expected))
const endWith = (sql, tail) => {
  assert.match(sql, /\nCOMMIT;\s*$/)
  return sql.replace(/\nCOMMIT;\s*$/, () => '\n' + tail + '\n')
}
const command = process.argv[2]
if (command === 'audit') {
  compare(query(metadata), source)
  assert.deepEqual(query(supportMetadata), support)
  compare(query(endWith(body, metadata + '\nROLLBACK;')), target)
  const results = [smoke, guards].map(test => query(endWith(body, '') + test.replace('BEGIN;', '')))
  save('audit.json', { at: new Date().toISOString(), migration_sha256: hash, attributes_preserved: true, support_unchanged: true, rollback: true, results, external_operations: 0 })
  console.log(JSON.stringify({ audit: 'PASS', results }))
} else if (command === 'apply') {
  assert.equal(read('audit.json').migration_sha256, hash)
  assert.equal(read('local-smoke.json').migration_sha256, hash)
  compare(query(metadata), source)
  assert.deepEqual(query(supportMetadata), support)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const checked = body.replace('BEGIN;', () => `BEGIN; DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) THEN RAISE EXCEPTION 'v395 already applied'; END IF; END $$;`)
  query(endWith(checked, `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(body)}]); COMMIT;`))
  save('apply.json', { at: new Date().toISOString(), project_ref: 'cgjbsmqtfhqvttudyjzq', version, name, migration_sha256: hash })
  console.log(JSON.stringify({ applied: true, version, name }))
} else if (command === 'verify') {
  const functions = query(metadata); compare(functions, target)
  assert.deepEqual(query(supportMetadata), support)
  const history = query(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}`)
  assert.equal(history.length, 1)
  const results = [smoke, guards].map(query)
  // Rehearse rollback without committing it; production must remain on V395.
  compare(query(endWith(fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8'), metadata + '\nROLLBACK;')), source)
  compare(query(metadata), target)
  save('after.json', { at: new Date().toISOString(), functions, history, support_unchanged: true, results, rollback_rehearsal: true, migration_sha256: hash, external_operations: 0 })
  console.log(JSON.stringify({ verified: true, history, results, rollback_rehearsal: true }))
} else throw Error('Use audit | apply | verify')
