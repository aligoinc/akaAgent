// Generate this narrow patch from the fresh live capture, never a historical body.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/group-sharing-revoke-ownership')
const capture = JSON.parse(fs.readFileSync(path.join(dir, 'before.json')))
assert.equal(capture.project, 'cgjbsmqtfhqvttudyjzq')
const source = capture.functions.find(f => f.name === 'aka_agent_group_sharing')
const lock = capture.functions.find(f => f.name === 'aka_agent_lock_campaign_input_serialization')
const md5 = s => crypto.createHash('md5').update(s).digest('hex')
const quote = s => "'" + s.replaceAll("'", "''") + "'"
const signature = f => f.signature.startsWith('private.') ? f.signature : 'public.' + f.signature
assert.equal(md5(source.definition), source.checksum)
assert.equal(md5(lock.definition), lock.checksum)

const anchor = '          PERFORM public.aka_agent_lock_campaign_input_serialization(v_row.campaign_id);'
assert.equal(source.definition.split(anchor).length, 2)
const lockBody = lock.definition.match(/  IF p_campaign_id IS NULL[\s\S]*?\n  \)\);/)[0]
// This is precisely the existing ID validation and transaction advisory lock.
// Only the already-authorized sharing-owner loop may use it without the public
// helper's token-to-campaign-owner guard. No role/GUC bypass is introduced.
const replacement = [
  '          -- The group owner may stop a revoked recipient\'s source after the',
  '          -- checks above. Keep the public helper guarded for direct callers.',
  '          -- Same lock key/order as aka_agent_lock_campaign_input_serialization.',
  lockBody.replaceAll('p_campaign_id', 'v_row.campaign_id')
    .split('\n').map(line => '        ' + line).join('\n')
].join('\n')
const definition = source.definition.replace(anchor, replacement)
assert.equal(definition.replace(replacement, anchor), source.definition)
const target = { ...source, definition, checksum: md5(definition) }
const guard = (functions, label) => `DO $guard$ BEGIN\n${functions.map(f =>
  ` IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(${quote(signature(f))})` +
  ` AND md5(pg_get_functiondef(oid))=${quote(f.checksum)}` +
  ` AND proacl::text IS NOT DISTINCT FROM ${f.acl === null ? 'NULL' : quote(f.acl)}` +
  ` AND pg_get_userbyid(proowner)=${quote(f.owner)})` +
  ` THEN RAISE EXCEPTION '${label}: %',${quote(signature(f))}; END IF;`
).join('\n')}\nEND $guard$;\n`
const deps = capture.functions.filter(f => f !== source)
const header = "SET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n"
const migration = '-- Candidate: preserve owner-authorized sharing revocation after Desktop ownership cutover.\n' +
  '-- Only the captured sharing RPC body changes; existing ACL/RLS/helpers remain unchanged.\n' + header +
  guard(capture.functions, 'sharing revoke source drift') + definition + ';\n' +
  guard([target, ...deps], 'sharing revoke target mismatch') + "NOTIFY pgrst,'reload schema';\n"
const rollback = '-- Manual rollback of this one body; restores the sharing-revocation bug.\n' + header +
  "DO $approval$ BEGIN IF current_setting('aka_agent.group_sharing_revoke_rollback',true) IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'sharing revoke rollback requires approval'; END IF; END $approval$;\n" +
  guard([target, ...deps], 'sharing revoke rollback drift') + source.definition + ';\n' +
  guard(capture.functions, 'sharing revoke rollback mismatch') + "NOTIFY pgrst,'reload schema';\n"
const migrationPath = 'supabase/migrations/20261028042624_group_sharing_revoke_ownership_compat.sql'
fs.writeFileSync(path.join(root, migrationPath), migration)
fs.writeFileSync(path.join(root, 'migrations/rollback_group_sharing_revoke_ownership_compat.sql'), rollback)
fs.writeFileSync(path.join(dir, 'target.json'), JSON.stringify(target, null, 2) + '\n')

const sqlFiles = execFileSync('rg', ['--files', 'migrations', 'supabase/migrations', '-g', '*.sql'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const mentions = [source, lock].map(f => ({
  signature: signature(f), sourceChecksum: f.checksum,
  files: sqlFiles.filter(file => file !== migrationPath && !file.includes('/snapshots/') &&
    !file.includes('/tests/') && !file.includes('/rollback_') &&
    fs.readFileSync(path.join(root, file), 'utf8').includes(f.name))
}))
assert(fs.readFileSync(path.join(root, 'supabase/migrations/20261027180909_staff_sharing_directory.sql'), 'utf8').includes(source.definition.trim()))
assert(fs.readFileSync(path.join(root, 'supabase/migrations/20261027183537_desktop_account_campaign_ownership.sql'), 'utf8').includes(lock.definition.trim()))
fs.writeFileSync(path.join(dir, 'source-audit.json'), JSON.stringify({
  project: capture.project, capturedAt: capture.captured_at, migrationPath,
  sourceChecksum: source.checksum, targetChecksum: target.checksum,
  sourceMatchesLatestRepositoryDefinition: true, unrelatedBodyPreserved: true,
  copiedLockBlock: lockBody, mentions
}, null, 2) + '\n')
console.log(JSON.stringify({ migrationPath, source: source.checksum, target: target.checksum }))
