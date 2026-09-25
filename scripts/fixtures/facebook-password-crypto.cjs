// Fixture key only. No real account credentials or Facebook public keys.
const assert = require('node:assert/strict')
const {generateKeyPairSync, privateDecrypt, constants, createDecipheriv} = require('node:crypto')
function createPasswordKeyFixture(keyId=42) {
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength:2048})
const keyResponse = {key_id:keyId, public_key:publicKey.export({type:'spki',format:'pem'})}
function decryptPassword(envelope) {
  const parts = envelope.split(':')
  assert.deepEqual(parts.slice(0,2), ['#PWD_MSGR','1'])
  assert.equal(parts.length,4);assert.match(parts[2],/^\d+$/)
  const bytes=Buffer.from(parts[3],'base64')
  assert.equal(bytes[0],1);assert.equal(bytes[1],keyId)
  const size=bytes.readUInt16LE(14);assert.equal(size,256)
  // Test-only PKCS#1 decoding (Node disables PKCS1 privateDecrypt on some hosts).
  const padded=privateDecrypt({key:privateKey,padding:constants.RSA_NO_PADDING},bytes.subarray(16,16+size))
  assert.equal(padded[0],0);assert.equal(padded[1],2)
  const separator=padded.indexOf(0,2);assert(separator>=10)
  const key=padded.subarray(separator+1);assert.equal(key.length,32)
  const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(2,14))
  decipher.setAAD(Buffer.from(parts[2],'ascii'))
  decipher.setAuthTag(bytes.subarray(16+size,32+size))
  return Buffer.concat([decipher.update(bytes.subarray(32+size)),decipher.final()]).toString('utf8')
}
return {keyResponse,decryptPassword}
}
module.exports={...createPasswordKeyFixture(),createPasswordKeyFixture}
