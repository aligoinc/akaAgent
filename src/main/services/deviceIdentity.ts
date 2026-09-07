import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { hostname } from 'os'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

type DevicePlatform = 'mac' | 'win'

export interface DeviceIdentity {
  fingerprintHash: string
  label: string
  platform: DevicePlatform
}

async function execWithFallback(commands: Array<{ file: string; args: string[] }>): Promise<string> {
  let lastError: unknown = null
  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync(command.file, command.args, { windowsHide: true })
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

export function getCurrentDeviceIdentity(): Promise<DeviceIdentity> {
  if (!cachedIdentity) {
    cachedIdentity = readCurrentDeviceIdentity().catch(error => {
      cachedIdentity = null
      throw error
    })
  }
  return cachedIdentity
}
