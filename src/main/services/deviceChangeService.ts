import { app } from 'electron'
import { join } from 'node:path'
import { getSupabaseClient } from '../data/supabaseClient'
import { getDeviceForBindingReset, getV2DeviceIdentity } from './deviceIdentity'
import { DeviceChangeRequestClient } from './deviceChangeRequest'

let requests: DeviceChangeRequestClient | null = null

export function getDeviceChangeRequests(): DeviceChangeRequestClient {
  if (!requests) {
    requests = new DeviceChangeRequestClient({
      directory: join(app.getPath('userData'), 'device-change-requests-v2'),
      bindingVersion: 2,
      getDevice: async () => ({ ...await getDeviceForBindingReset(), appVersion: app.getVersion() }),
      // Published v2 clients wrote version-1 journals before device metadata was
      // persisted. Preserve their v2 audit hash when upgrading a pending request.
      getLegacyJournalDevice: async () => ({ ...await getV2DeviceIdentity(), appVersion: app.getVersion() }),
      rpc: async (name, args) => {
        const { data, error } = await getSupabaseClient().rpc(name, args).abortSignal(AbortSignal.timeout(15_000))
        if (error) throw new Error('Không thể xác nhận đổi máy tính với máy chủ. Vui lòng kiểm tra internet và thử lại.')
        return data
      }
    })
  }
  return requests
}
