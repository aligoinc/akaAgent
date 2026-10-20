// V414 verification. Candidate changes and rollback rehearsals never persist.
// Before apply: node scripts/group-sharing/verify-account-name.cjs
// After apply:  node scripts/group-sharing/verify-account-name.cjs --applied
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const snapshots = path.join(root, 'migrations/snapshots/group-sharing-v414')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(snapshots, 'manifest.json'), 'utf8'))
const applied = process.argv.includes('--applied')
assert.equal(read('supabase/.temp/project-ref').trim(), 'cgjbsmqtfhqvttudyjzq')
const migration = read('migrations/migration_v414_shared_group_source_account_name.sql')
const smoke = read('migrations/tests/migration_v414_shared_group_source_account_name_smoke.sql')
const fullSmoke = read('migrations/tests/migration_v409_group_sharing_smoke.sql')
const rollback = read('migrations/tests/migration_v414_shared_group_source_account_name_rollback.sql')
  .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const functionsSql = `SELECT p.oid::regprocedure::text signature,
  md5(pg_get_functiondef(p.oid)) checksum, pg_get_userbyid(p.proowner) owner,
  p.prosecdef, p.provolatile, p.proconfig, p.proacl::text proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid=to_regprocedure('${manifest.signature}')
    OR (n.nspname='private' AND p.proname='read_shared_group_members') ORDER BY 1;`
function query(sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharing-account-name-'))
  try {
    const file = path.join(dir, 'query.sql')
    fs.writeFileSync(file, sql, { mode: 0o600 })
    return JSON.parse(cp.execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'], {
      cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })).rows
  } catch (error) {
    console.error(error.stderr?.toString() || error.message)
    throw error
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const live = query(functionsSql)
assert.equal(live.length, 2)
const publicRow = rows => rows.find(row => row.signature === manifest.sourceAttributes.signature)
const privateRow = rows => rows.find(row => row.signature.startsWith('private.'))
function check(rows, checksum) {
  assert.equal(rows.length, 2)
  assert.deepEqual(publicRow(rows), { ...manifest.sourceAttributes, checksum })
  assert.deepEqual(privateRow(rows), privateRow(live))
  assert.equal(privateRow(rows).checksum, 'bcae895d24daf017a1e52a83e834f1a9')
}
check(live, applied ? manifest.targetChecksum : manifest.sourceChecksum)
const transaction = (sql, visible) => query(`BEGIN;
SET LOCAL aka_agent.v414_expect_visible='${visible}';
${sql}
${functionsSql}
ROLLBACK;`)
if (!applied) {
  check(transaction(smoke, false), manifest.sourceChecksum)
  console.log('PASS baseline V409: source name hidden, owner/private-account boundaries preserved')
}
const candidate = applied ? '' : migration
check(transaction(candidate + '\n' + smoke, true), manifest.targetChecksum)
console.log('PASS V414: owner/shared names, accountless/deleted/filter/page, real anon/service roles, redaction, cross-org/nonselected/admin/revoke/copy')
check(transaction(candidate + '\n' + fullSmoke, true), manifest.targetChecksum)
console.log('PASS V409 full regression under V414: sharing/CAS/copy/campaign source/Zalo account permissions')
check(transaction(candidate + '\n' + rollback + '\n' + smoke, false), manifest.sourceChecksum)
console.log('PASS V414 rollback rehearsal: original RPC and name redaction restored inside ROLLBACK')
assert.deepEqual(query(functionsSql), live, 'Verification changed live functions')
const history = query(`SELECT version,name FROM supabase_migrations.schema_migrations
  WHERE name='migration_v414_shared_group_source_account_name';`)
assert.equal(history.length, applied ? 1 : 0)
fs.writeFileSync(path.join(snapshots, applied ? 'apply-verification.json' : 'preflight-verification.json'), JSON.stringify({
  at: new Date().toISOString(), project: 'akachat', projectId: 'cgjbsmqtfhqvttudyjzq',
  migration: history[0] || null, migrationSha256: crypto.createHash('sha256').update(migration).digest('hex'),
  migrationApplied: applied, applicationDeployed: false,
  sourceChecksum: manifest.sourceChecksum, targetChecksum: manifest.targetChecksum,
  liveFunctions: live,
  tests: ['V414 source names and authorization through real anon/service_role roles', 'V409 full regression', 'V414 rollback rehearsal'],
  liveUnchangedByTests: true
}, null, 2) + '\n')
console.log(`PASS ${applied ? 'applied' : 'preflight'} verification; live functions unchanged by tests`)
