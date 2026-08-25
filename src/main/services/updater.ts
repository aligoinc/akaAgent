import { app, BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import {
  closeSync,
  createWriteStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync
} from 'fs'
import { basename, extname, join } from 'path'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'
import { IPC_EVENTS } from '../../shared/types'

interface PlatformUpdateConfig {
  versionUrl: string
  installerUrl: string
  installerFilename: string
}

const UPDATE_CONFIGS: Record<string, PlatformUpdateConfig> = {
  win32: {
    versionUrl: 'https://akabiz.net/UpdateAutoSqlite/akaAgent/version_win.txt',
    installerUrl: 'https://akabiz.net/UpdateAutoSqlite/akaAgent/akaAgent.exe',
    // Keep Setup's process name distinct from the installed akaAgent.exe so
    // NSIS can reliably detect and close a running application.
    installerFilename: 'akaAgent-Setup.exe'
  }
}

const MAC_APPLE_SILICON_UPDATE_CONFIG: PlatformUpdateConfig = {
  versionUrl: 'https://akabiz.net/UpdateAutoSqlite/akaAgent/version_mac.txt',
  installerUrl: 'https://akabiz.net/UpdateAutoSqlite/akaAgent/akaAgent.dmg',
  installerFilename: 'akaAgent.dmg'
}

const MAC_INTEL_UPDATE_CONFIG: PlatformUpdateConfig = {
  versionUrl: 'https://akabiz.net/UpdateAutoSqlite/akaAgent/version_mac_intel.txt',
  installerUrl: 'https://akabiz.net/UpdateAutoSqlite/akaAgent/akaAgentIntel.dmg',
  installerFilename: 'akaAgentIntel.dmg'
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  localVersion: string
  remoteVersion: string
  error?: string
}

export interface UpdateProgress {
  phase: 'downloading' | 'installing' | 'done' | 'error'
  percent?: number
  transferred?: number
  total?: number
  message?: string
}

const VERSION_PATTERN = /\b(\d+)\.(\d+)\.(\d+)\b/

function normalizeVersion(raw: string): string {
  const match = String(raw).trim().match(VERSION_PATTERN)
  if (!match) return ''
  return match.slice(1).map((part) => String(Number.parseInt(part, 10))).join('.')
}

function parseVersion(version: string): [number, number, number] | null {
  const normalized = normalizeVersion(version)
  if (!normalized) return null
  const [major, minor, patch] = normalized.split('.').map((part) => Number.parseInt(part, 10))
  return [major, minor, patch]
}

function getUpdateConfig(): PlatformUpdateConfig | null {
  if (process.platform === 'darwin') {
    return process.arch === 'x64'
      ? MAC_INTEL_UPDATE_CONFIG
      : MAC_APPLE_SILICON_UPDATE_CONFIG
  }

  return UPDATE_CONFIGS[process.platform] || null
}

export function getLocalVersion(): string {
  // Prod: resources/version.txt (from extraResources). Dev: <repo root>/version.txt.
  const candidates = [
    join(process.resourcesPath || '', 'version.txt'),
    join(app.getAppPath(), 'version.txt'),
    join(app.getAppPath(), '..', 'version.txt')
  ]
  for (const p of candidates) {
    try {
      if (p && existsSync(p)) {
        const v = normalizeVersion(readFileSync(p, 'utf-8'))
        if (v) return v
      }
    } catch {
      // ignore and try next
    }
  }
  // Fallback: package.json/app version.
  return normalizeVersion(app.getVersion()) || '0.0.0'
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a) || [0, 0, 0]
  const vb = parseVersion(b) || [0, 0, 0]

  for (let i = 0; i < va.length; i += 1) {
    const diff = va[i] - vb[i]
    if (diff !== 0) return diff
  }
  return 0
}

