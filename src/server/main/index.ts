import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { runWithCurrentUser } from '../../main/data/currentUser'
import {
  authenticateZaloRuntimeHandoff,
  authenticateZaloServerClient,
  hasLiveControlRealtimeSession,
  hasLiveZaloServerRealtimeCapability
} from '../../main/data/repositories/serverRuntimeRepository'
import { ZALO_SERVER_IPC } from '../../shared/zaloServerProtocol'
import { installServerFileLogger, type ServerFileLogger } from './serverFileLogger'
import { ServerRuntimeOwnershipStore } from './serverRuntimeOwnershipStore'
import { ZaloServerGateway } from './zaloServerGateway'
import { ZaloServerRuntimeManager } from './zaloServerRuntimeManager'

let mainWindow: BrowserWindow | null = null
let gateway: ZaloServerGateway | null = null
let runtimeManager: ZaloServerRuntimeManager | null = null
let serverFileLogger: ServerFileLogger | null = null
let clientCountSnapshotTimer: ReturnType<typeof setTimeout> | null = null
let shutdownStarted = false
let shutdownComplete = false

function scheduleClientCountSnapshot(): void {
  if (shutdownStarted) return
  if (clientCountSnapshotTimer) clearTimeout(clientCountSnapshotTimer)
  clientCountSnapshotTimer = setTimeout(() => {
    clientCountSnapshotTimer = null
    if (shutdownStarted) return
    gateway?.broadcastSnapshot()
    const window = mainWindow
    if (window && !window.isDestroyed()) {
      window.webContents.send(ZALO_SERVER_IPC.SNAPSHOT_UPDATED, runtimeManager?.getSnapshot())
    }
  }, 250)
}

function configureServerDataPath(): string {
  if (process.platform !== 'win32') return app.getPath('userData')
  const programData = process.env.PROGRAMDATA || 'C:\\ProgramData'
  const dataPath = join(programData, 'akaAgentServer')
  mkdirSync(dataPath, { recursive: true })
  app.setPath('userData', dataPath)
  return dataPath
}

// Configure the shared ProgramData path before taking Electron's instance lock,
// so different Windows login sessions still contend for the same server instance.
const serverDataPath = configureServerDataPath()
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

function getIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../../build/icon.png')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'akaAgent Zalo Server',
    icon: getIconPath(),
    backgroundColor: '#090d16',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(details => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  window.on('close', event => {
    if (shutdownComplete) return
    event.preventDefault()
    app.quit()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }
  await window.loadFile(join(__dirname, '../renderer/index.html'))
}

async function startServer(): Promise<void> {
  const ownershipStore = new ServerRuntimeOwnershipStore(join(serverDataPath, 'runtime-ownership.json'))
  runtimeManager = new ZaloServerRuntimeManager({
    adminWindow: () => mainWindow,
    publishEvent: event => gateway?.publish(event),
    publishLiveEvent: event => gateway?.publishLive(event),
    publishControlEvent: event => gateway?.publishControl(event),
    broadcastSnapshot: () => gateway?.broadcastSnapshot(),
    connectedClientCount: () => gateway?.connectedClientCount || 0,
    listeningAt: () => gateway?.listeningAt || 'http://127.0.0.1:8787',
    ownershipStore
  })
  gateway = new ZaloServerGateway({
    authenticate: async (username, password) => {
      const user = await authenticateZaloServerClient(username, password)
      if (!user) throw new Error('Sai thông tin đăng nhập, gói chưa bật Zalo Server hoặc đã hết hạn')
      // Session authentication stays independent from runtime readiness while
      // a newly enabled staff is waiting for desktop handoff.
      void runtimeManager!.ensureUser(user).catch(error => {
        console.error(`[akaAgent Zalo Server] Cannot ensure staff runtime ${user.staffId}:`, error)
      })
      return { staffId: user.staffId, organizationId: user.organizationId }
    },
    handoffToDesktop: async (username, password) => {
      const user = await authenticateZaloRuntimeHandoff(username, password)
      if (!user) throw new Error('Sai thông tin đăng nhập hoặc gói Zalo đã hết hạn')
      return runWithCurrentUser(user, () => runtimeManager!.handoffToDesktop(user.staffId))
    },
    desktopHandoffReady: async (username, password, expectedModeRevision) => {
      const user = await authenticateZaloServerClient(username, password)
      if (!user) throw new Error('Sai thông tin đăng nhập, gói chưa bật Zalo Server hoặc đã hết hạn')
      return runWithCurrentUser(user, () =>
        runtimeManager!.acceptDesktopHandoffReady(user, expectedModeRevision)
      )
    },
    getSnapshot: staffId => runtimeManager!.getSnapshot(staffId),
    getOperations: staffId => runtimeManager!.getOperations(staffId),
    executeCommand: (staffId, command, args) => runtimeManager!.executeCommand(staffId, command, args),
    startControlOperation: (staffId, command, args) => runtimeManager!.startControlOperation(staffId, command, args),
    revalidateControlSession: (staffId, organizationId, sessionId) =>
      hasLiveControlRealtimeSession(staffId, organizationId, sessionId),
    revalidateControlCapability: (staffId, organizationId) =>
      hasLiveZaloServerRealtimeCapability(staffId, organizationId),
    onClientCountChanged: scheduleClientCountSnapshot
  })

  ipcMain.handle(ZALO_SERVER_IPC.GET_SNAPSHOT, () => runtimeManager!.getSnapshot())
  ipcMain.handle(ZALO_SERVER_IPC.CLEAR_LOGS, () => {
    // All stores are synchronous so no runtime event can be inserted halfway
    // through the flush. Clear disk first so a file permission failure leaves
    // the visible/in-memory history intact instead of reporting false success.
    serverFileLogger?.clear()
    const clearedThroughSequence = runtimeManager!.clearLogs()
    gateway?.clearEventBuffers()
    return { clearedThroughSequence }
  })
  await gateway.start()
  await runtimeManager.start()
}

async function shutdown(): Promise<void> {
  if (shutdownStarted) return
  shutdownStarted = true
  if (clientCountSnapshotTimer) {
    clearTimeout(clientCountSnapshotTimer)
    clientCountSnapshotTimer = null
  }
  console.log('[akaAgent Zalo Server] Graceful shutdown started.')
  try {
    // Start both shutdown barriers immediately. Runtime discovery/commands must
    // stop accepting work even if closing the HTTPS/WSS gateway takes time.
    const gatewayStop = gateway?.stop() ?? Promise.resolve()
    const runtimeStop = runtimeManager?.stop() ?? Promise.resolve()
    const results = await Promise.allSettled([gatewayStop, runtimeStop])
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
  } catch (error) {
    console.error('[akaAgent Zalo Server] Graceful shutdown failed:', error)
  } finally {
    shutdownComplete = true
    console.log('[akaAgent Zalo Server] Graceful shutdown completed.')
    app.quit()
  }
}

if (gotSingleInstanceLock) {
  serverFileLogger = installServerFileLogger(join(serverDataPath, 'logs', 'server.log'))
  app.commandLine.appendSwitch('disable-background-timer-throttling')

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('before-quit', event => {
    if (shutdownComplete) return
    event.preventDefault()
    void shutdown()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.akabiz.zalo-server')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    mainWindow = createWindow()
    try {
      await Promise.all([startServer(), loadRenderer(mainWindow)])
      console.log('[akaAgent Zalo Server] Listening on 127.0.0.1:8787')
    } catch (error) {
      console.error('[akaAgent Zalo Server] Startup failed:', error)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(ZALO_SERVER_IPC.SNAPSHOT_UPDATED, runtimeManager?.getSnapshot())
      }
    }
  })

  app.on('window-all-closed', () => app.quit())
}
