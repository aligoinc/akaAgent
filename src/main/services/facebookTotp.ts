import { createHmac } from 'node:crypto'
import { normalizeTwoFactorSecret } from '../../shared/facebookLogin'

/** RFC 6238 / SHA-1. The seed never leaves this process to obtain an OTP. */
export function facebookTotp(seed: string, now = Date.now(), digits = 6): string {
  const normalized = normalizeTwoFactorSecret(seed)
  if (!normalized) throw new Error('Thiếu khóa 2FA.')
  let bits = 0, value = 0
  const bytes: number[] = []
  for (const letter of normalized) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(letter)
    bits += 5
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255) }
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = hash[hash.length - 1] & 15
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0')
}
