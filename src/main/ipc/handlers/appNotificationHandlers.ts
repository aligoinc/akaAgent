import { ipcMain } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerAppNotificationHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.APP_NOTIFICATION_GET_ACTIVE, async () => {
    return supabase.getActiveAppNotification()
  })
}
