// Verify the applied V409 without reapplying it. Every fixture/rollback rehearsal
// runs inside a transaction ending in ROLLBACK.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const snapshots = path.join(root, 'migrations/snapshots/group-sharing-v409')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const save = (file, value) => fs.writeFileSync(path.join(snapshots, file), JSON.stringify(value, null, 2) + '\n')
assert.equal(read('supabase/.temp/project-ref').trim(), 'cgjbsmqtfhqvttudyjzq')
const source = JSON.parse(fs.readFileSync(path.join(snapshots, 'apply-live-before.json'), 'utf8'))
const inventory = JSON.parse(fs.readFileSync(path.join(snapshots, 'inventory.json'), 'utf8'))
const expected = JSON.parse(fs.readFileSync(path.join(snapshots, 'expected-functions.json'), 'utf8'))
const migration = read('migrations/migration_v409_group_sharing.sql')
const smoke = read('migrations/tests/migration_v409_group_sharing_smoke.sql')
const originalOids = inventory.map(row => `to_regprocedure('public.${row.signature}')`).join(',')
const newPrivateNames = [
  'group_access', 'can_read_data_group', 'lock_read_data_group',
  'shared_data_member_owner', 'stop_invalid_staff_group_sources',
  'list_shared_data_groups', 'read_shared_group_members', 'copy_shared_group'
]
const functionsSql = `SELECT p.oid::regprocedure::text signature,
  pg_get_functiondef(p.oid) definition, md5(pg_get_functiondef(p.oid)) checksum,
  pg_get_userbyid(p.proowner) owner, p.prosecdef, p.provolatile,
  p.proconfig, p.proacl::text proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid IN (${originalOids})
  OR (n.nspname='private' AND p.proname IN (${newPrivateNames.map(name => `'${name}'`).join(',')}))
  OR p.oid=to_regprocedure('public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)')
  ORDER BY 1;`
function query(sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharing-applied-query-'))
  try {
    const file = path.join(dir, 'query.sql')
    fs.writeFileSync(file, sql, { mode: 0o600 })
    return JSON.parse(cp.execFileSync('supabase', ['db', 'query', '--linked', '--file', file, '--output', 'json'], {
      cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })).rows
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const live = query(functionsSql)
assert.equal(live.length, inventory.length + newPrivateNames.length + 1)
for (const original of source.functions) {
  const actual = live.find(row => row.signature === original.signature)
  const target = expected.find(row => row.signature === original.signature) || original
  for (const key of ['checksum', 'owner', 'prosecdef', 'provolatile', 'proconfig', 'proacl']) {
    assert.deepEqual(actual[key], target[key], `${original.signature}: ${key}`)
  }
}
const added = live.filter(row => !source.functions.some(original => original.signature === row.signature))
for (const row of added) {
  assert.equal(row.owner, 'postgres', row.signature)
  assert.equal(row.prosecdef, true, row.signature)
  if (row.signature.startsWith('private.')) {
    assert.equal(row.proacl, '{postgres=X/postgres}', row.signature)
  }
}
const state = query(`SELECT jsonb_build_object(
  'history',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name))
    FROM supabase_migrations.schema_migrations WHERE name='migration_v409_group_sharing'),
  'legacyAcl',(SELECT jsonb_agg(x ORDER BY relation) FROM (
    SELECT oid::regclass::text relation,relacl::text acl,relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) owner
    FROM pg_class WHERE oid IN ('public.auto_account_contact_groups'::regclass,'public.auto_account_contacts'::regclass,
      'public.auto_account_contact_group_members'::regclass,'public.auto_content_groups'::regclass,'public.auto_content_templates'::regclass)) x),
  'newTables',(SELECT jsonb_agg(x ORDER BY relation) FROM (
    SELECT oid::regclass::text relation,relacl::text acl,relrowsecurity,pg_get_userbyid(relowner) owner
    FROM pg_class WHERE oid IN ('public.auto_data_group_recipients'::regclass,
      'public.auto_content_group_recipients'::regclass,'private.group_copy_requests'::regclass)) x),
  'columns',(SELECT jsonb_agg(x ORDER BY table_name,column_name) FROM (
    SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('auto_account_contact_groups','auto_content_groups')
      AND column_name IN ('sharing_scope','sharing_revision')) x),
  'scopes',(SELECT jsonb_agg(x ORDER BY kind,sharing_scope) FROM (
    SELECT 'data' kind,sharing_scope,count(*) count FROM public.auto_account_contact_groups GROUP BY sharing_scope
    UNION ALL SELECT 'content',sharing_scope,count(*) FROM public.auto_content_groups GROUP BY sharing_scope) x),
  'trigger',(SELECT jsonb_build_object('enabled',tgenabled,'definition',pg_get_triggerdef(oid))
    FROM pg_trigger WHERE tgrelid='public.org_staff'::regclass AND tgname='group_sharing_staff_scope_changed')
) state;`)[0].state
assert.equal(state.history.length, 1)
assert.deepEqual(state.legacyAcl, source.legacyAcl, 'Legacy table permissions changed')
assert.equal(state.newTables.length, 3)
for (const table of state.newTables) {
  assert.equal(table.relrowsecurity, true, table.relation)
  // PostgreSQL 17 adds the owner's MAINTAIN privilege ("m").
  assert.match(table.acl, /^\{postgres=arwdDxtm?\/postgres\}$/, table.relation)
}
assert.equal(state.columns.length, 4)
for (const column of state.columns) assert.equal(column.is_nullable, 'NO')
assert.equal(state.trigger.enabled, 'O')
save('apply-live-after.json', { capturedAt: new Date().toISOString(), functions: live, state })
assert.deepEqual(query('BEGIN;\n' + smoke + '\n' + functionsSql + '\nROLLBACK;'), live)
const rollback = read('migrations/tests/migration_v409_group_sharing_rollback.sql')
  .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const restored = query('BEGIN;\nSET LOCAL lock_timeout=\'5s\';\n' + rollback + '\n' + functionsSql + '\nROLLBACK;')
for (const original of source.functions) {
  assert.deepEqual(restored.find(row => row.signature === original.signature), original)
}
assert.deepEqual(query(functionsSql), live, 'Post-check database functions changed')
save('apply-verification.json', {
  at: new Date().toISOString(), project: 'akachat', projectId: 'cgjbsmqtfhqvttudyjzq',
  migration: state.history[0], migrationSha256: crypto.createHash('sha256').update(migration).digest('hex'),
  migrationApplied: true, applicationDeployed: false,
  sqlSmoke: 'passed in rollback transaction', rollbackRehearsal: 'passed in rollback transaction',
  preservedOriginalAttributes: true, legacyAclUnchanged: true, newTablesRlsRpcOnly: true,
  patchedFunctions: expected.map(target => ({
    signature: target.signature,
    sourceChecksum: source.functions.find(row => row.signature === target.signature).checksum,
    targetChecksum: target.checksum
  })),
  newFunctions: added.map(row => ({ signature: row.signature, checksum: row.checksum }))
})
console.log('PASS applied V409: bodies/attributes, legacy ACL, new schema/RLS, role/behavior smoke, rollback rehearsal; live V409 retained')
console.log(JSON.stringify(state.history[0]))
