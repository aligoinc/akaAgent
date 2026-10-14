import { CAMPAIGN_FORM_AI_MAX_PROMPT, type CampaignFormAiResult } from './campaignFormAi'

export const CAMPAIGN_LIMITS_AI_CODE = 'app_campaign_action_limits'
export const CAMPAIGN_LIMITS_AI_IPC = { generate: 'campaign-limits-ai:generate', cancel: 'campaign-limits-ai:cancel' } as const
export const LIMITS_AI_MESSAGES = {
  unclear: 'Chưa hiểu yêu cầu của bạn. Vui lòng mô tả rõ hơn giới hạn muốn đặt.',
  unsupported: 'Giới hạn bạn yêu cầu chưa được hỗ trợ trong phần này.',
  invalid: 'AI chưa xử lý được yêu cầu. Vui lòng thử lại.',
  unavailable: 'AI tạm thời chưa phản hồi. Vui lòng thử lại sau.'
} as const
export interface ActionLimitAiValues { dailyLimit: number; rateLimitCount: number; rateLimitMinutes: number }
export interface LimitsAiAction extends ActionLimitAiValues { actionCode: string; label: string; unit: string }
export interface LimitsAiFields {
  sleepBetweenActions: number
  continueWhenActionLimitReached: boolean
  postsPerTarget: number
  actions: LimitsAiAction[]
}
export interface LimitsAiContext {
  actionId: string
  dataTargetSourceMode: 'direct' | 'data_group'
  accountGroupOverrides: boolean
}
export interface LimitsAiRequest { requestId: string; description: string; context: LimitsAiContext; limits: LimitsAiFields }
export interface LimitsAiPatch {
  sleepBetweenActions?: number
  continueWhenActionLimitReached?: boolean
  postsPerTarget?: number
  actions: Array<{ actionCode: string } & Partial<ActionLimitAiValues>>
}
export type LimitsAiResult = CampaignFormAiResult<LimitsAiPatch>

export function getLimitsAiCapabilities(context: LimitsAiContext) {
  return {
    sleepBetweenActions: !['facebook_timeline_post', 'facebook_newsfeed_interaction', 'facebook_group_invite'].includes(context.actionId),
    postsPerTarget: context.actionId === 'facebook_comment_seeding'
  }
}
const numberFields = ['dailyLimit', 'rateLimitCount', 'rateLimitMinutes'] as const
const scalarFields = ['sleepBetweenActions', 'continueWhenActionLimitReached', 'postsPerTarget'] as const
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const code = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,119}$/.test(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 160
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const hasKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).sort().join(',') === [...keys].sort().join(',')

export const LIMITS_AI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status', 'reason', 'changes'],
  properties: {
    status: { type: 'string', enum: ['ok', 'unclear', 'unsupported'] }, reason: { type: 'string', maxLength: 300 },
    changes: { type: 'object', additionalProperties: false, required: [...scalarFields, 'actions'], properties: {
      sleepBetweenActions: { type: ['integer', 'null'] }, continueWhenActionLimitReached: { type: ['boolean', 'null'] },
      postsPerTarget: { type: ['integer', 'null'] },
      actions: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false,
        required: ['actionCode', ...numberFields], properties: { actionCode: { type: 'string' },
          ...Object.fromEntries(numberFields.map(key => [key, { type: ['integer', 'null'] }])) } } }
    } }
  }
}

