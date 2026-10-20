import { CAMPAIGN_FORM_AI_MAX_PROMPT, type CampaignFormAiResult } from './campaignFormAi'
import {
  ruleDefinition, supportsSendExclusion, validateExclusionGroup,
  type ExclusionRule, type SendExclusionPage
} from './campaignSendExclusion'

export const CAMPAIGN_EXCLUSION_AI_IPC = {
  generate: 'campaign-exclusion-ai:generate', cancel: 'campaign-exclusion-ai:cancel'
} as const
export const EXCLUSION_AI_MESSAGES = {
  unclear: 'Vui lòng mô tả rõ hơn các điều kiện muốn loại trừ.',
  unsupported: 'AI trong phần này chỉ soạn nhóm điều kiện loại trừ cho tài khoản đang chọn.',
  invalid: 'Chưa thể điền nhóm điều kiện này. Vui lòng kiểm tra yêu cầu và thử lại.',
  unavailable: 'AI tạm thời chưa phản hồi. Vui lòng thử lại sau.'
} as const
export interface ExclusionAiContext { actionId: string; accountId: number; enableMessage: boolean }
export interface ExclusionAiRequest { requestId: string; description: string; context: ExclusionAiContext }
export interface ExclusionAiPatch { name: string; matchMode: 'and' | 'or'; rules: ExclusionRule[] }
export type ExclusionAiResult = CampaignFormAiResult<ExclusionAiPatch>
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join() === [...expected].sort().join()
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const primitive = (value: unknown) => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
  || typeof value === 'string' && value.length <= 1000

export const EXCLUSION_AI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status', 'reason', 'changes'],
  properties: {
    status: { type: 'string', enum: ['ok', 'unclear', 'unsupported'] },
    reason: { type: 'string' },
    changes: {
      type: 'object', additionalProperties: false, required: ['name', 'matchMode', 'rules'],
      properties: {
        name: { type: 'string' }, matchMode: { type: 'string', enum: ['and', 'or'] },
        rules: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['fieldId', 'operatorId', 'values'],
          properties: {
            fieldId: { type: 'integer' }, operatorId: { type: 'integer' },
            values: { type: 'array', items: { type: ['string', 'number', 'boolean'] } }
          }
        } }
      }
    }
  }
}

export function validateExclusionAiRequest(input: unknown): ExclusionAiRequest {
  if (!record(input) || !keys(input, ['requestId', 'description', 'context'])
    || typeof input.requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.requestId)
    || typeof input.description !== 'string' || !input.description.trim() || input.description.length > CAMPAIGN_FORM_AI_MAX_PROMPT
    || !record(input.context) || !keys(input.context, ['actionId', 'accountId', 'enableMessage'])
    || typeof input.context.actionId !== 'string' || !positiveId(input.context.accountId)
    || typeof input.context.enableMessage !== 'boolean'
    || !supportsSendExclusion(input.context.actionId, input.context)) throw new Error(EXCLUSION_AI_MESSAGES.invalid)
  return { requestId: input.requestId, description: input.description.trim(),
    context: { actionId: input.context.actionId, accountId: input.context.accountId, enableMessage: input.context.enableMessage } }
}

/** Only catalog metadata and option labels go to AI; no recipients, credentials, or other groups. */
export function exclusionAiCatalog(page: SendExclusionPage) {
  const fields = page.catalog.fields.filter(field => field.isActive).flatMap(field => {
    const operators = page.catalog.fieldOperators.filter(pair => pair.fieldId === field.id).flatMap(pair => {
      try {
        const { operator, mapping } = ruleDefinition(page.catalog, { fieldId: field.id, operatorId: pair.operatorId,
          value: null, isEnabled: true, sortOrder: 0 })
        return [{ id: operator.id, name: operator.name, evaluator: operator.evaluatorKey,
          valueType: mapping.valueType, minValues: mapping.minValues, maxValues: mapping.maxValues,
          validation: mapping.validationConfig }]
      } catch { return [] }
    })
    if (!operators.length) return []
    return [{ id: field.id, name: field.name, code: field.code, dataType: field.dataType, operators,
      optionsSource: field.optionsSource,
      options: page.options.filter(option => option.fieldId === field.id && option.isActive)
        .map(option => ({ label: option.label, value: option.value })) }]
  })
  if (!fields.length || fields.length > 100 || JSON.stringify(fields).length > 200_000) throw new Error(EXCLUSION_AI_MESSAGES.invalid)
  return fields
}

