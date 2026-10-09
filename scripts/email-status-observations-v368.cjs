// Build only from the verified definitions captured from linked akachat.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
const name = 'migration_v368_email_status_observations'
const dir = path.join(m.root, 'migrations/snapshots/email-status-observations-v368')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const manifest = read('before-manifest.json')
assert.equal(manifest.project_ref, m.ref)
for (const [file, checksum] of Object.entries(manifest.files)) assert.equal(m.hash(fs.readFileSync(path.join(dir, file))), checksum, file)
const before = read('before.json'), functions = read('functions-before.json')
m.validateSnapshot(before)
assert.equal(functions.length, 3)
const targets = functions.map(f => {
  assert.equal(m.hash(f.definition, 'md5'), f.md5, f.signature)
  const condition = "d.report_group='success'"
  assert.equal(f.definition.split(condition).length, 2, f.signature + ': expected one predicate')
  const definition = f.definition.replace(condition, "d.policy_snapshot->>'operationState'='committed'")
  return { ...f, definition, md5: m.hash(definition, 'md5'), source_md5: f.md5 }
})
function guards(expected) {
  return expected.map(f => {
    const reg = `to_regprocedure(${m.quote('public.' + f.signature)})`
    const attrs = Object.fromEntries(['owner','security_definer','volatility','settings','acl'].map(k => [k,f[k]]))
    return `IF ${reg} IS NULL OR md5(pg_get_functiondef(${reg}))<>${m.quote(f.md5)} THEN RAISE EXCEPTION 'v368 function drift: ${f.signature}'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=${reg}) IS DISTINCT FROM ${m.jsonSQL(attrs,'attrs')} THEN RAISE EXCEPTION 'v368 attributes drift: ${f.signature}'; END IF;`
  }).join('\n')
}
function transaction(expected, replacements, comment) {
  return `-- ${comment}
-- Source: migrations/snapshots/email-status-observations-v368.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
${guards(expected)}
END $preflight$;
${replacements.map(f => f.definition + ';').join('\n\n')}
-- Signatures/ACL/schema unchanged. No additional schema-cache notification.
COMMIT;
`
}
const migration = () => transaction(functions, targets,
  'Email observations use saved delivery evidence, independently of report grouping. No history backfill.')
const rollback = () => transaction(targets, functions,
  'Restore only these three function bodies after drift checks. Keep all historical data and schema.')
function build() {
  fs.writeFileSync(path.join(m.root, 'migrations', name + '.sql'), migration())
  fs.writeFileSync(path.join(m.root, 'migrations/tests', name + '_rollback.sql'), rollback())
  fs.writeFileSync(path.join(dir, 'targets.json'), JSON.stringify(targets, null, 2) + '\n')
  console.log({ built: name, functions: targets.length })
}
module.exports = { m, name, dir, before, functions, targets, guards, migration, rollback, read }
if (require.main === module) build()