export function validateLimitsAiRequest(input: unknown): LimitsAiRequest {
  if (!record(input) || typeof input.requestId !== 'string'
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.requestId)
    || typeof input.description !== 'string' || !input.description.trim() || input.description.length > CAMPAIGN_FORM_AI_MAX_PROMPT
    || !record(input.context) || !code(input.context.actionId)
    || !['direct', 'data_group'].includes(String(input.context.dataTargetSourceMode))
    || typeof input.context.accountGroupOverrides !== 'boolean' || !record(input.limits)
    || !integer(input.limits.sleepBetweenActions) || !integer(input.limits.postsPerTarget)
    || typeof input.limits.continueWhenActionLimitReached !== 'boolean'
    || !Array.isArray(input.limits.actions) || input.limits.actions.length > 30) throw new Error(LIMITS_AI_MESSAGES.invalid)
  const seen = new Set<string>()
  const actions = input.limits.actions.map(item => {
    if (!record(item) || !code(item.actionCode) || seen.has(item.actionCode) || !text(item.label) || !text(item.unit)
      || numberFields.some(key => !integer(item[key]))) throw new Error(LIMITS_AI_MESSAGES.invalid)
    seen.add(item.actionCode)
    return { actionCode: item.actionCode, label: item.label, unit: item.unit,
      dailyLimit: item.dailyLimit as number, rateLimitCount: item.rateLimitCount as number, rateLimitMinutes: item.rateLimitMinutes as number }
  })
  return { requestId: input.requestId, description: input.description.trim(), context: {
    actionId: input.context.actionId, dataTargetSourceMode: input.context.dataTargetSourceMode as LimitsAiContext['dataTargetSourceMode'],
    accountGroupOverrides: input.context.accountGroupOverrides
  }, limits: { sleepBetweenActions: input.limits.sleepBetweenActions, postsPerTarget: input.limits.postsPerTarget,
    continueWhenActionLimitReached: input.limits.continueWhenActionLimitReached, actions } }
}

export function parseLimitsAiResponse(content: string, request: LimitsAiRequest): LimitsAiResult {
  const error = (code: keyof typeof LIMITS_AI_MESSAGES): LimitsAiResult => ({ ok: false, code, message: LIMITS_AI_MESSAGES[code] })
  try {
    if (content.length > 16_000) return error('invalid')
    const result: unknown = JSON.parse(content)
    if (!record(result) || !hasKeys(result, ['status', 'reason', 'changes'])
      || !['ok', 'unclear', 'unsupported'].includes(String(result.status)) || typeof result.reason !== 'string' || result.reason.length > 300
      || !record(result.changes) || !hasKeys(result.changes, [...scalarFields, 'actions'])
      || !Array.isArray(result.changes.actions) || result.changes.actions.length > 30) return error('invalid')
    const patch: LimitsAiPatch = { actions: [] }
    for (const key of scalarFields) {
      const value = result.changes[key]
      if (value === null) continue
      if (key === 'continueWhenActionLimitReached' ? typeof value !== 'boolean' : !integer(value)) return error('invalid')
      Object.assign(patch, { [key]: value })
    }
    const allowed = new Set(request.limits.actions.map(action => action.actionCode)), seen = new Set<string>()
    for (const item of result.changes.actions) {
      if (!record(item) || !hasKeys(item, ['actionCode', ...numberFields]) || !code(item.actionCode) || seen.has(item.actionCode)) return error('invalid')
      if (!allowed.has(item.actionCode)) return error('unsupported')
      seen.add(item.actionCode)
      const action: LimitsAiPatch['actions'][number] = { actionCode: item.actionCode }
      for (const key of numberFields) {
        if (item[key] === null) continue
        if (!integer(item[key])) return error('invalid')
        action[key] = item[key]
      }
      if (Object.keys(action).length > 1) patch.actions.push(action)
    }
    const hasChanges = patch.actions.length > 0 || Object.keys(patch).length > 1
    if (result.status !== 'ok') {
      if (hasChanges || result.changes.actions.length) return error('invalid')
      const code = result.status as 'unclear' | 'unsupported'
      return { ok: false, code, message: LIMITS_AI_MESSAGES[code] + (result.reason.trim() ? ` ${result.reason.trim()}` : '') }
    }
    // An understood request may already match the form; an empty patch is still successful.
    const cap = getLimitsAiCapabilities(request.context)
    if (patch.sleepBetweenActions !== undefined && !cap.sleepBetweenActions || patch.postsPerTarget !== undefined && !cap.postsPerTarget) return error('unsupported')
    // Only shape, control-compatible integers and allowed fields. Existing form/save owns business rules.
    return { ok: true, patch }
  } catch { return error('invalid') }
}
