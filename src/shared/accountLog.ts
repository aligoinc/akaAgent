/** Keep this dependency-free contract identical in akaAgentChatApi/packages/database. */
export interface AccountLogEvent {
  accountId: number | string
  campaignId?: number | string | null
  loginStatus?: string | null
  accountStatus?: string | null
  source: string
  eventType: string
  message: string
  createdAt?: string
  details?: Record<string, unknown>
}

export interface AccountLogRow {
  created_at: string
  account_id: string
  campaign_id: string | null
  login_status: string | null
  account_status: string | null
  source: string
  event_type: string
  message: string
  details: Record<string, string | number | boolean | null>
}

// Never serialize errors, sessions, request bodies, contacts or conversation content.
const DETAIL_KEYS = new Set([
  'error_code', 'normalized_error_code', 'api', 'action_code', 'campaign_name',
  'previous_login_status', 'previous_account_status', 'campaign_status',
  'previous_campaign_status', 'operation', 'runtime_state', 'close_code',
  'reason', 'app_version'
])

export function sanitizeAccountLogText(value: string): string {
  return value.slice(0, 8_000)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/(["']?(?:cookie|set-cookie|authorization|password|passwd|token|access_token|refresh_token|session|zalo_session|session_key|zpw_sek|zpsid|imei|secret)["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, '$1[REDACTED]')
    .slice(0, 2_000)
}

function id(value: number | string): string {
  const result = String(value)
  if (!/^[1-9]\d*$/.test(result)) throw new Error('Invalid diagnostic account ID')
  return result
}

/** Immediate, one-request-per-event telemetry. No queue, retry, or throwing to callers. */
export function createAccountLogRecorder(
  send: (row: AccountLogRow, signal: AbortSignal) => PromiseLike<unknown>,
  timeoutMs = 5_000
): (event: AccountLogEvent) => void {
  return event => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const details: AccountLogRow['details'] = {}
      for (const [key, value] of Object.entries(event.details ?? {})) {
        if (!DETAIL_KEYS.has(key)) continue
        if (typeof value === 'string') details[key] = sanitizeAccountLogText(value)
        else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) details[key] = value
      }
      const row: AccountLogRow = {
        created_at: event.createdAt ?? new Date().toISOString(),
        account_id: id(event.accountId),
        campaign_id: event.campaignId == null ? null : id(event.campaignId),
        login_status: event.loginStatus == null ? null : sanitizeAccountLogText(event.loginStatus),
        account_status: event.accountStatus == null ? null : sanitizeAccountLogText(event.accountStatus),
        source: sanitizeAccountLogText(event.source),
        event_type: sanitizeAccountLogText(event.eventType),
        message: sanitizeAccountLogText(event.message),
        details
      }
      const controller = new AbortController()
      // Abort the actual request; also settle locally if a transport ignores abort.
      const deadline = new Promise<void>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve() }, timeoutMs)
        ;(timer as unknown as { unref?: () => void }).unref?.()
      })
      const request = Promise.resolve(send(row, controller.signal))
      void Promise.race([request, deadline]).catch(() => {}).finally(() => {
        if (timer !== undefined) clearTimeout(timer)
      })
    } catch {
      if (timer !== undefined) clearTimeout(timer)
      // Diagnostics must never enter the business error/retry path.
    }
  }
}
