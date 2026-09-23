// Applies only v315, through the existing linked Management API connection.
// Each phase is a separate request: CREATE INDEX CONCURRENTLY cannot be wrapped.
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { resolve, join } = require('node:path')
const { tmpdir } = require('node:os')
const root = resolve(__dirname, '..')
const migration = readFileSync(join(root, 'migrations/migration_v315_campaign_details_page_index.sql'), 'utf8')
const phases = Object.fromEntries([...migration.matchAll(/-- @phase (\w+)\n([\s\S]*?)(?=-- @phase |$)/g)].map(match => [match[1], match[2]]))
assert.equal(readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), 'cgjbsmqtfhqvttudyjzq', 'Wrong linked project')
assert.deepEqual(Object.keys(phases), ['preflight', 'build', 'postflight'])
if (!process.argv.includes('--apply')) {
  console.log('v315: preflight → concurrent index build (existing 2-minute API timeout) → verify + migration history. Use --apply to execute.')
  process.exit(0)
}
const directory = mkdtempSync(join(tmpdir(), 'akaagent-v315-'))
function query(name, sql) {
  const file = join(directory, name + '.sql')
  writeFileSync(file, sql)
  const result = spawnSync('supabase', ['db', 'query', '--linked', '-f', file, '-o', 'json'],
    { cwd: root, encoding: 'utf8', timeout: 150000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  return JSON.parse(result.stdout).rows
}
try {
  query('preflight', phases.preflight)
  console.log('PASS preflight: order keys NOT NULL; existing index absent or exact and valid.')
  const start = Date.now()
  query('build', phases.build)
  console.log(`Concurrent index build returned after ${Date.now() - start} ms.`)
  const name = 'migration_v315_campaign_details_page_index'
  const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  assert.ok(!migration.includes('$v315_history$'))
  const rows = query('postflight', `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s';
    ${phases.postflight}
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    SELECT '${version}','${name}',ARRAY[$v315_history$${migration}$v315_history$]
    WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='${name}');
    SELECT version,name,pg_relation_size('public.idx_campaign_details_page') AS index_bytes
    FROM supabase_migrations.schema_migrations WHERE name='${name}'; COMMIT;`)
  console.log(JSON.stringify(rows))
} catch (error) {
  // Never drop an invalid index automatically after an uncertain API response.
  // Inspect pg_index and pg_stat_progress_create_index before manual recovery.
  console.error(error.message)
  process.exitCode = 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
