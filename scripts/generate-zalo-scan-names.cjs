// Build V441 from the definitions captured live in this task, never from V421.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/zalo-scan-names')
const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'))
if (source.projectRef !== 'cgjbsmqtfhqvttudyjzq') throw new Error('Unexpected project')
const md5 = value => createHash('md5').update(value).digest('hex')
const replaceOnce = (text, from, to) => {
  if (text.split(from).length !== 2) throw new Error('Expected one live fragment: ' + from)
  return text.replace(from, to)
}
const targets = source.functions.map(row => {
  let definition = row.definition
  if (md5(definition) !== row.checksum) throw new Error('Corrupt capture')
  if (row.signature.includes('column_filter_predicate_v1')) {
    for (const key of ['contacts', 'remarketing']) {
      definition = replaceOnce(definition, `"${key}":{`, `"${key}":{"zaloOriginalName":{"kind":"text"},`)
    }
  } else if (row.signature.includes('read_filtered_contacts')) {
    definition = replaceOnce(definition, "to_jsonb(c)||jsonb_build_object('extra_data',", "to_jsonb(c)||jsonb_build_object('zalo_original_name',NULLIF(btrim(zu.zalo_name),''),'extra_data',")
    definition = replaceOnce(definition, 'c.name AS "f_name"', 'NULLIF(btrim(zu.zalo_name),\'\') AS "f_zaloOriginalName", c.name AS "f_name"')
  } else if (row.signature.includes('read_filtered_remarketing')) {
    definition = replaceOnce(definition, ' AS "f_name",', ' AS "f_name",\nNULLIF(btrim(u.zalo_name),\'\') AS "f_zaloOriginalName",')
    definition = replaceOnce(definition, "'name',c.f_name,'uid'", "'name',c.f_name,'zalo_original_name',c.\"f_zaloOriginalName\",'uid'")
  } else throw new Error('Unexpected function')
  return { ...row, signature: row.signature.startsWith(row.schema + '.') ? row.signature : row.schema + '.' + row.signature, definition, checksum: md5(definition), sourceChecksum: row.checksum }
})
function guard(rows, allowSource = false) {
  const manifest = rows.map(({definition, schema, ...row}) => row)
  return `DO $guard$\nDECLARE e jsonb; actual record;\nBEGIN\n FOR e IN SELECT value FROM jsonb_array_elements($manifest$${JSON.stringify(manifest)}$manifest$::jsonb) LOOP\n  SELECT md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text acl INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure(e->>'signature');\n  IF NOT FOUND OR actual.checksum NOT IN (e->>'checksum'${allowSource ? ",e->>'sourceChecksum'" : ''}) OR actual.owner IS DISTINCT FROM e->>'owner' OR actual.prosecdef IS DISTINCT FROM (e->>'prosecdef')::boolean OR actual.provolatile::text IS DISTINCT FROM e->>'provolatile' OR to_jsonb(actual.proconfig) IS DISTINCT FROM e->'proconfig' OR actual.acl IS DISTINCT FROM e->>'acl' THEN\n   RAISE EXCEPTION 'V441 function drift: %',e->>'signature';\n  END IF;\n END LOOP;\nEND $guard$;\n`
}
const original = targets.map(row => ({ ...row, definition: source.functions.find(f => f.checksum === row.sourceChecksum).definition, checksum: row.sourceChecksum }))
const migration = `-- V441: Zalo scan original names. Built from the captured live definitions.\n-- Preserve live owner/ACL/security/config; no schema reload or additional DB calls.\nBEGIN;\nSET LOCAL lock_timeout = '5s';\n${guard(targets, true)}\n${targets.map(r => r.definition + ';').join('\n')}\n${guard(targets)}COMMIT;\n`
const rollback = `-- Explicit rollback only, guarded by the exact V441 target and current ACL.\nBEGIN;\nSET LOCAL lock_timeout = '5s';\n${guard(targets)}\n${original.map(r => r.definition + ';').join('\n')}\n${guard(original)}COMMIT;\n`
fs.writeFileSync(path.join(root, 'migrations/migration_v441_zalo_scan_names.sql'), migration)
fs.writeFileSync(path.join(dir, 'rollback.sql'), rollback)
fs.writeFileSync(path.join(dir, 'target.json'), JSON.stringify({projectRef:source.projectRef, functions:targets}, null, 2) + '\n')
console.log('Generated V441 and guarded rollback from live capture; generation does not apply SQL.')
