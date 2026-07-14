import { createPublicKey, verify, type KeyObject } from 'crypto'

/**
 * Public verification key shipped with the server installer.
 *
 * This is the base64-encoded PEM public key for the current production signer.
 * The matching private key exists only in akaBizApi/Vercel and must never be
 * added to this repository or the installer.
 */
export const DEFAULT_REALTIME_TICKET_PUBLIC_KEY =
  'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQXVOaFBZVkRNZDNRdGRZUTgyb21VdTJ4SU5zcEhkUUU5Z2dkYWdJSko3a1k9Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo='

function decodePublicKey(value: string): string {
  const normalized = value.trim().replace(/\\n/g, '\n')
  if (normalized.includes('-----BEGIN PUBLIC KEY-----')) return normalized

  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim()
  if (!decoded.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error('Public key realtime phải là PEM hoặc base64 của PEM')
  }
  return decoded
}

export function loadRealtimeTicketPublicKey(
  overrideValue: string | null | undefined = process.env.AKA_AGENT_REALTIME_TICKET_PUBLIC_KEY
): KeyObject | null {
  const configuredValue = String(overrideValue || '').trim() || DEFAULT_REALTIME_TICKET_PUBLIC_KEY
  if (!configuredValue) return null

  const key = createPublicKey(decodePublicKey(configuredValue))
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Public key realtime phải dùng Ed25519')
  }
  return key
}

export function verifyRealtimeTicketSignature(
  payloadPart: string,
  signaturePart: string,
  publicKey: KeyObject
): boolean {
  const signature = Buffer.from(signaturePart, 'base64url')
  return signature.length === 64 && verify(
    null,
    Buffer.from(payloadPart, 'utf8'),
    publicKey,
    signature
  )
}
