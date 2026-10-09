// Existing linked Management API only: no SQL connection or pool is introduced.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./fb-email-policy-migration.cjs')

const root = path.resolve(__dirname, '..')
const ref = 'cgjbsmqtfhqvttudyjzq'
const version = 361
const name = `migration_v${version}_action_status_policy_catalog`
const directory = path.join(root, `migrations/snapshots/action-status-policies-v${version}`)
const configTables = ['auto_status', 'auto_error', 'auto_account_actions',
  'auto_campaign_action_detail_statuses', 'auto_automation_trigger_statuses']
const newTable = 'auto_account_action_status_policies'
const schemaTables = [...configTables, 'auto_campaign_details', 'auto_campaign_inputs',
  'auto_campaign_input_data', 'auto_campaigns', newTable]
const hash = (s, algorithm = 'sha256') => createHash(algorithm).update(s).digest('hex')
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const jsonSQL = (value, tag = 'value') => {
  const valueText = JSON.stringify(value)
  assert(!valueText.includes(`$${tag}$`))
  return `$${tag}$${valueText}$${tag}$::jsonb`
}
const write = (file, value, exclusive = true) => {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })
}
const read = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))

function schemaSQL(table) {
  const rel = `to_regclass('public.${table}')`
  return `jsonb_build_object('table',${quote(table)},'exists',${rel} IS NOT NULL,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=${rel} AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid=${rel}),
    'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid=${rel}),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename=${quote(table)}),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=${rel} AND NOT tgisinternal),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename=${quote(table)}),
    'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid=${rel}),
    'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name=${quote(table)}),
    'sequence',(SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename=${quote(table + '_id_seq')}))`
}

function snapshot() {
  const hasNewTable = query(`SELECT to_regclass('public.${newTable}') IS NOT NULL AS present`)[0].present
  const tables = [...configTables, ...(hasNewTable ? [newTable] : [])]
  const tableSQL = tables.map(table => `${quote(table)},(SELECT jsonb_build_object(
    'count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)->>'id',to_jsonb(t)->>'code'),'')),
    'rows',coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'canonical',to_jsonb(t)::text,'md5',md5(to_jsonb(t)::text)) ORDER BY to_jsonb(t)->>'id',to_jsonb(t)->>'code'),'[]'::jsonb)) FROM public.${table} t)`).join(',\n')
  return query(`BEGIN READ ONLY;
    SELECT ${quote(ref)} AS project_ref,clock_timestamp() AS captured_at,
    current_setting('server_version') AS server_version,
    jsonb_build_object(${tableSQL}) AS tables,
    jsonb_build_array(${schemaTables.map(schemaSQL).join(',\n')}) AS schema,
    (SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl) ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.prosrc ~ '(auto_campaign_details|auto_automation_trigger_statuses|auto_campaign_action_detail_statuses|auto_status|auto_error|increment_auto_account_action_count|aka_agent_auth_staff)') AS functions,
    (SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20) m) AS recent_migrations;
    COMMIT;`)[0]
}

function validateSnapshot(value) {
  assert.equal(value.project_ref, ref)
  for (const [table, data] of Object.entries(value.tables)) {
    assert.equal(data.count, data.rows.length, `${table}: row count`)
    const columns = value.schema.find(s => s.table === table).columns.map(c => c.name).sort()
    for (const item of data.rows) {
      assert.deepEqual(JSON.parse(item.canonical), item.row)
      assert.equal(hash(item.canonical, 'md5'), item.md5, `${table}: row checksum`)
      assert.deepEqual(Object.keys(item.row).sort(), columns, `${table}: all columns required`)
    }
    assert.equal(hash(data.rows.map(r => r.canonical).join('|'), 'md5'), data.md5, `${table}: table checksum`)
  }
  for (const f of value.functions || []) assert.equal(hash(f.definition, 'md5'), f.md5, f.signature)
}

function checkedBackup() {
  const preApply = fs.existsSync(path.join(directory, 'before-apply.json'))
  const file = preApply ? 'before-apply.json' : 'before.json'
  const before = read(file)
  const manifest = read(preApply ? 'before-apply-manifest.json' : 'backup-manifest.json')
  assert.equal(hash(fs.readFileSync(path.join(directory, file))), manifest.before_sha256)
  validateSnapshot(before)
  return before
}

function originalRowsUnchanged(before, after) {
  const independentTimestampChanges = []
  for (const [table, data] of Object.entries(before.tables)) {
    const rows = new Map(after.tables[table].rows.map(x => [String(x.row.id ?? x.row.code), x.row]))
    for (const item of data.rows) {
      const row = rows.get(String(item.row.id ?? item.row.code))
      assert(row, `${table}: original row missing`)
      for (const [key, val] of Object.entries(item.row)) {
        // The existing enqueue RPC UPSERT refreshes this timestamp on each live
        // result. v361 never writes this table; all other fields remain guarded.
        if (table === 'auto_campaign_action_detail_statuses' && key === 'updated_at' && row[key] !== val) {
          independentTimestampChanges.push({table,id:item.row.id,before:val,after:row[key]})
        } else assert.deepEqual(row[key], val, `${table}/${item.row.id ?? item.row.code}/${key}: original changed`)
      }
    }
  }
  return independentTimestampChanges
}

function capture() {
  const before = snapshot()
  validateSnapshot(before)
  assert(!before.schema.find(s => s.table === newTable).exists, 'Catalog already exists; inspect rather than overwrite')
  assert(!before.recent_migrations.some(m => new RegExp(`^migration_v${version}(?:_|$)`).test(m.name || '')), 'Migration version already used')
  write('before.json', before)
  write('backup-manifest.json', { project_ref: ref, captured_at: before.captured_at,
    before_sha256: hash(fs.readFileSync(path.join(directory, 'before.json'))),
    tables: Object.fromEntries(Object.entries(before.tables).map(([k,v]) => [k,{ count:v.count,md5:v.md5 }])),
    schema_sha256: hash(JSON.stringify(before.schema)), functions: before.functions.map(f => ({signature:f.signature,md5:f.md5})) })
  checkedBackup()
  console.log(JSON.stringify({ snapshot: directory, tables: Object.fromEntries(Object.entries(before.tables).map(([k,v]) => [k,v.count])), functions: before.functions.length, verified: true }))
}

function main() {
  const command = process.argv[2]
  if (command === 'capture') capture()
  else if (command === 'check-backup') { checkedBackup(); console.log('Backup checksums verified') }
  else throw Error('Usage: action-status-policy-migration.cjs capture|check-backup')
}

module.exports = { root, ref, version, name, directory, configTables, schemaTables, newTable,
  hash, quote, jsonSQL, write, read, schemaSQL, snapshot, validateSnapshot, checkedBackup, originalRowsUnchanged, query }
if (require.main === module) main()
