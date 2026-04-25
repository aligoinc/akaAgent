import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IConnectionVault } from '@akabiz/engine'

/**
 * ConnectionVault — AES-256-GCM encrypt/decrypt connection secrets.
 *
 * Storage format trong connections.data_encrypted:
 *   [salt 16B][iv 12B][authTag 16B][ciphertext...]
 *
 * Key derivation: scrypt(masterKey, salt) — masterKey từ env CONN_VAULT_KEY.
 *
 * Phase 6: basic encrypt/decrypt. Phase later: key rotation, KMS integration.
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const TAG_LENGTH = 16
const SALT_LENGTH = 16

export class ConnectionVault implements IConnectionVault {
  private maskMap = new Map<string, Set<string>>()    // runId → set of secret values

  constructor(
    private supabase: SupabaseClient,
    private masterKey: string
  ) {
    if (!masterKey || masterKey.length < 16) {
      throw new Error('ConnectionVault: masterKey must be at least 16 chars')
    }
  }

  async resolve(connectionId: string): Promise<Record<string, string>> {
    const { data, error } = await this.supabase.from('connections')
      .select('data_encrypted').eq('id', connectionId).single()
    if (error) throw new Error(`resolve connection failed: ${error.message}`)
    const encrypted = data?.data_encrypted
    if (!encrypted) return {}

    const buf = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted as string, 'base64')
    const decoded = this.decrypt(buf)
    const parsed = JSON.parse(decoded) as Record<string, string>
    return parsed
  }

  async getMaskValuesForRun(runId: string): Promise<string[]> {
    const set = this.maskMap.get(runId)
    return set ? Array.from(set) : []
  }

  /**
   * Track secret values used trong run (cho LogMasker filter logs).
   */
  trackSecret(runId: string, value: string): void {
    if (!value) return
    let set = this.maskMap.get(runId)
    if (!set) {
      set = new Set()
      this.maskMap.set(runId, set)
    }
    set.add(value)
  }

  /**
   * Encrypt JSON object → bytea Buffer cho insert/update connections.
   */
  encryptToBuffer(payload: Record<string, string>): Buffer {
    const json = JSON.stringify(payload)
    return this.encrypt(json)
  }

  // ========== crypto ==========

  private encrypt(plaintext: string): Buffer {
    const salt = randomBytes(SALT_LENGTH)
    const iv = randomBytes(IV_LENGTH)
    const key = scryptSync(this.masterKey, salt, KEY_LENGTH)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    // Format: [salt][iv][authTag][ciphertext]
    return Buffer.concat([salt, iv, authTag, encrypted])
  }

  private decrypt(buf: Buffer): string {
    if (buf.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
      throw new Error('ConnectionVault: encrypted buffer too short')
    }
    const salt = buf.subarray(0, SALT_LENGTH)
    const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const authTag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
    const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
    const key = scryptSync(this.masterKey, salt, KEY_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  }
}
