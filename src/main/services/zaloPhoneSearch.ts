/** Shared bucket selection for campaign lookups and read-only phone scans. */
export type PhoneSearchLimitScope = 'hour' | 'day'
export interface PhoneSearchAttempt { reqSrc: 32 | 40; outcome: 'success' | 'error'; errorCode?: string; errorMessage?: string }
export function phoneSearchErrorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? '').trim()
}
export function phoneSearchLimitScope(policy: {
  disableActionCodes: string[]; disableActionMode?: string; timeDisableActions?: number | null
} | null | undefined): PhoneSearchLimitScope | null {
  if (!policy?.disableActionCodes.includes('zalo_find_phone_user')) return null
  if (policy.disableActionMode === 'end_of_day') return 'day'
  return policy.disableActionMode === 'fixed_minutes' && Number(policy.timeDisableActions) > 0 ? 'hour' : null
}
export async function searchZaloPhone<T>(
  request: (reqSrc: 32 | 40) => Promise<T>,
  resolveLimit: (code: string) => Promise<PhoneSearchLimitScope | null>,
  signal?: AbortSignal
): Promise<{ user: T; attempts: PhoneSearchAttempt[] }> {
  const attempts: PhoneSearchAttempt[] = []
  const attempt = (reqSrc: 32 | 40, error: unknown): PhoneSearchAttempt => ({
    reqSrc, outcome: 'error', errorCode: phoneSearchErrorCode(error) || undefined,
    errorMessage: error instanceof Error ? error.message : String(error)
  })
  let firstError: unknown
  let firstScope: PhoneSearchLimitScope | null = null
  signal?.throwIfAborted()
  try {
    const user = await request(32)
    signal?.throwIfAborted()
    return { user, attempts }
  } catch (error) {
    signal?.throwIfAborted()
    const code = phoneSearchErrorCode(error)
    if (code) {
      firstScope = await resolveLimit(code)
      if (!firstScope) throw error
    }
    firstError = error
    attempts.push(attempt(32, error))
  }
  signal?.throwIfAborted()
  try {
    const user = await request(40)
    signal?.throwIfAborted()
    attempts.push({ reqSrc: 40, outcome: 'success' })
    return { user, attempts }
  } catch (error) {
    signal?.throwIfAborted()
    attempts.push(attempt(40, error))
    const code = phoneSearchErrorCode(error)
    const scope = firstScope && code ? await resolveLimit(code) : null
    const selected = firstScope && (!code || firstScope === 'hour' && scope === 'day') ? firstError : error
    const failure = selected instanceof Error ? selected : new Error(String(selected))
    ;(failure as Error & { searchPhoneAttempts: PhoneSearchAttempt[] }).searchPhoneAttempts = attempts
    throw failure
  }
}
