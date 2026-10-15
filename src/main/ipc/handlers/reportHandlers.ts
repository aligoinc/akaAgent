import type { AccountActionStatusReportDetailQuery } from '../../../shared/actionStatusReport'
import { ipcMain } from 'electron'
import { AccountActionReportDetailQuery, AccountActionReportQuery, IPC_EVENTS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerReportHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_STATUS_SUMMARY, async (_, query: AccountActionReportQuery) => {
    return supabase.getAccountActionStatusReport(query)
  })
  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_STATUS_DETAILS, async (_, query: AccountActionStatusReportDetailQuery) => {
    return supabase.getAccountActionStatusReportDetails(query)
  })
  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_SUMMARY, async (_, query: AccountActionReportQuery) => {
    return supabase.getAccountActionReport(query)
  })

  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_DETAILS, async (_, query: AccountActionReportDetailQuery) => {
    return supabase.getAccountActionReportDetails(query)
  })
}
