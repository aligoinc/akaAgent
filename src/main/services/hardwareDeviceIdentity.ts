import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeAtomicLocalFile } from './atomicLocalFile'

export type HardwarePlatform = 'win' | 'mac'
type Source = 'system-uuid' | 'baseboard' | 'platform-uuid' | 'installation'
interface Selection { version: 2; source: Source; installationId?: string }
export function normalizeHardwareUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim().toLowerCase().replace(/[{}-]/g, '')
  return /^[a-f0-9]{32}$/.test(id) && !/^0+$|^f+$/.test(id) ? id : null
}
export function normalizeBoardSerials(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value]
  const serials = values.filter((v): v is string => typeof v === 'string').map(v => v.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(v => v.length >= 4 && !/^(0+|f+|unknown|none|default string|not specified|not applicable|system serial number|to be filled by o\.?e\.?m\.?)$/i.test(v))
  return serials.length ? [...new Set(serials)].sort().join('|') : null
}
export class HardwareDeviceIdentity {
  private selection: Selection | null = null
  private loaded = false
  constructor(private readonly options: {
    platform: HardwarePlatform; file: string
    readHardware: () => Promise<{ uuid: unknown; serials?: unknown }>
    write?: (file: string, value: string) => Promise<void>
  }) {}
  async fingerprint(): Promise<string> {
    if (!this.loaded) {
      try {
        const value = JSON.parse(await readFile(this.options.file, 'utf8')) as Selection
        if (value.version !== 2 || !['system-uuid', 'baseboard', 'platform-uuid', 'installation'].includes(value.source)
          || (value.source === 'installation' && !normalizeHardwareUuid(value.installationId))) throw new Error('Invalid identity storage')
        this.selection = value
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Không đọc được định danh máy đã lưu. Vui lòng liên hệ hỗ trợ.')
      }
      this.loaded = true
    }
    let raw: string | null = null
    if (this.selection?.source === 'installation') raw = this.selection.installationId!
    else {
      // Exceptions/timeouts never mean hardware is absent and must not create a new identity.
      const hardware = await this.options.readHardware()
      const uuid = normalizeHardwareUuid(hardware.uuid)
      const serial = this.options.platform === 'win' ? normalizeBoardSerials(hardware.serials) : null
      if (!this.selection) {
        this.selection = uuid ? { version: 2, source: this.options.platform === 'win' ? 'system-uuid' : 'platform-uuid' }
          : serial ? { version: 2, source: 'baseboard' }
            : { version: 2, source: 'installation', installationId: randomUUID() }
        try { await (this.options.write ?? writeAtomicLocalFile)(this.options.file, JSON.stringify(this.selection)) }
        catch {
          if (this.selection.source === 'installation') { this.selection = null; throw new Error('Không lưu được mã máy dự phòng. Vui lòng kiểm tra quyền ghi dữ liệu ứng dụng.') }
          // A deterministic hardware identity remains usable despite optional metadata storage failure.
        }
      }
      raw = this.selection.source === 'installation' ? this.selection.installationId! : this.selection.source === 'baseboard' ? serial : uuid
    }
    if (!raw) throw new Error('Không đọc được nguồn định danh máy đã chọn. Vui lòng thử lại; app chưa thay đổi liên kết máy.')
    return createHash('sha256').update(JSON.stringify(['akaAgent-device-v2', this.options.platform, this.selection!.source, raw])).digest('hex')
  }
}
