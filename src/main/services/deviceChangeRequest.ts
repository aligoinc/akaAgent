import { createHash, randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceLockResetResult } from '../../shared/types'
import type { DeviceIdentity } from './deviceIdentity'
import { writeAtomicLocalFile } from './atomicLocalFile'

type Source = 'login' | 'account_menu'
type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>
interface Binding { staffId: string; hash: string | null; boundAt?: string | null; revision?: string; version?: 2 }
type ResetDevice = DeviceIdentity & { appVersion: string }
interface LegacyPendingChange {
  version: 1
  username: string
  source: Source
  requestId: string
  binding: Binding
}
interface PendingChange extends Omit<LegacyPendingChange, 'version'> {
  version: 2
  device: ResetDevice
}

function validDevice(value: unknown): value is ResetDevice {
  if (!value || typeof value !== 'object') return false
  const device = value as ResetDevice
  return typeof device.fingerprintHash === 'string' && /^[a-f0-9]{64}$/.test(device.fingerprintHash)
    && (device.platform === 'win' || device.platform === 'mac')
    && typeof device.label === 'string' && typeof device.appVersion === 'string'
}
function devicePayload(device: ResetDevice): ResetDevice {
  if (!validDevice(device)) throw new Error('Không xác minh được thông tin máy tính cho yêu cầu đổi máy.')
  // Match the server's metadata allowlist; never persist arbitrary caller data.
  return { fingerprintHash: device.fingerprintHash, platform: device.platform,
    label: device.label.slice(0, 255), appVersion: device.appVersion.slice(0, 50) }
}

function validBinding(value: unknown): value is Binding {
  if (!value || typeof value !== 'object') return false
  const binding = value as Binding
  return typeof binding.staffId === 'string' && /^\d+$/.test(binding.staffId)
    && (binding.hash === null || typeof binding.hash === 'string')
    && (binding.version === 2 ? typeof binding.revision === 'string' && /^\d+$/.test(binding.revision)
      : binding.boundAt === null || (typeof binding.boundAt === 'string' && Number.isFinite(Date.parse(binding.boundAt))))
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

/** A pending journal contains CAS, request ID and reset device metadata, never a password. */
export class DeviceChangeRequestClient {
  private readonly running = new Map<string, Promise<DeviceLockResetResult>>()

  constructor(private readonly options: {
    directory: string
    rpc: Rpc
    getDevice: () => Promise<ResetDevice>
    getLegacyJournalDevice?: () => Promise<ResetDevice>
    bindingVersion?: 2
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
    let pending: PendingChange | LegacyPendingChange | null = null
    try {
      pending = JSON.parse(await readFile(file, 'utf8')) as PendingChange | LegacyPendingChange
      if (!pending || ![1, 2].includes(pending.version) || pending.username !== username || pending.source !== source
        || pending.binding?.version !== this.options.bindingVersion
        || !/^[0-9a-f-]{36}$/i.test(pending.requestId) || !validBinding(pending.binding)
        || (pending.version === 2 && !validDevice(pending.device))) {
        throw new Error('Invalid pending device change')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Không đọc được yêu cầu đổi máy đang chờ. Vui lòng liên hệ hỗ trợ.')
      }
    }
    if (!pending) {
      const device = devicePayload(await this.options.getDevice())
      const prepared = await this.options.rpc(this.options.bindingVersion === 2 ? 'aka_agent_prepare_device_change_v2' : 'aka_agent_prepare_device_change', { p_username: username }) as { code?: string; binding?: unknown } | null
      if (prepared?.code === 'not_found' || prepared?.code === 'inactive') {
        return { success: false, changed: false, code: prepared.code, remainingChanges: null }
      }
      if (prepared?.code !== 'prepared' || !validBinding(prepared.binding) || prepared.binding.version !== this.options.bindingVersion) throw new Error('Không thể kiểm tra liên kết máy tính. Vui lòng thử lại.')
      pending = { version: 2, username, source, requestId: randomUUID(), binding: prepared.binding, device }
      // Persist before sending any mutation. A restart can safely resend it.
      await writeAtomicLocalFile(file, JSON.stringify(pending))
    } else if (pending.version === 1) {
      // Preserve the old ID/CAS. Only this compatibility path reconstructs the
      // old v2 audit hash; every subsequent retry reads the persisted payload.
      const device = devicePayload(await (this.options.getLegacyJournalDevice ?? this.options.getDevice)())
      pending = { version: 2, username, source, requestId: pending.requestId, binding: pending.binding, device }
      await writeAtomicLocalFile(file, JSON.stringify(pending))
    }
    const result = parseResult(await this.options.rpc(this.options.bindingVersion === 2 ? 'aka_agent_reset_device_binding_v2' : 'aka_agent_reset_device_binding', {
      p_username: username, p_password: password, p_source: source,
      p_request_id: pending.requestId, p_expected_binding: pending.binding, p_device: devicePayload(pending.device)
    }))
    // A cleanup error must not turn a committed reset into a reported failure.
    // Retaining the journal is safe: the server will replay or reject its CAS.
    await unlink(file).catch(() => {})
    return result
  }
}
