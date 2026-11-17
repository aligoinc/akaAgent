import { app } from 'electron'
import { getSupabaseClient } from '../data/supabaseClient'
import { getCurrentDeviceIdentity } from './deviceIdentity'
import { PassiveDevicePresence } from './passiveDevicePresence'
import { desktopRuntimeSnapshot } from './desktopRuntimeSnapshot'
import { respondToDiagnostics } from '../engineAdapters/facebook/diagnosticsResponder'

let presenceV2 = true

export const devicePresence = new PassiveDevicePresence({
  getDevice: async () => {
    const runtime = desktopRuntimeSnapshot.build()
    // Bản Web cũ/RPC trước v461 bỏ qua khoá lạ; ảnh chụp lỗi không chặn heartbeat.
    return { ...await getCurrentDeviceIdentity(), appVersion: app.getVersion(), ...(runtime ? { runtime: runtime as unknown as Record<string, unknown> } : {}) }
  },
  send: async (args, signal) => {
    // V556: bản v2 trả thêm số yêu cầu ảnh lỗi đang mở; DB chưa có V556 (PGRST202) thì dùng bản cũ tới hết phiên.
    if (presenceV2) {
      const { data, error } = await getSupabaseClient().rpc('aka_agent_device_presence_v2', args).abortSignal(signal)
      if (!error) {
        if (Number((data as { diagnostics?: unknown } | null)?.diagnostics) > 0) void respondToDiagnostics()
        return
      }
      if (error.code !== 'PGRST202') throw new Error('Presence unavailable')
      presenceV2 = false
    }
    const { error } = await getSupabaseClient().rpc('aka_agent_device_presence', args).abortSignal(signal)
    if (error) throw new Error('Presence unavailable')
  },
  warn: () => console.warn('[DevicePresence] Không cập nhật được trạng thái; sẽ thử lại ở nhịp kế tiếp.')
})
