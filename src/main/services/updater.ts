import { app, BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'
import { IPC_EVENTS } from '../../shared/types'

const VERSION_URL = 'https://akabiz.net/UpdateAutoSqlite/akaAgent/version_win.txt'
const INSTALLER_URL = 'https://akabiz.net/UpdateAutoSqlite/akaAgent/akaAgent.exe'
const INSTALLER_FILENAME = 'akaAgent.exe'

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

function normalizeVersion(raw: string): string {
  const m = String(raw).match(/\d+/)
  return m ? m[0] : ''
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
  // Fallback: first integer chunk of package.json version (e.g. "1.0.0" -> "1")
  return normalizeVersion(app.getVersion()) || '0'
}

export function compareVersions(a: string, b: string): number {
  const na = parseInt(String(a).trim(), 10) || 0
  const nb = parseInt(String(b).trim(), 10) || 0
  return na - nb
}

function httpGet(url: string, maxRedirects = 5): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.get(url, { headers: { 'User-Agent': 'akaBizAuto-Updater' } }, (res) => {
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
  try {
    const remoteVersion = normalizeVersion(await fetchText(VERSION_URL))
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
  onProgress: (p: UpdateProgress) => void
): Promise<void> {
  const res = await httpGet(INSTALLER_URL)
  const total = parseInt(res.headers['content-length'] || '0', 10) || 0
  let transferred = 0

  // Remove stale file if exists
  try { if (existsSync(targetPath)) unlinkSync(targetPath) } catch { /* ignore */ }

  const out = createWriteStream(targetPath)

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
    out.on('finish', () => {
      onProgress({
        phase: 'downloading',
        percent: 100,
        transferred,
        total: total || transferred
      })
      out.close(() => resolve())
    })
    out.on('error', reject)
    res.on('error', reject)
  })
}

function runInstaller(installerPath: string): void {
  // Detach and let the NSIS installer take over. When the user confirms,
  // the installer will overwrite the running app.
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
}

export async function downloadAndInstall(
  mainWindow: BrowserWindow | null
): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Auto-update chỉ hỗ trợ Windows' }
  }

  const emit = (payload: UpdateProgress): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_EVENTS.UPDATE_PROGRESS, payload)
    }
  }

  const tempDir = app.getPath('temp')
  const installerPath = join(tempDir, INSTALLER_FILENAME)

  try {
    emit({ phase: 'downloading', percent: 0, transferred: 0, total: 0 })
    await downloadInstaller(installerPath, emit)

    emit({ phase: 'installing', message: 'Đang khởi chạy bộ cài đặt…' })

    try {
      runInstaller(installerPath)
    } catch (spawnErr) {
      // Fallback: ask the shell to open it
      await shell.openPath(installerPath)
      if (spawnErr instanceof Error) console.warn('spawn installer failed, used shell.openPath:', spawnErr.message)
    }

    emit({ phase: 'done', message: 'Bộ cài đặt đã khởi chạy. Thoát ứng dụng để tiếp tục cài đặt.' })

    // Give the installer ~1.5s to appear before we quit ourselves so it can replace the exe.
    setTimeout(() => {
      app.quit()
    }, 1500)

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ phase: 'error', message })
    return { success: false, error: message }
  }
}