/** Both Main and renderer validate the same draft against their account's catalog snapshot. */
export function validateExclusionAiPatch(input: unknown, page: SendExclusionPage): ExclusionAiPatch {
  if (!record(input) || !keys(input, ['name', 'matchMode', 'rules'])
    || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200
    || !['and', 'or'].includes(String(input.matchMode)) || !Array.isArray(input.rules)
    || !input.rules.length || input.rules.length > 100) throw new Error(EXCLUSION_AI_MESSAGES.invalid)
  const rules = input.rules.map((entry): ExclusionRule => {
    if (!record(entry) || !keys(entry, ['fieldId', 'operatorId', 'value', 'isEnabled', 'sortOrder'])
      || !positiveId(entry.fieldId) || !positiveId(entry.operatorId) || entry.isEnabled !== true
      || !Number.isSafeInteger(entry.sortOrder)) throw new Error(EXCLUSION_AI_MESSAGES.invalid)
    const rule = { fieldId: entry.fieldId, operatorId: entry.operatorId, value: entry.value,
      isEnabled: true, sortOrder: entry.sortOrder as number }
    const { field, mapping } = ruleDefinition(page.catalog, rule)
    const operands = Array.isArray(rule.value) ? rule.value : [rule.value]
    if (operands.length > 100 || !operands.every(primitive) || new Set(operands).size !== operands.length
      || (mapping.maxValues === 1 ? Array.isArray(rule.value) : !Array.isArray(rule.value))
      || field.optionsSource !== 'none' && operands.some(value => !page.options.some(
        option => option.isActive && option.fieldId === field.id && option.value === value))) throw new Error(EXCLUSION_AI_MESSAGES.invalid)
    return { ...rule, sortOrder: field.sortOrder }
  })
  const patch = { name: input.name.trim(), matchMode: input.matchMode as 'and' | 'or', rules }
  validateExclusionGroup(page.catalog, patch)
  return patch
}

export function parseExclusionAiResponse(content: string, page: SendExclusionPage): ExclusionAiResult {
  const invalid = (): ExclusionAiResult => ({ ok: false, code: 'invalid', message: EXCLUSION_AI_MESSAGES.invalid })
  try {
    if (content.length > 32_000) return invalid()
    const result: unknown = JSON.parse(content)
    if (!record(result) || !keys(result, ['status', 'reason', 'changes'])
      || !['ok', 'unclear', 'unsupported'].includes(String(result.status))
      || typeof result.reason !== 'string' || result.reason.length > 300
      || !record(result.changes) || !keys(result.changes, ['name', 'matchMode', 'rules'])
      || typeof result.changes.name !== 'string' || result.changes.name.length > 200
      || !['and', 'or'].includes(String(result.changes.matchMode))
      || !Array.isArray(result.changes.rules) || result.changes.rules.length > 100) return invalid()
    if (result.status !== 'ok') {
      if (result.changes.name || result.changes.rules.length) return invalid()
      const code = result.status as 'unclear' | 'unsupported'
      return { ok: false, code, message: EXCLUSION_AI_MESSAGES[code] + (result.reason.trim() ? ` ${result.reason.trim()}` : '') }
    }
    const rules = result.changes.rules.map(entry => {
      if (!record(entry) || !keys(entry, ['fieldId', 'operatorId', 'values'])
        || !positiveId(entry.fieldId) || !positiveId(entry.operatorId) || !Array.isArray(entry.values)
        || !entry.values.length || entry.values.length > 100 || !entry.values.every(primitive)) throw new Error('invalid')
      const { field, mapping } = ruleDefinition(page.catalog, {
        fieldId: entry.fieldId, operatorId: entry.operatorId, value: null, isEnabled: true, sortOrder: 0
      })
      if (entry.values.length < mapping.minValues || entry.values.length > mapping.maxValues) throw new Error('invalid')
      return { fieldId: field.id, operatorId: entry.operatorId,
        value: mapping.maxValues === 1 ? entry.values[0] : entry.values, isEnabled: true, sortOrder: field.sortOrder }
    })
    return { ok: true, patch: validateExclusionAiPatch({ ...result.changes, rules }, page) }
  } catch { return invalid() }
}