function httpGet(url: string, maxRedirects = 5): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.get(url, { headers: { 'User-Agent': 'akaAgent-Updater' } }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && maxRedirects > 0) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        httpGet(next, maxRedirects - 1).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status} khi tải ${url}`))
        return
      }
      resolve(res)
    })
    req.on('error', reject)
    req.setTimeout(30_000, () => {
      req.destroy(new Error('Timeout khi kết nối server cập nhật'))
    })
  })
}

async function fetchText(url: string): Promise<string> {
  const res = await httpGet(url)
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    res.on('data', (c: Buffer) => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()))
    res.on('error', reject)
  })
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const localVersion = getLocalVersion()
  const config = getUpdateConfig()
  if (!config) {
    return {
      hasUpdate: false,
      localVersion,
      remoteVersion: '',
      error: `Auto-update chưa hỗ trợ nền tảng ${process.platform}`
    }
  }

  try {
    const remoteVersion = normalizeVersion(await fetchText(config.versionUrl))
    if (!remoteVersion) {
      return { hasUpdate: false, localVersion, remoteVersion: '', error: 'Không đọc được phiên bản từ server' }
    }
    return {
      hasUpdate: compareVersions(remoteVersion, localVersion) > 0,
      localVersion,
      remoteVersion
    }
  } catch (err) {
    return {
      hasUpdate: false,
      localVersion,
      remoteVersion: '',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

async function downloadInstaller(
  targetPath: string,
  installerUrl: string,
  onProgress: (p: UpdateProgress) => void
): Promise<void> {
  const res = await httpGet(installerUrl)
  const total = parseInt(res.headers['content-length'] || '0', 10) || 0
  let transferred = 0
  const partialPath = `${targetPath}.download`

  // Never expose a stale or partial download as the executable installer.
  for (const pathToRemove of [targetPath, partialPath]) {
    try { if (existsSync(pathToRemove)) unlinkSync(pathToRemove) } catch { /* ignore */ }
  }

  const out = createWriteStream(partialPath)

  try {
    await new Promise<void>((resolve, reject) => {
      let lastEmitted = 0
      res.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        const now = Date.now()
        // Throttle progress events to at most every 150ms
        if (now - lastEmitted > 150) {
          lastEmitted = now
          const percent = total > 0 ? Math.min(99, Math.floor((transferred / total) * 100)) : 0
          onProgress({ phase: 'downloading', percent, transferred, total })
        }
      })
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve()))
      out.on('error', reject)
      res.on('error', reject)
    })

    if (total > 0 && transferred !== total) {
      throw new Error(`File cập nhật tải chưa đủ (${transferred}/${total} byte).`)
    }

    renameSync(partialPath, targetPath)
    onProgress({
      phase: 'downloading',
      percent: 100,
      transferred,
      total: total || transferred
    })
  } catch (err) {
    try { out.destroy() } catch { /* ignore */ }
    try { if (existsSync(partialPath)) unlinkSync(partialPath) } catch { /* ignore */ }
    throw err
  }
}

function assertWindowsInstallerFile(installerPath: string): void {
  const fileSize = statSync(installerPath).size
  if (fileSize < 1024 * 1024) {
    throw new Error('File cập nhật Windows không hợp lệ hoặc quá nhỏ.')
  }

  const header = Buffer.alloc(2)
  const descriptor = openSync(installerPath, 'r')
  try {
    readSync(descriptor, header, 0, header.length, 0)
  } finally {
    closeSync(descriptor)
  }

  if (header.toString('ascii') !== 'MZ') {
    throw new Error('File cập nhật Windows không phải bộ cài PE hợp lệ.')
  }
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

function buildWindowsUpdateHelperScript(installerPath: string): string {
  const sourcePid = process.pid
  const processName = basename(process.execPath, extname(process.execPath))
  const logPath = join(app.getPath('temp'), 'akaAgent-update-helper.log')

  return `
$ErrorActionPreference = 'Stop'
$installerPath = '${escapePowerShellSingleQuoted(installerPath)}'
$sourcePid = ${sourcePid}
$sourceProcessName = '${escapePowerShellSingleQuoted(processName)}'
$logPath = '${escapePowerShellSingleQuoted(logPath)}'

function Write-UpdateHelperLog([string] $message) {
  try {
    Add-Content -LiteralPath $logPath -Value ("{0:o} {1}" -f (Get-Date), $message) -Encoding UTF8
  } catch {}
}

try {
  Write-UpdateHelperLog "Waiting for PID $sourcePid ($sourceProcessName) to exit."
  Wait-Process -Id $sourcePid -ErrorAction SilentlyContinue

  while (Get-Process -Name $sourceProcessName -ErrorAction SilentlyContinue) {
    Start-Sleep -Milliseconds 250
  }

  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Downloaded installer is missing: $installerPath"
  }

  Write-UpdateHelperLog "Application exited; starting installer with --updated."
  $installerProcess = Start-Process -FilePath $installerPath -ArgumentList @('--updated') -PassThru
  Write-UpdateHelperLog "Installer started with PID $($installerProcess.Id)."
  exit 0
} catch {
  Write-UpdateHelperLog "Update helper failed: $($_.Exception.Message)"
  exit 1
}
`.trim()
}

function runWindowsInstallerAfterAppExits(installerPath: string): Promise<void> {
  const encodedScript = Buffer
    .from(buildWindowsUpdateHelperScript(installerPath), 'utf16le')
    .toString('base64')

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand',
      encodedScript
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function quitMacAppAfterDmgOpens(delayMs = 1500): void {
  setTimeout(() => app.quit(), delayMs)
}

export async function downloadAndInstall(
  mainWindow: BrowserWindow | null
): Promise<{ success: boolean; error?: string }> {
  const config = getUpdateConfig()
  if (!config) {
    return { success: false, error: `Auto-update chưa hỗ trợ nền tảng ${process.platform}` }
  }

  const emit = (payload: UpdateProgress): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_EVENTS.UPDATE_PROGRESS, payload)
    }
  }

  const tempDir = app.getPath('temp')
  const installerPath = join(tempDir, config.installerFilename)

  try {
    emit({ phase: 'downloading', percent: 0, transferred: 0, total: 0 })
    await downloadInstaller(installerPath, config.installerUrl, emit)

    if (process.platform === 'win32') {
      assertWindowsInstallerFile(installerPath)
    }

    emit({ phase: 'installing', message: process.platform === 'darwin' ? 'Đang mở file cập nhật…' : 'Đang khởi chạy bộ cài đặt…' })

    if (process.platform === 'win32') {
      await runWindowsInstallerAfterAppExits(installerPath)

      emit({
        phase: 'done',
        message: 'Ứng dụng đang thoát an toàn. Bộ cài đặt sẽ tự mở sau khi mọi tiến trình đã kết thúc.'
      })

      app.quit()

      return { success: true }
    }

    const openError = await shell.openPath(installerPath)
    if (openError) throw new Error(openError)

    emit({
      phase: 'done',
      message: 'File cập nhật đã mở. Ứng dụng sẽ tự thoát để bạn kéo akaAgent vào Applications.'
    })

    quitMacAppAfterDmgOpens()

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ phase: 'error', message })
    return { success: false, error: message }
  }
}
