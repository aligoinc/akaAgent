import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'

/** Android password envelope: RSA-wrapped AES-256-GCM, timestamp as AAD.
 * Wire format reference: mautrix/facebook maufbapi/http/login.py. This module
 * implements the binary protocol with Node crypto; no remote code is executed.
 */
export function encryptFacebookPassword(password: string, keyId: unknown, publicKey: unknown): string {
  const failure = (): Error => new Error('Khóa mã hóa đăng nhập Facebook không hợp lệ. Hãy thử lại sau.')
  if ((typeof keyId !== 'number' && !(typeof keyId === 'string' && /^\d{1,3}$/.test(keyId)))
    || !Number.isInteger(Number(keyId)) || Number(keyId) < 0 || Number(keyId) > 255
    || typeof publicKey !== 'string' || publicKey.length > 16384) throw failure()
  const aesKey = randomBytes(32)
  try {
    const key = createPublicKey(publicKey)
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0
    if (key.asymmetricKeyType !== 'rsa' || bits < 2048 || bits > 4096) throw failure()
    const timestamp = String(Math.floor(Date.now() / 1000)), iv = randomBytes(12)
    const wrappedKey = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, aesKey)
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
    cipher.setAAD(Buffer.from(timestamp, 'ascii'))
    const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
    const header = Buffer.alloc(16)
    header[0] = 1; header[1] = Number(keyId); iv.copy(header, 2)
    header.writeUInt16LE(wrappedKey.length, 14)
    return `#PWD_MSGR:1:${timestamp}:${Buffer.concat([header, wrappedKey, cipher.getAuthTag(), encrypted]).toString('base64')}`
  } catch { throw failure() }
  finally { aesKey.fill(0) }
}
