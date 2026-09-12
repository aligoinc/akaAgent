import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { hostname } from 'os'
import { promisify } from 'util'
import { app } from 'electron'
import { join } from 'node:path'
import { HardwareDeviceIdentity } from './hardwareDeviceIdentity'

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
export function getCurrentDeviceIdentity(): Promise<DeviceIdentity> {
  if (!currentIdentity) currentIdentity = (async () => {
    const platform = getDevicePlatform()
    hardwareIdentity ??= new HardwareDeviceIdentity({
      platform, file: join(app.getPath('userData'), 'device-identity-v2.json'),
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
