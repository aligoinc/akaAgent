// Read-only PostgREST checks; only the repository's public anon key is used.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'src/main/data/supabaseClient.ts'), 'utf8')
const url = source.match(/const SUPABASE_URL = process\.env\.SUPABASE_URL \|\| '([^']+)'/)[1]
const key = source.match(/const SUPABASE_ANON_KEY = process\.env\.SUPABASE_ANON_KEY \|\| '([^']+)'/)[1]
const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
assert.equal(url, 'https://cgjbsmqtfhqvttudyjzq.supabase.co')
assert.equal(claims.ref, 'cgjbsmqtfhqvttudyjzq')
assert.equal(claims.role, 'anon')
const device = { staffId: 1, fingerprintHash: 'a'.repeat(64), legacyHash: null, source: 'automatic',
  requestId: '00000000-0000-4000-8000-000000000001', expected: { hash: null, version: 2, revision: '0' } }
const cases = [
  { name: 'security status keeps C disabled', route: 'rpc/aka_agent_staff_security_status', body: {}, status: 200, validate: b => assert.equal(b.legacyRecoveryAllowed, true) },
  { name: 'prepare v3 requires credentials', route: 'rpc/aka_agent_staff_client', body: { p_username: '', p_password: '', p_action: 'prepare_device_v3', p_data: { fingerprintHash: device.fingerprintHash, legacyHash: null, source: 'automatic' } }, status: 400, message: 'staff_client_auth_invalid' },
  { name: 'bind v3 requires credentials', route: 'rpc/aka_agent_staff_client', body: { p_username: '', p_password: '', p_action: 'bind_device_v3', p_data: device }, status: 400, message: 'staff_client_auth_invalid' },
  { name: 'existing read still requires credentials', route: 'rpc/aka_agent_staff_client', body: { p_username: '', p_password: '', p_action: 'read', p_data: {} }, status: 400, message: 'staff_client_auth_invalid' },
  { name: 'fingerprint alone cannot recover credentials', route: 'rpc/aka_agent_recover_staff_credentials', body: { p_secret: '', p_fingerprint_hash: device.fingerprintHash }, status: 400, message: 'staff_recovery_invalid' },
  { name: 'legacy table ACL retained without reading rows', route: 'org_staff?select=id&limit=0', status: 200, validate: b => assert.deepEqual(b, []) }
]
async function main() {
  const checks = []
  for (const test of cases) {
    const response = await fetch(url + '/rest/v1/' + test.route, { method: test.body ? 'POST' : 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      ...(test.body ? { body: JSON.stringify(test.body) } : {}), signal: AbortSignal.timeout(15000) })
    const data = await response.json()
    assert.equal(response.status, test.status, test.name)
    if (test.message) { assert.equal(data.code, 'P0001'); assert.equal(data.message, test.message) }
    test.validate?.(data)
    checks.push({ name: test.name, status: response.status, ...(test.message ? { code: data.code, message: data.message } : {}), passed: true })
  }
  const receipt = { projectRef: claims.ref, checkedAt: new Date().toISOString(), customerRowsRead: 0, businessWrites: false, checks }
  fs.writeFileSync(path.join(root, 'migrations/snapshots/device-identity-v3/production-http.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(checks.length + ' read-only production HTTP checks passed')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
