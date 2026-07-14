import { strict as assert } from 'assert'
import {
  compileOriginPolicy,
  DEFAULT_REALTIME_ALLOWED_ORIGINS,
  isOriginAllowed,
  normalizeHttpOrigin
} from '../src/server/main/originPolicy'

const builtInPolicy = compileOriginPolicy(DEFAULT_REALTIME_ALLOWED_ORIGINS)
assert.equal(builtInPolicy.configured, true)
assert.equal(isOriginAllowed(builtInPolicy, 'https://aka-agent-web-app.vercel.app'), true)
assert.equal(isOriginAllowed(builtInPolicy, 'https://agent.akabiz.net'), true)
assert.equal(isOriginAllowed(builtInPolicy, 'https://akabiz.net'), false)
assert.equal(isOriginAllowed(builtInPolicy, 'https://unrelated.example'), false)

const policy = compileOriginPolicy([
  'https://akaagent-preview.vercel.app',
  'https://*.akabiz.net',
  'https://*.akabiz.net:8443'
])

assert.equal(policy.configured, true)
assert.equal(isOriginAllowed(policy, 'https://akaagent-preview.vercel.app'), true)
assert.equal(isOriginAllowed(policy, 'https://web.akabiz.net'), true)
assert.equal(isOriginAllowed(policy, 'https://nested.web.akabiz.net'), true)
assert.equal(isOriginAllowed(policy, 'https://web.akabiz.net:8443'), true)
assert.equal(isOriginAllowed(policy, 'https://akabiz.net'), false)
assert.equal(isOriginAllowed(policy, 'http://web.akabiz.net'), false)
assert.equal(isOriginAllowed(policy, 'https://web.akabiz.net:9443'), false)
assert.equal(isOriginAllowed(policy, 'https://evilakabiz.net'), false)
assert.equal(isOriginAllowed(policy, 'https://web.akabiz.net.evil.test'), false)

const apexPolicy = compileOriginPolicy('https://*.akabiz.net,https://akabiz.net')
assert.equal(isOriginAllowed(apexPolicy, 'https://akabiz.net'), true)

const defaultPortPolicy = compileOriginPolicy('https://*.akabiz.net:443')
assert.equal(isOriginAllowed(defaultPortPolicy, 'https://web.akabiz.net'), true)
assert.equal(isOriginAllowed(defaultPortPolicy, 'https://web.akabiz.net:443'), true)

const malformedPolicy = compileOriginPolicy([
  '*.akabiz.net',
  'https://*akabiz.net',
  'https://user:password@akabiz.net',
  'https://akabiz.net/path',
  'https://akabiz.net/%2e%2e',
  'https://akabiz.net?query=1',
  'file://akabiz.net',
  'null'
])
assert.equal(malformedPolicy.configured, false)
assert.equal(malformedPolicy.invalidEntries.length, 8)
assert.equal(isOriginAllowed(malformedPolicy, 'https://web.akabiz.net'), false)

const allowAnyPolicy = compileOriginPolicy('*')
assert.equal(isOriginAllowed(allowAnyPolicy, 'https://any.example'), true)
assert.equal(isOriginAllowed(allowAnyPolicy, 'http://localhost:5173'), true)
assert.equal(isOriginAllowed(allowAnyPolicy, 'null'), false)
assert.equal(isOriginAllowed(allowAnyPolicy, 'file://localhost'), false)
assert.equal(isOriginAllowed(allowAnyPolicy, 'not-an-origin'), false)

assert.equal(normalizeHttpOrigin('HTTPS://WEB.AKABIZ.NET:443/'), 'https://web.akabiz.net')

console.log('Zalo server origin policy smoke test PASSED')
