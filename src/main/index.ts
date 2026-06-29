import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

function getAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

function focusMainWindow(): void {
  const win = mainWindow || BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    icon: getAppIconPath(),
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#edf3fa',
      symbolColor: '#64748b',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  })

  window.on('ready-to-show', () => {
    window.maximize()
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return window
}

function loadRenderer(mainWindow: BrowserWindow): void {
  // Hot reload in dev, load from file in prod
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.akabiz.auto')
    if (process.platform === 'darwin') {
      app.dock.setIcon(getAppIconPath())
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    mainWindow = createWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // Register IPC handlers
    try {
      registerIpcHandlers(mainWindow)
      console.log('IPC handlers registered successfully.')
    } catch (error) {
      console.error('FAILED TO REGISTER IPC HANDLERS:', error)
    }
    loadRenderer(mainWindow)

    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        focusMainWindow()
        return
      }

      mainWindow = createWindow()
      mainWindow.on('closed', () => {
        mainWindow = null
      })
      loadRenderer(mainWindow)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
