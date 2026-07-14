import { strict as assert } from 'assert'
import { generateKeyPairSync, sign } from 'crypto'
import {
  loadRealtimeTicketPublicKey,
  verifyRealtimeTicketSignature
} from '../src/server/main/realtimeTicketVerifier'

const keyPair = generateKeyPairSync('ed25519')
const publicPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const publicPemBase64 = Buffer.from(publicPem).toString('base64')
const payloadPart = Buffer.from(JSON.stringify({ v: 1, staffId: 1 })).toString('base64url')
const signaturePart = sign(
  null,
  Buffer.from(payloadPart, 'utf8'),
  keyPair.privateKey
).toString('base64url')

const pemKey = loadRealtimeTicketPublicKey(publicPem)
const base64Key = loadRealtimeTicketPublicKey(publicPemBase64)
const builtInKey = loadRealtimeTicketPublicKey(null)
assert(pemKey)
assert(base64Key)
assert(builtInKey)
assert.equal(builtInKey.asymmetricKeyType, 'ed25519')
assert.equal(verifyRealtimeTicketSignature(payloadPart, signaturePart, pemKey), true)
assert.equal(verifyRealtimeTicketSignature(payloadPart, signaturePart, base64Key), true)
assert.equal(verifyRealtimeTicketSignature(`${payloadPart}x`, signaturePart, base64Key), false)
assert.equal(verifyRealtimeTicketSignature(payloadPart, 'invalid', base64Key), false)

const wrongKey = generateKeyPairSync('ed25519').publicKey
assert.equal(verifyRealtimeTicketSignature(payloadPart, signaturePart, wrongKey), false)

const rsaPublicPem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
assert.throws(
  () => loadRealtimeTicketPublicKey(rsaPublicPem),
  /Ed25519/
)

console.log('Zalo server Ed25519 ticket verifier smoke test PASSED')
