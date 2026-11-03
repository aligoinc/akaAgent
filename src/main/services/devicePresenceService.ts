import { app } from 'electron'
import { getSupabaseClient } from '../data/supabaseClient'
import { getCurrentDeviceIdentity } from './deviceIdentity'
import { PassiveDevicePresence } from './passiveDevicePresence'
import { desktopRuntimeSnapshot } from './desktopRuntimeSnapshot'

export const devicePresence = new PassiveDevicePresence({
  getDevice: async () => {
    const runtime = desktopRuntimeSnapshot.build()
    // Bản Web cũ/RPC trước v454 bỏ qua khoá lạ; ảnh chụp lỗi không chặn heartbeat.
    return { ...await getCurrentDeviceIdentity(), appVersion: app.getVersion(), ...(runtime ? { runtime: runtime as unknown as Record<string, unknown> } : {}) }
  },
  send: async (args, signal) => {
    const { error } = await getSupabaseClient().rpc('aka_agent_device_presence', args).abortSignal(signal)
    if (error) throw new Error('Presence unavailable')
  },
  warn: () => console.warn('[DevicePresence] Không cập nhật được trạng thái; sẽ thử lại ở nhịp kế tiếp.')
})
