import type { CampaignUpdate } from './types'

/** Plain IPC result: Electron does not preserve custom fields on thrown errors. */
export interface CampaignConfigSaveFailure {
  code: 'campaign_input_materialization_failed'
  campaignId: number
  updatedAt: string
  updateSmsSchedule: boolean
  message: string
}

export class CampaignConfigSaveError extends Error {
  constructor(readonly result: CampaignConfigSaveFailure) {
    super(result.message)
  }
}

interface ConfigWriteOptions {
  refresh: false
  requireEditReady: true
  expectedUpdatedAt?: string
  retrySmsInputSchedule?: boolean
}

/** Keep only this editor's committed version; never adopt a fresh DB version. */
export function createCampaignConfigSaver(
  write: (id: number, updates: CampaignUpdate, options: ConfigWriteOptions) => Promise<void>
) {
  const retries = new WeakMap<AbortSignal, Map<number, {
    originalUpdatedAt?: string
    failure: CampaignConfigSaveFailure
  }>>()
  return async (id: number, updates: CampaignUpdate, expectedUpdatedAt: string | undefined, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) throw new Error('Form sửa chiến dịch đã đóng.')
    const previous = retries.get(signal)?.get(id)
    const retry = previous?.originalUpdatedAt === expectedUpdatedAt ? previous?.failure : undefined
    try {
      await write(id, updates, {
        refresh: false,
        requireEditReady: true,
        expectedUpdatedAt: retry?.updatedAt ?? expectedUpdatedAt,
        retrySmsInputSchedule: retry?.updateSmsSchedule
      })
      retries.get(signal)?.delete(id)
    } catch (error) {
      if (!signal.aborted && error instanceof CampaignConfigSaveError && error.result.campaignId === id) {
        const pending = retries.get(signal) ?? new Map()
        pending.set(id, { originalUpdatedAt: expectedUpdatedAt, failure: error.result })
        retries.set(signal, pending)
      }
      throw error
    }
  }
}
