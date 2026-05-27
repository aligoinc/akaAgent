import { ipcMain } from 'electron'
import { EmailNotificationSettings, IPC_EVENTS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerEmailNotificationHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.EMAIL_NOTIFICATION_SETTINGS_GET, async () => {
    return supabase.getEmailNotificationSettings()
  })

  ipcMain.handle(IPC_EVENTS.EMAIL_NOTIFICATION_SETTINGS_SAVE, async (_, settings: Partial<EmailNotificationSettings>) => {
    return supabase.saveEmailNotificationSettings(settings)
  })
}
