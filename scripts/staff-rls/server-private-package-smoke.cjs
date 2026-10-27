const assert = require('node:assert/strict')
const { selectBackendKey, validBackendKey } = require('../server-private-package.cjs')
const jwt = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature'
const legacy = jwt({ role: 'service_role', ref: 'cgjbsmqtfhqvttudyjzq' })
const fixture = [
  { name: 'anon', type: 'legacy', api_key: jwt({ role: 'anon', ref: 'cgjbsmqtfhqvttudyjzq' }) },
  { name: 'default', type: 'secret', api_key: 'sb_secret_...masked...' },
  { name: 'another-backend', type: 'secret', api_key: 'sb_secret_other' },
  { name: 'service_role', type: 'legacy', api_key: legacy }
]
assert.equal(selectBackendKey(fixture), legacy)
assert.equal(selectBackendKey([...fixture, { name: 'akaAgentServer', type: 'secret', api_key: 'sb_secret_dedicated' }]), 'sb_secret_dedicated')
for (const invalid of [fixture[0].api_key, fixture[1].api_key, jwt({ role: 'service_role', ref: 'wrong-project' }), '', undefined]) {
  assert.equal(validBackendKey(invalid), false)
  assert.throws(() => selectBackendKey([{ name: 'service_role', api_key: invalid }]))
}
assert.throws(() => selectBackendKey(fixture.slice(0, 3)))
assert.throws(() => selectBackendKey({}))
console.log('Private Server key selection smoke passed: 14 checks')
