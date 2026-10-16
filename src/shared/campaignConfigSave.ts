import type { CampaignUpdate } from './types'

/** Plain IPC result: Electron does not preserve custom fields on thrown errors. */
export interface CampaignConfigSaveFailure {
  code: 'campaign_input_materialization_failed'
  campaignId: number
  updatedAt: string
  editVersion?: string
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
  expectedEditVersion?: string
  retrySmsInputSchedule?: boolean
}

/** Keep only this editor's committed configuration version for partial-save retries. */
export function createCampaignConfigSaver(
  write: (id: number, updates: CampaignUpdate, options: ConfigWriteOptions) => Promise<void>
) {
  const retries = new WeakMap<AbortSignal, Map<number, {
    originalUpdatedAt?: string
    originalEditVersion?: string
    failure: CampaignConfigSaveFailure
  }>>()
  return async (id: number, updates: CampaignUpdate, expectedUpdatedAt: string | undefined, signal: AbortSignal, expectedEditVersion?: string): Promise<void> => {
    if (signal.aborted) throw new Error('Form sửa chiến dịch đã đóng.')
    const previous = retries.get(signal)?.get(id)
    const retry = previous?.originalUpdatedAt === expectedUpdatedAt && previous?.originalEditVersion === expectedEditVersion ? previous?.failure : undefined
    try {
      await write(id, updates, {
        refresh: false,
        requireEditReady: true,
        expectedUpdatedAt: retry?.updatedAt ?? expectedUpdatedAt,
        expectedEditVersion: retry ? retry.editVersion : expectedEditVersion,
        retrySmsInputSchedule: retry?.updateSmsSchedule
      })
      retries.get(signal)?.delete(id)
    } catch (error) {
      if (!signal.aborted && error instanceof CampaignConfigSaveError && error.result.campaignId === id) {
        const pending = retries.get(signal) ?? new Map()
        pending.set(id, { originalUpdatedAt: expectedUpdatedAt, originalEditVersion: expectedEditVersion, failure: error.result })
        retries.set(signal, pending)
      }
      throw error
    }
  }
}
