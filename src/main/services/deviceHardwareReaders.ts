import { parseDocument } from 'htmlparser2'
import type { CompositeHardware, PhysicalNetworkAdapter } from './hardwareDeviceIdentity'
import { normalizePermanentMac } from './hardwareDeviceIdentity'

/** No active/connected filter: a disabled built-in card must keep its identity. */
export const WINDOWS_COMPOSITE_SCRIPT = String.raw`$ErrorActionPreference='Stop';
$system=Get-CimInstance -ClassName Win32_ComputerSystemProduct;
$boards=Get-CimInstance -ClassName Win32_BaseBoard;
$guid=(Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid;
$cards=@(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetAdapter | Where-Object {
 $_.HardwareInterface -eq $true -and $_.Virtual -ne $true -and $_.PnPDeviceID -match '^(PCI|ACPI)\\' -and $_.InterfaceType -in @(6,71)
} | ForEach-Object { @{key=$_.PnPDeviceID.ToLowerInvariant(); permanentAddress=$_.PermanentAddress; kind=$(if ($_.InterfaceType -eq 71) {'wifi'} else {'ethernet'})} });
@{uuid=$system.UUID; serials=@($boards | ForEach-Object {$_.SerialNumber}); machineGuid=$guid; adapters=$cards} | ConvertTo-Json -Compress -Depth 4`

export function parseWindowsComposite(stdout: string): CompositeHardware {
  const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
  if (!value || !Array.isArray(value.adapters) || !Array.isArray(value.serials)
    || !Object.hasOwn(value, 'uuid') || !Object.hasOwn(value, 'machineGuid')) throw new Error('Invalid Windows hardware response')
  for (const adapter of value.adapters) {
    if (!adapter || typeof adapter.key !== 'string' || !['ethernet', 'wifi'].includes(adapter.kind)) throw new Error('Invalid adapter response')
  }
  return value
}

type XmlNode = ReturnType<typeof parseDocument>['children'][number]
function readPlist(node: XmlNode): unknown {
  if (node.type !== 'tag') throw new Error('Invalid plist node')
  const children = node.children.filter((c): c is typeof node => c.type === 'tag')
  const text = node.children.map(c => c.type === 'text' ? c.data : '').join('')
  if (node.name === 'array') return children.map(readPlist)
  if (node.name === 'dict') {
    if (children.length % 2) throw new Error('Invalid plist dictionary')
    const result: Record<string, unknown> = Object.create(null)
    for (let i = 0; i < children.length; i += 2) {
      if (children[i].name !== 'key') throw new Error('Invalid plist key')
      result[String(readPlist(children[i]))] = readPlist(children[i + 1])
    }
    return result
  }
  if (node.name === 'data') return Buffer.from(text.replace(/\s/g, ''), 'base64')
  if (node.name === 'integer' || node.name === 'real') return Number(text)
  if (node.name === 'true') return true
  if (node.name === 'false') return false
  if (['key', 'string'].includes(node.name)) return text
  throw new Error('Unsupported plist node')
}
export function parseMacComposite(stdout: string): CompositeHardware {
  const document = parseDocument(stdout, { xmlMode: true })
  const plist = document.children.find(n => n.type === 'tag' && n.name === 'plist')
  if (!plist || plist.type !== 'tag') throw new Error('Invalid IORegistry plist')
  const root = plist.children.find(n => n.type === 'tag')
  if (!root) throw new Error('Empty IORegistry plist')
  let uuid: unknown = null, serials: unknown = null
  const adapters: PhysicalNetworkAdapter[] = []
  type Entry = Record<string, unknown>
  const visit = (value: unknown, ancestors: Entry[]): void => {
    if (Array.isArray(value)) { value.forEach(v => visit(v, ancestors)); return }
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return
    const entry = value as Entry
    if ('IOPlatformUUID' in entry) { uuid = entry.IOPlatformUUID; serials = entry.IOPlatformSerialNumber }
    if (entry.IOBuiltin === true) {
      const path = [...ancestors, entry]
      const classes = path.map(p => String(p.IOObjectClass ?? '')).join('/')
      // Thunderbolt bridge/USB/virtual interfaces can also report IOBuiltin.
      if (!/Thunderbolt|USB|Virtual|Bridge/i.test(classes)) {
        const controller = [...ancestors].reverse().find(p => Buffer.isBuffer(p.IOMACAddress) && (p.IOMACAddress as Buffer).length === 6)
        const mac = controller && normalizePermanentMac((controller.IOMACAddress as Buffer).toString('hex'))
        if (mac) adapters.push({ key: `builtin:${mac}`, permanentAddress: mac, kind: /WLAN|80211|WiFi/i.test(classes) ? 'wifi' : 'ethernet' })
      }
    }
    if (Array.isArray(entry.IORegistryEntryChildren)) visit(entry.IORegistryEntryChildren, [...ancestors, entry])
  }
  visit(readPlist(root), [])
  return { uuid, serials, adapters }
}
