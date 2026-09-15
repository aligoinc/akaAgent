/** Error cleanup only. Normal claim/settle retries do not use this helper. */
export interface CampaignFailureCleanupPayload {
  campaignId: number
  accountId: number
  staffId: number
  runtimeTarget: 'desktop' | 'server'
  runtimeClaimToken: string
  runtimeUnitToken: string | null
  unstartedInputDataIds: readonly number[]
  note: string
  pauseUnknownOutcome: boolean
  campaignStatus: string | null
  accountStatus: string | null
}

export { RuntimeCleanupRetry as CampaignFailureCleanup, isTemporaryCleanupError } from './runtimeCleanupRetry'
export type { RuntimeCleanupResult as CampaignFailureCleanupResult, RuntimeCleanupOutcome as CampaignFailureCleanupOutcome } from './runtimeCleanupRetry'
