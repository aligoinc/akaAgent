import type { ActionLimitConfig } from './types'

export function normalizePositiveActionLimit(value: unknown): number | undefined {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Shared by the scheduler and the campaign form's usage denominators. */
export function resolveAccountActionLimitConfig(
  campaignLimit?: ActionLimitConfig,
  groupLimit?: ActionLimitConfig,
  dailyLimitCap?: number | null
): ActionLimitConfig | undefined {
  const config = groupLimit ? {
    dailyLimit: normalizePositiveActionLimit(groupLimit.dailyLimit) ?? campaignLimit?.dailyLimit,
    rateLimitCount: normalizePositiveActionLimit(groupLimit.rateLimitCount) ?? campaignLimit?.rateLimitCount,
    rateLimitMinutes: normalizePositiveActionLimit(groupLimit.rateLimitMinutes) ?? campaignLimit?.rateLimitMinutes
  } : campaignLimit
  const cap = normalizePositiveActionLimit(dailyLimitCap)
  if (!cap) return config
  return {
    ...(config || {}),
    dailyLimit: Math.min(normalizePositiveActionLimit(config?.dailyLimit) ?? 30, cap)
  }
}
