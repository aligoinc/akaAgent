// Linked Management API only, sequential calls; preserves the existing RPC surface.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'migrations/snapshots/campaign-shared-schedule-v397')
const name = 'migration_v397_campaign_shared_schedule'
const body = fs.readFileSync(path.join(root, 'migrations', name + '.sql'), 'utf8')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const source = read('source.json'), proposed = read('proposed.json'), support = read('support.json')
const helper = 'private.campaign_dispatch_schedule_allowed(timestamp with time zone,text,timestamp with time zone,time without time zone,timestamp with time zone,boolean)'
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const hash = crypto.createHash('sha256').update(body).digest('hex')
const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n')
const metadata = `SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(s) FROM unnest(ARRAY[${[...source.map(f => 'public.' + f.signature), helper].map(quote).join(',')}]) s) ORDER BY 1;`
const supportMetadata = `SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) md5 FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(s) FROM unnest(ARRAY[${support.map(f => quote(f.signature)).join(',')}]) s) ORDER BY 1;`
const tests = ['migration_v397_campaign_shared_schedule_smoke.sql', 'migration_v396_facebook_random_run_schedule_smoke.sql', 'migration_v393_facebook_random_run_boundaries_rollback.sql']
  .map(file => fs.readFileSync(path.join(root, 'migrations/tests', file), 'utf8'))
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), 'cgjbsmqtfhqvttudyjzq')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v397-sql-'))
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
  const target = query(endWith(body, metadata + '\nROLLBACK;'))
  assert.equal(target.length, source.length + 1)
  for (const before of normalize(source)) {
    const after = normalize(target).find(f => f.signature === before.signature)
    assert.equal(after.definition, proposed.find(f => f.signature === before.signature).definition)
    const attrs = ({ definition, md5, ...rest }) => rest
    assert.deepEqual(attrs(after), attrs(before))
  }
  const added = normalize(target).find(f => f.signature === helper)
  assert.ok(added); assert.equal(added.prosecdef, false); assert.equal(added.provolatile, 'i')
  assert.deepEqual(added.proconfig, ['search_path=pg_catalog'])
  assert.deepEqual(added.proacl, ['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres', 'aka_agent_chat_api=X/postgres'])
  save('target.json', target)
  const preflight = target.map(f => ` IF to_regprocedure(${quote(f.signature)}) IS NULL OR md5(pg_get_functiondef(to_regprocedure(${quote(f.signature)}))) IS DISTINCT FROM ${quote(f.md5)} THEN RAISE EXCEPTION 'v397 rollback drift'; END IF;`).join('\n')
  fs.writeFileSync(path.join(dir, 'rollback.sql'), `-- Restore only V397 bodies. Keep migration history and customer data.\nBEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='30s';\nDO $preflight$\nBEGIN\n${preflight}\nEND $preflight$;\n${source.map(f => f.definition.trimEnd() + ';').join('\n\n')}\nDROP FUNCTION ${helper};\nCOMMIT;\n`)
  const results = tests.map(test => query(endWith(body, '') + test.replace('BEGIN;', '')))
  compare(query(endWith(body, '') + endWith(fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8').replace('BEGIN;', ''), metadata + '\nROLLBACK;')), source)
  save('audit.json', { at: new Date().toISOString(), migration_sha256: hash, attributes_preserved: true, support_unchanged: true, rollback: true, results, external_operations: 0 })
  console.log(JSON.stringify({ audit: 'PASS', results }))
} else if (command === 'apply') {
  assert.equal(read('audit.json').migration_sha256, hash)
  assert.equal(read('local-smoke.json').migration_sha256, hash)
  compare(query(metadata), source)
  assert.deepEqual(query(supportMetadata), support)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const checked = body.replace('BEGIN;', () => `BEGIN; DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) THEN RAISE EXCEPTION 'v397 already applied'; END IF; END $$;`)
  query(endWith(checked, `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(body)}]); COMMIT;`))
  save('apply.json', { at: new Date().toISOString(), project_ref: 'cgjbsmqtfhqvttudyjzq', version, name, migration_sha256: hash })
  console.log(JSON.stringify({ applied: true, version, name }))
} else if (command === 'verify') {
  const target = read('target.json'), functions = query(metadata); compare(functions, target)
  assert.deepEqual(query(supportMetadata), support)
  const history = query(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}`)
  assert.equal(history.length, 1)
  const results = tests.map(query)
  compare(query(endWith(fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8'), metadata + '\nROLLBACK;')), source)
  compare(query(metadata), target)
  save('after.json', { at: new Date().toISOString(), functions, history, support_unchanged: true, results, rollback_rehearsal: true, migration_sha256: hash, external_operations: 0 })
  console.log(JSON.stringify({ verified: true, history, results, rollback_rehearsal: true }))
} else throw Error('Use audit | apply | verify')
