/**
 * Sổ tag Zalo (V660): nối zaloTagSyncRuntime.ts với DB thật và phiên Zalo của tiến trình này.
 *   - App Desktop: tài khoản Zalo QR của nhân viên đang đăng nhập, hàm theo phiên `aka_agent_desktop_*`.
 *   - App Server: mỗi nhân viên một ZaloRuntimeService; chỉ hỏi tài khoản đang có phiên trong runtime đó, quyền máy chủ.
 * Bật / tắt theo vòng đời của ZaloRealtimeGroupCampaignManager (cùng runtime, cùng lúc bật / tắt), nên không phải nối thêm vào
 * các đường đăng nhập / đăng xuất / chuyển runtime.
 */
import { getCurrentUser } from '../data/currentUser'
import { getSupabaseClient } from '../data/supabaseClient'
import {
  ZALO_TAG_SYNC_ACCOUNTS_RPC, ZALO_TAG_SYNC_DESKTOP_ACCOUNTS_RPC, ZALO_TAG_SYNC_DESKTOP_RPC, ZALO_TAG_SYNC_RPC
} from '../../shared/zaloTagAutoAdd'
import type { ZaloRuntimeService } from './zaloRuntimeService'
import { ZaloTagSyncRuntime } from './zaloTagSyncRuntime'

let lastWarningAt = 0

export function createZaloTagSync(zaloRuntime: ZaloRuntimeService, target: 'desktop' | 'server'): ZaloTagSyncRuntime {
  const runtime: ZaloTagSyncRuntime = new ZaloTagSyncRuntime({
    active: () => target === 'server' || Boolean(getCurrentUser()),
    loadAccounts: async () => {
      const client = getSupabaseClient()
      if (target === 'desktop') {
        const { data, error } = await client.rpc(ZALO_TAG_SYNC_DESKTOP_ACCOUNTS_RPC).abortSignal(AbortSignal.timeout(10_000))
        if (error) throw error
        return data
      }
      const cached = zaloRuntime.cachedAccountIds()
      if (cached.length === 0) return { enabled: false, accountIds: [] }
      const { data, error } = await client.rpc(ZALO_TAG_SYNC_ACCOUNTS_RPC, { p_source: 'server', p_account_ids: cached })
        .abortSignal(AbortSignal.timeout(10_000))
      if (error) throw error
      return data
    },
    sync: async items => {
      const client = getSupabaseClient()
      const request = target === 'desktop'
        ? client.rpc(ZALO_TAG_SYNC_DESKTOP_RPC, { p_items: items })
        : client.rpc(ZALO_TAG_SYNC_RPC, { p_source: 'server', p_items: items })
      const { data, error } = await request.abortSignal(AbortSignal.timeout(25_000))
      if (error) throw error
      return data
    },
    readLabels: accountId => zaloRuntime.peekLabels(accountId),
    warn: (kind, detail) => {
      // PGRST202: DB chưa có V660 → im lặng (bản app ra trước migration).
      if (String(detail?.message || '').includes('PGRST202') || String(detail?.message || '').includes('Could not find the function')) return
      if (Date.now() - lastWarningAt < 60_000) return
      lastWarningAt = Date.now()
      console.warn('[ZaloTagSync] degraded', { kind, target, ...detail, ...runtime.metrics })
    }
  })
  return runtime
}
