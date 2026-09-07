import { app } from 'electron'
import { getSupabaseClient } from '../data/supabaseClient'
import { getCurrentDeviceIdentity } from './deviceIdentity'
import { PassiveDevicePresence } from './passiveDevicePresence'

export const devicePresence = new PassiveDevicePresence({
  getDevice: async () => ({ ...await getCurrentDeviceIdentity(), appVersion: app.getVersion() }),
  send: async (args, signal) => {
    const { error } = await getSupabaseClient().rpc('aka_agent_device_presence', args).abortSignal(signal)
    if (error) throw new Error('Presence unavailable')
  },
  warn: () => console.warn('[DevicePresence] Không cập nhật được trạng thái; sẽ thử lại ở nhịp kế tiếp.')
})
