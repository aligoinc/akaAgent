import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()
const REDACTED = '[REDACTED]'
const MAX_JSON_DEPTH = 8
const SECRET_KEY_PATTERN = /cookie|session|zalo[_-]?session|zpw[_-]?sek|imei|token|password/i

export interface ZaloApiErrorLogInput {
  staffId?: number | null
  organizationId?: number | null
  accountId?: number | null
  campaignId?: number | null
  campaignInputDataId?: number | null
  campaignDetailId?: number | null
  actionCode?: string | null
  actionName?: string | null
  apiName?: string | null
  zaloErrorCode?: string | null
  zaloErrorMessage?: string | null
  normalizedErrorCode?: string | null
  detailStatus?: string | null
  requestPayload?: unknown
  targetPayload?: unknown
  rawError?: unknown
}

function sanitizeForJson(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return String(value)
  if (depth >= MAX_JSON_DEPTH) return '[MaxDepth]'

  if (value instanceof Error) {
    return sanitizeForJson({
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value as unknown as Record<string, unknown>)
    }, depth + 1, seen)
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForJson(item, depth + 1, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizeForJson(item, depth + 1, seen)
    }
    return output
  }

  return String(value)
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

export async function createZaloApiErrorLog(input: ZaloApiErrorLogInput): Promise<void> {
  const payload = {
    staff_id: input.staffId ?? null,
    organization_id: input.organizationId ?? null,
    account_id: input.accountId ?? null,
    campaign_id: input.campaignId ?? null,
    campaign_input_data_id: input.campaignInputDataId ?? null,
    campaign_detail_id: input.campaignDetailId ?? null,
    action_code: textOrNull(input.actionCode),
    action_name: textOrNull(input.actionName),
    api_name: textOrNull(input.apiName),
    zalo_error_code: textOrNull(input.zaloErrorCode),
    zalo_error_message: textOrNull(input.zaloErrorMessage),
    normalized_error_code: textOrNull(input.normalizedErrorCode),
    detail_status: textOrNull(input.detailStatus),
    request_payload: sanitizeForJson(input.requestPayload) || {},
    target_payload: sanitizeForJson(input.targetPayload) || {},
    raw_error: sanitizeForJson(input.rawError) || {}
  }

  const { error } = await client()
    .from('auto_zalo_api_error_logs')
    .insert(payload)

  if (error) throw new Error(`Failed to create Zalo API error log: ${error.message}`)
}
