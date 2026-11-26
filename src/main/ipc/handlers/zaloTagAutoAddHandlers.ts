import { ipcMain } from 'electron'
import { getSupabaseClient } from '../../data/supabaseClient'
import { requireCurrentUser } from '../../data/currentUser'
import {
  ZALO_TAG_AUTO_ADD_DESKTOP_SET_RPC, ZALO_TAG_AUTO_ADD_SET_CHANNEL, zaloTagAutoAddSetErrorMessage,
  type ZaloTagAutoAddSetResult
} from '../../../shared/zaloTagAutoAdd'

/** V660: công tắc Dừng / Tiếp tục tự thêm người được gắn tag. DB chỉ đổi đúng một khoá của chiến dịch. */
export function registerZaloTagAutoAddHandlers(): void {
  ipcMain.handle(ZALO_TAG_AUTO_ADD_SET_CHANNEL, async (_, campaignId: unknown, enabled: unknown): Promise<ZaloTagAutoAddSetResult> => {
    requireCurrentUser()
    const id = Number(campaignId)
    if (!Number.isSafeInteger(id) || id <= 0 || typeof enabled !== 'boolean') {
      return { ok: false, code: 'invalid_request', message: zaloTagAutoAddSetErrorMessage('invalid_request') }
    }
    const { data, error } = await getSupabaseClient()
      .rpc(ZALO_TAG_AUTO_ADD_DESKTOP_SET_RPC, { p_campaign_id: id, p_enabled: enabled })
      .abortSignal(AbortSignal.timeout(15_000))
    if (error) {
      const code = error.code === 'PGRST202' ? 'not_installed' : 'rpc_failed'
      return { ok: false, code, message: zaloTagAutoAddSetErrorMessage(code) }
    }
    const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    if (row.ok !== true) {
      const code = String(row.code || 'rpc_failed')
      return { ok: false, code, message: zaloTagAutoAddSetErrorMessage(code) }
    }
    return { ok: true, enabled: row.enabled === true, changed: row.changed === true }
  })
}
