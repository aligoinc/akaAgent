import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceLockResetResult } from '../../shared/types'
import type { DeviceIdentity } from './deviceIdentity'

type Source = 'login' | 'account_menu'
type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>
interface Binding { staffId: string; hash: string | null; boundAt: string | null }
interface PendingChange {
  version: 1
  username: string
  source: Source
  requestId: string
  binding: Binding
}

function validBinding(value: unknown): value is Binding {
  if (!value || typeof value !== 'object') return false
  const binding = value as Binding
  return typeof binding.staffId === 'string' && /^\d+$/.test(binding.staffId)
    && (binding.hash === null || typeof binding.hash === 'string')
    && (binding.boundAt === null || (typeof binding.boundAt === 'string' && Number.isFinite(Date.parse(binding.boundAt))))
}

function parseResult(value: unknown): DeviceLockResetResult {
  const result = value as DeviceLockResetResult | null
  const codes: DeviceLockResetResult['code'][] = ['changed', 'already_unbound', 'quota_exhausted', 'device_online', 'binding_conflict', 'not_authorized', 'not_found', 'inactive']
  if (!result || !codes.includes(result.code)
    || result.success !== ['changed', 'already_unbound'].includes(result.code)
    || result.changed !== (result.code === 'changed')
    || !(Number.isInteger(result.remainingChanges) || (result.code === 'not_found' && result.remainingChanges === null))) {
    throw new Error('Đổi máy tính chưa được xác nhận. Vui lòng thử lại.')
  }
  return result
}

/** A pending journal contains only a CAS snapshot and request ID, never a password. */
export class DeviceChangeRequestClient {
  private readonly running = new Map<string, Promise<DeviceLockResetResult>>()

  constructor(private readonly options: {
    directory: string
    rpc: Rpc
    getDevice: () => Promise<DeviceIdentity & { appVersion: string }>
  }) {}

  reset(usernameInput: string, source: Source, password: string | null = null): Promise<DeviceLockResetResult> {
    const username = typeof usernameInput === 'string' ? usernameInput.trim() : ''
    if (!username) return Promise.reject(new Error('Vui lòng nhập tên đăng nhập để đổi máy tính.'))
    const key = createHash('sha256').update(JSON.stringify([source, username])).digest('hex')
    const running = this.running.get(key)
    if (running) return running
    const request = this.execute(key, username, source, password).finally(() => this.running.delete(key))
    this.running.set(key, request)
    return request
  }

  private async execute(key: string, username: string, source: Source, password: string | null): Promise<DeviceLockResetResult> {
    const file = join(this.options.directory, `${key}.json`)
    const device = await this.options.getDevice()
    let pending: PendingChange | null = null
    try {
      pending = JSON.parse(await readFile(file, 'utf8')) as PendingChange
      if (pending.version !== 1 || pending.username !== username || pending.source !== source
        || !/^[0-9a-f-]{36}$/i.test(pending.requestId) || !validBinding(pending.binding)) {
        throw new Error('Invalid pending device change')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Không đọc được yêu cầu đổi máy đang chờ. Vui lòng liên hệ hỗ trợ.')
      }
    }
    if (!pending) {
      const prepared = await this.options.rpc('aka_agent_prepare_device_change', { p_username: username }) as { code?: string; binding?: unknown } | null
      if (prepared?.code === 'not_found' || prepared?.code === 'inactive') {
        return { success: false, changed: false, code: prepared.code, remainingChanges: null }
      }
      if (prepared?.code !== 'prepared' || !validBinding(prepared.binding)) throw new Error('Không thể kiểm tra liên kết máy tính. Vui lòng thử lại.')
      pending = { version: 1, username, source, requestId: randomUUID(), binding: prepared.binding }
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
      const temporary = `${file}.${randomUUID()}.tmp`
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(pending), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      // Persist before sending any mutation. A restart can safely resend it.
      await rename(temporary, file)
    }
    const result = parseResult(await this.options.rpc('aka_agent_reset_device_binding', {
      p_username: username, p_password: password, p_source: source,
      p_request_id: pending.requestId, p_expected_binding: pending.binding, p_device: device
    }))
    // A cleanup error must not turn a committed reset into a reported failure.
    // Retaining the journal is safe: the server will replay or reject its CAS.
    await unlink(file).catch(() => {})
    return result
  }
}
