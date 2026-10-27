/** Chosen by Main, never accepted from renderer IPC. */
export type DeviceLoginSource = 'manual' | 'automatic' | 'remembered' | 'recovery'
export interface DeviceBindingSnapshot { hash: string | null; version: 2 | 3; revision: string }
export interface DeviceV3Decision {
  decision: 'allowed' | 'manual_login_required' | 'device_locked'
  automaticAllowed: boolean
  needsBinding: boolean
  binding: DeviceBindingSnapshot
}
