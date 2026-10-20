// Read-only verification of the applied V416 schema through the existing public HTTP API.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const root = path.resolve(__dirname, '..')
  const snapshotDir = path.join(root, 'migrations/snapshots/ai-form-configs-v416')
  const source = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'source.json'), 'utf8')).source
  const schemas = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'schemas.json'), 'utf8'))
  const clientSource = fs.readFileSync(path.join(root, 'src/main/data/supabaseClient.ts'), 'utf8')
  const envFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, '.env')
  const localEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {}
  const env = process.argv[2] ? localEnv : { ...localEnv, ...process.env }
  const url = env.SUPABASE_URL || 'https://cgjbsmqtfhqvttudyjzq.supabase.co'
  assert.equal(new URL(url).origin, 'https://cgjbsmqtfhqvttudyjzq.supabase.co')
  const key = env.SUPABASE_ANON_KEY
    || clientSource.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)?.[1]
  assert(key, 'Existing public client key missing')
  if (key.startsWith('eyJ')) assert.equal(JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role, 'anon')
  else assert(key.startsWith('sb_publishable_'), 'Only a public key is allowed')
  const headers = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) }
  const base = 'https://cgjbsmqtfhqvttudyjzq.supabase.co/rest/v1/'
  const response = await fetch(`${base}ai_form_configs?select=*,ai_model(id,is_active)&order=id`, {
    headers, signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`Configuration HTTP ${response.status}: ${await response.text()}`)
  const rows = await response.json()
  assert.equal(rows.length, 2)
  for (const row of rows) {
    const original = source.find(s => s.using.code === row.code)
    assert(original)
    assert.equal(row.prompt_system, original.prompt.prompt_system)
    assert.equal(row.prompt_user, original.prompt.prompt_user)
    assert.deepEqual(row.output_schema, schemas[row.code])
    assert.equal(row.model_id, 21)
    assert.equal(row.ai_model.id, 21)
    assert.equal(row.ai_model.is_active, true)
    assert.equal(row.campaign_scope, 'all')
    assert.deepEqual(row.campaign_action_ids, [])
    assert.equal(row.is_active, true)
    assert.equal(row.mobile_section_id, null)
  }
  const logs = await fetch(`${base}ai_log?select=form_config_id&limit=1`, {
    headers, signal: AbortSignal.timeout(10_000)
  })
  assert.equal(logs.status, 401, 'Client must not gain access to log contents')
  assert.equal((await logs.json()).code, '42501')
  const ids = await fetch(`${base}ai_log?select=id&limit=1`, { headers, signal: AbortSignal.timeout(10_000) })
  assert.equal(ids.status, 200, 'Existing insert-returning-ID contract must remain readable')
  const receipt = { checkedAt: new Date().toISOString(), project: 'cgjbsmqtfhqvttudyjzq',
    status: 'PASS', rows: rows.map(r => ({ id: r.id, code: r.code, modelId: r.model_id })),
    checks: ['prompt byte equality', 'schema deep equality', 'active seeds and all scope', 'model FK schema cache', 'log contents stay private; ID-only read allowed'] }
  fs.writeFileSync(path.join(snapshotDir, 'http-smoke.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log('PASS V416 live HTTP: exact prompts/schema, metadata seeds, model relation and preserved log read restrictions')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
