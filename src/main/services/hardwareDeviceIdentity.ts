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
    allowInstallationFallback?: boolean
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
        if (!uuid && !serial && this.options.allowInstallationFallback === false) throw new Error('Không có định danh v2 để đối chiếu.')
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

export interface PhysicalNetworkAdapter {
  key: string
  permanentAddress: unknown
  kind: 'ethernet' | 'wifi'
}
export interface CompositeHardware {
  uuid: unknown
  serials?: unknown
  machineGuid?: unknown
  adapters: PhysicalNetworkAdapter[]
}
type Component = 'uuid' | 'serials' | 'machineGuid' | 'mac'
interface CompositeSelection {
  version: 3
  platform: HardwarePlatform
  components: Component[]
  adapterKey: string | null
}
const COMPONENTS: Component[] = ['uuid', 'serials', 'machineGuid', 'mac']
const COMMON_UUIDS = new Set(['03000200040005000006000700080009'])
export function normalizePermanentMac(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const mac = value.toLowerCase().replace(/[:-]/g, '').trim()
  // Multicast, randomized/local addresses and empty placeholders are not hardware proof.
  return /^[a-f0-9]{12}$/.test(mac) && !/^0+$|^f+$/.test(mac) && (parseInt(mac.slice(0, 2), 16) & 3) === 0 ? mac : null
}

/** A successful hardware read confirmed that a previously selected source is absent. */
export class SelectedHardwareMissingError extends Error {
  constructor(readonly resetAuditFingerprintHash: string | null) {
    super('Không đọc được phần cứng đã đăng ký. Vui lòng thử lại hoặc chọn Đổi máy tính nếu đã thay phần cứng.')
    this.name = 'SelectedHardwareMissingError'
  }
}

/** Pins sources, never their values. A transient read failure cannot select a weaker formula. */
export class CompositeHardwareDeviceIdentity {
  private selection: CompositeSelection | null = null
  private loaded = false
  constructor(private readonly options: {
    platform: HardwarePlatform; file: string
    readHardware: () => Promise<CompositeHardware>
    write?: (file: string, value: string) => Promise<void>
  }) {}
  async fingerprint(): Promise<string> {
    if (!this.loaded) {
      try {
        const value = JSON.parse(await readFile(this.options.file, 'utf8')) as CompositeSelection
        if (value.version !== 3 || value.platform !== this.options.platform || !Array.isArray(value.components)
          || !value.components.length || new Set(value.components).size !== value.components.length
          || value.components.some(k => !COMPONENTS.includes(k))
          || (value.components.includes('mac') ? typeof value.adapterKey !== 'string' || !value.adapterKey : value.adapterKey !== null)) throw new Error('invalid selection')
        this.selection = value
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Không đọc được định danh máy đã lưu. Vui lòng liên hệ hỗ trợ.')
      }
      this.loaded = true
    }
    const hardware = await this.options.readHardware()
    const uuid = normalizeHardwareUuid(hardware.uuid)
    const values: Record<Component, string | null> = {
      uuid: uuid && !COMMON_UUIDS.has(uuid) ? uuid : null,
      serials: normalizeBoardSerials(hardware.serials),
      machineGuid: this.options.platform === 'win' ? normalizeHardwareUuid(hardware.machineGuid) : null,
      mac: null
    }
    const adapters = hardware.adapters.map(a => ({ ...a, mac: normalizePermanentMac(a.permanentAddress) }))
      .filter(a => a.key && a.mac).sort((a, b) => (a.kind === b.kind ? a.key.localeCompare(b.key, 'en') : a.kind === 'ethernet' ? -1 : 1))
    const adapter = this.selection ? adapters.find(a => a.key === this.selection!.adapterKey) : adapters[0]
    values.mac = adapter?.mac ?? null
    if (!this.selection) {
      const components = COMPONENTS.filter(k => values[k] !== null)
      if (!components.length) throw new Error('Không đọc được định danh phần cứng của máy. Vui lòng thử lại.')
      const selection: CompositeSelection = { version: 3, platform: this.options.platform, components, adapterKey: adapter?.key ?? null }
      // Source selection is required, unlike v2: losing it could change the formula on restart.
      try { await (this.options.write ?? writeAtomicLocalFile)(this.options.file, JSON.stringify(selection)) }
      catch { this.loaded = false; throw new Error('Không lưu được định danh máy. Vui lòng kiểm tra quyền ghi dữ liệu ứng dụng.') }
      this.selection = selection
    }
    if (this.selection.components.some(k => values[k] === null)) {
      // Reset audit can describe the remaining hardware without changing the
      // pinned login identity. Never derive even audit metadata from empty input.
      const auditValues = { ...values, mac: adapters[0]?.mac ?? null }
      const available = COMPONENTS.filter(k => auditValues[k] !== null)
      const resetAuditFingerprintHash = available.length ? createHash('sha256').update(JSON.stringify([
        'akaAgent-device-reset-audit-v1', this.options.platform,
        ...available.map(k => [k, auditValues[k]])
      ])).digest('hex') : null
      throw new SelectedHardwareMissingError(resetAuditFingerprintHash)
    }
    return createHash('sha256').update(JSON.stringify([
      'akaAgent-device-v3', this.options.platform,
      ...COMPONENTS.filter(k => this.selection!.components.includes(k)).map(k => [k, values[k]])
    ])).digest('hex')
  }
}
