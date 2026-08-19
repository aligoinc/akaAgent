import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { IPC_EVENTS, type MediaClipboardImageInput, type MediaGroup, type MediaStorageSettings } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function sanitizeDownloadFilename(value: string, mediaFileId: number): string {
  const sanitized = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180)
  const fallback = `media-${mediaFileId}`
  const filename = sanitized || fallback
  return WINDOWS_RESERVED_FILENAME.test(filename) ? `_${filename}` : filename
}

async function writeUniqueDownload(directory: string, filename: string, data: Buffer): Promise<void> {
  const parsed = parse(filename)
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`
    const candidate = join(directory, `${parsed.name || 'media'}${suffix}${parsed.ext}`)
    try {
      await writeFile(candidate, data, { flag: 'wx' })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error(`Không thể tạo file tải xuống cho ${filename}.`)
}

export function registerMediaHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_GET, async () => {
    return supabase.getMediaStorageSettings()
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_SAVE, async (_, settings: Partial<MediaStorageSettings>) => {
    return supabase.saveMediaStorageSettings(settings)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_TEST, async (_, settings?: Partial<MediaStorageSettings>) => {
    return supabase.testMediaStorageSettings(settings)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_LIST, async () => {
    return supabase.listMediaFiles()
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_UPLOAD, async (_, localPaths: string[]) => {
    return supabase.uploadMediaFiles(localPaths)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_DOWNLOAD, async (event, ids: number[]) => {
    const requestedIds = Array.from(new Set(
      (Array.isArray(ids) ? ids : [])
        .map(Number)
        .filter(id => Number.isSafeInteger(id) && id > 0)
    ))
    if (requestedIds.length === 0) return { canceled: false, downloaded: 0, failed: 0 }

    const requestedIdSet = new Set(requestedIds)
    const files = (await supabase.listMediaFiles()).filter(file => requestedIdSet.has(file.id))
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'Chọn thư mục lưu media',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    }
    const selection = browserWindow
      ? await dialog.showOpenDialog(browserWindow, options)
      : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0]) {
      return { canceled: true, downloaded: 0, failed: 0 }
    }

    let downloaded = 0
    let failed = requestedIds.length - files.length
    for (const file of files) {
      try {
        const response = await fetch(file.cloudUrl, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = Buffer.from(await response.arrayBuffer())
        await writeUniqueDownload(
          selection.filePaths[0],
          sanitizeDownloadFilename(file.originalName, file.id),
          data
        )
        downloaded += 1
      } catch {
        failed += 1
      }
    }
    return { canceled: false, downloaded, failed }
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_CLIPBOARD_IMAGES_UPLOAD, async (_, images: MediaClipboardImageInput[]) => {
    return supabase.uploadMediaClipboardImages(images)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_DELETE, async (_, id: number) => {
    return supabase.deleteMediaFile(id)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_DELETE_MANY, async (_, ids: number[]) => {
    return supabase.deleteMediaFiles(ids)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_LIST, async () => {
    return supabase.listMediaGroups()
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_CREATE, async (_, group: Partial<MediaGroup>) => {
    return supabase.createMediaGroup(group)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_UPDATE, async (_, id: number, updates: Partial<MediaGroup>) => {
    return supabase.updateMediaGroup(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_DELETE, async (_, id: number) => {
    return supabase.deleteMediaGroup(id)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUP_FILE_IDS_LIST, async (_, groupId: number) => {
    return supabase.listMediaGroupFileIds(groupId)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUP_FILES_ADD, async (_, groupId: number, mediaFileIds: number[]) => {
    return supabase.addMediaGroupFiles(groupId, mediaFileIds)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUP_FILES_REMOVE, async (_, groupId: number, mediaFileIds: number[]) => {
    return supabase.removeMediaGroupFiles(groupId, mediaFileIds)
  })
}
