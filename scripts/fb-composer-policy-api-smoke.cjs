// Read-only PostgREST verification. Does not refresh the schema cache.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
const v = require('./fb-composer-policy-v375.cjs')
async function main() {
  assert.equal(fs.readFileSync(path.join(m.root, 'supabase/.temp/project-ref'), 'utf8').trim(), m.ref)
  const source = fs.readFileSync(path.join(m.root, 'src/main/data/supabaseClient.ts'), 'utf8')
  const key = source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const checks = []
  for (const [table, filter, columns] of [
    ['auto_blocks', 'id=eq.27', 'id,code'],
    ['auto_error', 'id=eq.94', 'id,error_code,detail_mode,noti_running_process,noti_campaign'],
    ['auto_workflows', 'id=in.(1,2,251,252)', 'id,nodes,edges']
  ]) {
    const response = await fetch(`https://${m.ref}.supabase.co/rest/v1/${table}?${filter}&select=${columns}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000)
    })
    assert.equal(response.status, 200, table)
    const rows = await response.json(), expected = v.desired().filter(r => r.table === table)
    if (table === 'auto_error') {
      const row = v.backup().tables.auto_error.rows.find(r => r.row.id === 94).row
      expected.push({id:94,fields:Object.fromEntries(columns.split(',').map(k=>[k,row[k]]))})
    }
    assert.equal(rows.length, expected.length, table)
    for (const change of expected) {
      const row = rows.find(r => r.id === change.id); assert(row)
      for (const [field, value] of Object.entries(change.fields)) assert.deepEqual(row[field], value, `${table}/${row.id}/${field}`)
    }
    checks.push({ table, status: response.status, verified_rows: rows.length })
  }
  v.save('api-smoke.json', { at: new Date().toISOString(), project_ref: m.ref, checks, schema_reload: false })
  console.log({ checks, schema_reload: false })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
