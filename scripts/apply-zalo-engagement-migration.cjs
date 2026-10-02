// Only v339, via the existing linked Management API; no SQL pool/connection.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v339_zalo_campaign_engagement.sql'), 'utf8')
const phases = [...migration.matchAll(/-- @phase (\w+)\n([\s\S]*?)(?=-- @phase |$)/g)].map(m => ({ name: m[1], sql: m[2] }))
const target = JSON.parse(fs.readFileSync(path.join(root, 'docs/audits/zalo-engagement/local-target.json'), 'utf8'))
const indexes = JSON.parse(fs.readFileSync(path.join(root, 'docs/audits/zalo-engagement/local-indexes.json'), 'utf8'))
const name = 'migration_v339_zalo_campaign_engagement'
assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), 'cgjbsmqtfhqvttudyjzq')
assert.deepEqual(phases.map(p => p.name), ['schema', 'auto_campaign_engagement_source', 'auto_campaign_engagement_operation', 'chat_runtime_engagement_pending', 'chat_runtime_engagement_reconcile', 'validate', 'postflight'])
if (!process.argv.includes('--apply')) {
  console.log('v339: short schema transaction → four sequential concurrent indexes → validate → exact RPC/index checks + history. enabled remains false. Use --apply; --resume only after inspecting a partial run.')
  process.exit(0)
}
const directory = path.resolve(process.env.ENGAGEMENT_DEPLOY_EVIDENCE || path.join(root, 'docs/audits/zalo-engagement/production-apply'))
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
const statePath = path.join(directory, 'state.json')
const checksum = createHash('sha256').update(migration).digest('hex')
let state = { checksum, version: new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14), completed: [] }
if (fs.existsSync(statePath)) {
  assert.ok(process.argv.includes('--resume'), 'Prior attempt exists; inspect evidence before --resume')
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  assert.equal(state.checksum, checksum, 'Migration changed since partial run')
}
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
function query(label, sql) {
  const file = path.join(directory, label + '.sql')
  fs.writeFileSync(file, sql)
  const start = Date.now()
  const result = spawnSync('supabase', ['db', 'query', '--linked', '-f', file, '-o', 'json'], { cwd: root, encoding: 'utf8', timeout: 150000, maxBuffer: 4 * 1024 * 1024 })
  fs.writeFileSync(path.join(directory, label + '.json'), result.stdout || '')
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  console.log(`${label}: ${Date.now() - start} ms`)
  return JSON.parse(result.stdout).rows
}
function verifyFunctions() {
  const rows = query('verify-rpcs', `SELECT oid::regprocedure::text AS signature, md5(pg_get_functiondef(oid)) AS checksum,
    pg_get_userbyid(proowner) AS owner, prosecdef AS "securityDefiner", provolatile AS volatility, to_jsonb(proconfig) AS config, to_jsonb(proacl) AS acl
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('aka_agent_campaign_engagement_batch','aka_agent_campaign_engagement_revision',
      'aka_agent_list_campaign_details_page_v2','aka_agent_read_campaign_engagement','aka_agent_record_campaign_engagement','aka_agent_register_campaign_engagement')`)
  assert.equal(rows.length, target.length)
  for (const expected of target) {
    const actual = rows.find(r => r.signature === expected.signature)
    assert.ok(actual, expected.signature)
    for (const key of Object.keys(expected)) {
      const normalize = value => Array.isArray(value) ? [...value].sort() : value
      assert.deepEqual(normalize(actual[key]), normalize(expected[key]), `${expected.signature}: ${key}`)
    }
  }
}
function verifyIndexes(requireAll) {
  const rows = query('verify-indexes', `SELECT c.relname AS name,pg_get_indexdef(c.oid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live
    FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.relnamespace='public'::regnamespace
      AND (c.relname LIKE 'auto_campaign_engagement_%' OR c.relname LIKE 'chat_runtime_engagement_%')`)
  if (requireAll) assert.equal(rows.length, indexes.length)
  for (const actual of rows) {
    const expected = indexes.find(i => i.name === actual.name)
    assert.ok(expected, 'Unknown engagement index')
    assert.equal(actual.definition, expected.definition)
    assert.ok(actual.valid && actual.ready && actual.live, `Invalid index ${actual.name}; inspect build progress, never auto-drop`)
  }
  return new Set(rows.map(i => i.name))
}
try {
  save()
  if (!state.completed.includes('schema')) {
    query('schema', phases[0].sql)
    state.completed.push('schema'); save()
  }
  verifyFunctions()
  const existing = verifyIndexes(false)
  for (const phase of phases.slice(1, -1)) {
    if (state.completed.includes(phase.name)) continue
    if (!existing.has(phase.name)) query(phase.name, phase.sql)
    state.completed.push(phase.name); save()
  }
  verifyFunctions(); verifyIndexes(true)
  // History tables already exist. No setup DDL and no unrelated migration push.
  assert.ok(!migration.includes('$v339_history$'))
  const historySql = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    SELECT '${state.version}','${name}',ARRAY[$v339_history$${migration}$v339_history$]
    WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='${name}');
    SELECT version,name FROM supabase_migrations.schema_migrations WHERE name='${name}';`
  const finalSql = phases.at(-1).sql.replace(/COMMIT;\s*$/, historySql + '\nCOMMIT;')
  const result = query('postflight', finalSql)
  assert.equal(result.length, 1); assert.equal(result[0].version, state.version)
  state.completed.push('postflight'); save()
  console.log(JSON.stringify({ project: 'cgjbsmqtfhqvttudyjzq', checksum, history: result[0], enabled: false }))
} catch (error) {
  console.error(error.message)
  console.error(`Stopped. Inspect ${directory}; never blindly reapply schema or drop an index after an uncertain response.`)
  process.exitCode = 1
}
