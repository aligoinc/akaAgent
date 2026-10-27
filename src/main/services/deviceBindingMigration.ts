import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceBindingSnapshot, DeviceLoginSource } from '../../shared/deviceIdentity'
import { writeAtomicLocalFile } from './atomicLocalFile'

export interface DeviceBindingRequest {
  staffId: number
  fingerprintHash: string
  legacyHash: string | null
  source: DeviceLoginSource
  requestId: string
  expected: DeviceBindingSnapshot
}
interface Journal { version: 1; organizationId: number; request: DeviceBindingRequest }
const isHash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)

/** Password-free journal, persisted before a binding mutation; replay the same CAS after an unknown result. */
export class DeviceBindingMigration {
  constructor(private readonly directory: string) {}
  async request(input: Omit<DeviceBindingRequest, 'requestId'>, organizationId: number, needsBinding: boolean): Promise<DeviceBindingRequest> {
    const file = join(this.directory, `${input.staffId}.json`)
    try {
      const stored = JSON.parse(await readFile(file, 'utf8')) as Journal
      const r = stored.request
      if (stored.version !== 1 || !r || r.staffId !== input.staffId || !Number.isSafeInteger(stored.organizationId)
        || !isHash(r.fingerprintHash) || !(r.legacyHash === null || isHash(r.legacyHash))
        || !['manual', 'automatic', 'remembered', 'recovery'].includes(r.source)
        || !/^[a-f0-9-]{36}$/.test(r.requestId) || !r.expected || ![2, 3].includes(r.expected.version)
        || !/^[0-9]+$/.test(r.expected.revision) || !(r.expected.hash === null || isHash(r.expected.hash))) throw new Error('Invalid migration journal')
      if (stored.organizationId === organizationId && r.fingerprintHash === input.fingerprintHash
        && r.legacyHash === input.legacyHash && r.source === input.source) return r
      // A different explicit attempt gets its own CAS. Never replay an old account/device request.
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Không đọc được yêu cầu xác thực máy đang chờ. Vui lòng liên hệ hỗ trợ.')
    }
    const request = { ...input, requestId: randomUUID() }
    if (needsBinding) {
      try { await writeAtomicLocalFile(file, JSON.stringify({ version: 1, organizationId, request } satisfies Journal)) }
      catch { throw new Error('Không lưu được yêu cầu xác thực máy. Vui lòng kiểm tra quyền ghi dữ liệu ứng dụng.') }
    }
    return request
  }
  async confirmed(staffId: number): Promise<void> {
    await unlink(join(this.directory, `${staffId}.json`)).catch(() => {})
  }
}
