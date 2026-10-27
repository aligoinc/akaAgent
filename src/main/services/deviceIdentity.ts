import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { hostname } from 'os'
import { promisify } from 'util'
import { app } from 'electron'
import { join } from 'node:path'
import { CompositeHardwareDeviceIdentity, HardwareDeviceIdentity, SelectedHardwareMissingError } from './hardwareDeviceIdentity'
import { parseMacComposite, parseWindowsComposite, WINDOWS_COMPOSITE_SCRIPT } from './deviceHardwareReaders'
import { unlink } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

type DevicePlatform = 'mac' | 'win'

export interface DeviceIdentity {
  fingerprintHash: string
  label: string
  platform: DevicePlatform
}

async function execWithFallback(commands: Array<{ file: string; args: string[] }>): Promise<string> {
  let lastError: unknown = null
  const deadline = Date.now() + 10_000
  for (const command of commands) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    try {
      const { stdout } = await execFileAsync(command.file, command.args, { windowsHide: true, timeout: remaining })
      return stdout
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Không lấy được mã máy tính.')
}

async function readMacMachineId(): Promise<string> {
  const stdout = await execWithFallback([
    { file: '/usr/sbin/ioreg', args: ['-rd1', '-c', 'IOPlatformExpertDevice'] },
    { file: 'ioreg', args: ['-rd1', '-c', 'IOPlatformExpertDevice'] }
  ])
  const match = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
  return (match?.[1] || '').trim()
}

async function readWindowsMachineId(): Promise<string> {
  const stdout = await execWithFallback([
    { file: 'reg', args: ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'] }
  ])
  const match = stdout.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i)
  return (match?.[1] || '').trim()
}

function getDevicePlatform(): DevicePlatform {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'win32') return 'win'
  throw new Error('Tính năng khóa máy tính chỉ hỗ trợ macOS và Windows.')
}

function buildLabel(platform: DevicePlatform): string {
  const platformLabel = platform === 'mac' ? 'macOS' : 'Windows'
  const host = hostname().trim()
  return host ? `${platformLabel} - ${host}` : platformLabel
}

async function readCurrentDeviceIdentity(): Promise<DeviceIdentity> {
  const platform = getDevicePlatform()
  const rawId = platform === 'mac'
    ? await readMacMachineId()
    : await readWindowsMachineId()

  if (!rawId) {
    throw new Error('Không lấy được mã máy tính để xác thực đăng nhập.')
  }

  const fingerprintHash = createHash('sha256')
    .update(`${platform}:${rawId.toLowerCase()}`)
    .digest('hex')

  return {
    fingerprintHash,
    label: buildLabel(platform),
    platform
  }
}

let cachedIdentity: Promise<DeviceIdentity> | null = null

export function getLegacyDeviceIdentity(): Promise<DeviceIdentity> {
  if (!cachedIdentity) {
    cachedIdentity = readCurrentDeviceIdentity().catch(error => {
      cachedIdentity = null
      throw error
    })
  }
  return cachedIdentity
}

let hardwareIdentity: HardwareDeviceIdentity | null = null
let currentIdentity: Promise<DeviceIdentity> | null = null
export function getV2DeviceIdentity(): Promise<DeviceIdentity> {
  if (!currentIdentity) currentIdentity = (async () => {
    const platform = getDevicePlatform()
    hardwareIdentity ??= new HardwareDeviceIdentity({
      platform, file: join(app.getPath('userData'), 'device-identity-v2.json'), allowInstallationFallback: false,
      readHardware: async () => {
        if (platform === 'mac') return { uuid: await readMacMachineId() }
        const script = "$ErrorActionPreference='Stop'; $system=Get-CimInstance -ClassName Win32_ComputerSystemProduct; $boards=Get-CimInstance -ClassName Win32_BaseBoard; @{uuid=$system.UUID; serials=@($boards | ForEach-Object { $_.SerialNumber })} | ConvertTo-Json -Compress"
        try {
          const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 })
          return JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
        } catch { throw new Error('Không đọc được định danh phần cứng Windows. Vui lòng thử lại.') }
      }
    })
    return { fingerprintHash: await hardwareIdentity.fingerprint(), platform, label: buildLabel(platform) }
  })().catch(error => { currentIdentity = null; throw error })
  return currentIdentity
}

let compositeIdentity: CompositeHardwareDeviceIdentity | null = null
let compositeFlight: Promise<DeviceIdentity> | null = null
let lastCompositeRead: DeviceIdentity | null = null
export function getCurrentDeviceIdentity(refresh = false): Promise<DeviceIdentity> {
  // Presence reuses its session identity; authentication explicitly refreshes hardware.
  if (!refresh && lastCompositeRead) return Promise.resolve(lastCompositeRead)
  if (!compositeFlight) compositeFlight = (async () => {
    const platform = getDevicePlatform()
    compositeIdentity ??= new CompositeHardwareDeviceIdentity({
      platform, file: join(app.getPath('userData'), 'device-identity-v3.json'),
      readHardware: async () => {
        try {
          const { stdout } = platform === 'win'
            ? await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_COMPOSITE_SCRIPT], { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 })
            : await execFileAsync('/usr/sbin/ioreg', ['-a', '-l', '-p', 'IOService'], { timeout: 10_000, maxBuffer: 32 * 1024 * 1024 })
          return platform === 'win' ? parseWindowsComposite(stdout) : parseMacComposite(stdout)
        } catch { throw new Error('Không đọc được định danh phần cứng. Vui lòng thử lại.') }
      }
    })
    const result = { fingerprintHash: await compositeIdentity.fingerprint(), platform, label: buildLabel(platform) }
    lastCompositeRead = result
    return result
  })().finally(() => { compositeFlight = null })
  return compositeFlight
}

/** Reset is explicitly requested by the user. Its audit payload is not an authentication credential. */
export async function getDeviceForBindingReset(): Promise<DeviceIdentity> {
  try { return await getCurrentDeviceIdentity(true) }
  catch (error) {
    if (!(error instanceof SelectedHardwareMissingError) || !error.resetAuditFingerprintHash) throw error
    // A fresh v3 install may have no usable v2 identity at all. This hash comes
    // from the successful hardware read above, for reset audit only. It is never
    // cached as a login/presence identity or written to the source selection.
    const platform = getDevicePlatform()
    return { fingerprintHash: error.resetAuditFingerprintHash, platform, label: buildLabel(platform) }
  }
}
export async function resetCompositeSelection(): Promise<void> {
  // This file belongs to the machine, not the account being reset. Keep a valid
  // selection even when a newly available source would now rank ahead of it.
  // Re-read after the server confirms the reset: a transient failure must never
  // erase the selection, and hardware that returned meanwhile needs no repair.
  try { await getCurrentDeviceIdentity(true); return }
  catch (error) { if (!(error instanceof SelectedHardwareMissingError)) throw error }
  await unlink(join(app.getPath('userData'), 'device-identity-v3.json')).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Không cập nhật được định danh máy. Vui lòng kiểm tra quyền ghi dữ liệu ứng dụng.')
  })
  compositeIdentity = null
  lastCompositeRead = null
}
