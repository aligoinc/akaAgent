import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessAuthCredentials } from '../data/currentUser'
import { getSupabaseClient } from '../data/supabaseClient'
import { callStaffClient } from '../data/repositories/staffClientRepository'

const secretFile = (): string => join(app.getPath('userData'), 'staff-device-recovery-v1.key')
async function readSecret(allowRepair = false): Promise<string | null> {
  try {
    const secret = (await readFile(secretFile(), 'utf8')).trim()
    if (!/^[a-f0-9]{64}$/.test(secret)) {
      if (allowRepair) return null
      throw new Error('invalid recovery key')
    }
    return secret
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Không đọc được khóa khôi phục trên máy. Vui lòng đăng nhập bằng mật khẩu.')
  }
}

// Desktop already holds Electron's single-instance lock. Serialize enrollment
// within Main too, so concurrent logins cannot publish different machine proofs.
let enrollment: Promise<void> = Promise.resolve()
export function registerStaffDeviceRecovery(credentials: ProcessAuthCredentials, staffId: number, fingerprintHash: string): Promise<void> {
  const task = enrollment.then(async () => {
    const register = async (secret: string): Promise<void> => {
      await callStaffClient(credentials, 'register_recovery', {
        staffId, fingerprintHash, secretHash: createHash('sha256').update(secret).digest('hex')
      })
    }
    // Only malformed/missing files are repairable. Permission/I/O errors must
    // not rotate a potentially valid proof, and recovery reads never repair.
    const current = await readSecret(true)
    if (current) return register(current)

    const secret = randomBytes(32).toString('hex')
    const target = secretFile()
    const temporary = `${target}.${randomBytes(16).toString('hex')}.tmp`
    let staged = false
    try {
      await mkdir(app.getPath('userData'), { recursive: true })
      const handle = await open(temporary, 'wx', 0o600)
      staged = true
      try { await handle.writeFile(secret); await handle.sync() } finally { await handle.close() }
      // The RPC validates credentials and binding before replacing the local
      // file. A rejected/unknown response leaves the old file untouched.
      await register(secret)
      await rename(temporary, target)
    } catch {
      throw new Error('Không lưu được khóa khôi phục trên máy. Vui lòng đăng nhập lại bằng mật khẩu.')
    } finally {
      if (staged) await unlink(temporary).catch(() => {})
    }
  })
  enrollment = task.catch(() => {})
  return task
}

/** Read only the locally held proof. A fingerprint on its own never recovers credentials. */
export async function recoverStaffDeviceCredentials(fingerprintHash: string): Promise<ProcessAuthCredentials | null> {
  const secret = await readSecret()
  if (!secret) return null
  const { data, error } = await getSupabaseClient().rpc('aka_agent_recover_staff_credentials', {
    p_secret: secret, p_fingerprint_hash: fingerprintHash
  }).abortSignal(AbortSignal.timeout(10_000))
  if (error || !data?.username || !data?.password) throw new Error('Không thể lấy lại thông tin trên máy này. Vui lòng nhập mật khẩu hoặc liên hệ hỗ trợ.')
  return { username: String(data.username), password: String(data.password) }
}

/** Only an explicit server response permits the one-time pre-RLS transition. */
export async function legacyStaffRecoveryAllowed(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('aka_agent_staff_security_status')
    .abortSignal(AbortSignal.timeout(5000))
  if (error || typeof data?.legacyRecoveryAllowed !== 'boolean') throw new Error('Không thể kiểm tra chế độ đăng nhập. Vui lòng thử lại.')
  return data.legacyRecoveryAllowed === true
}
