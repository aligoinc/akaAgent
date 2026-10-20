import { CAMPAIGN_FORM_AI_MAX_PROMPT, type CampaignFormAiResult } from './campaignFormAi'

export const CAMPAIGN_CONTENT_AI_CODE = 'app_campaign_content'
export const CAMPAIGN_CONTENT_AI_IPC = { generate: 'campaign-content-ai:generate', cancel: 'campaign-content-ai:cancel' } as const
export const CONTENT_AI_MESSAGES = {
  unclear: 'Vui lòng mô tả rõ hơn nội dung muốn viết hoặc sửa.',
  unsupported: 'AI trong phần này chỉ viết/sửa chữ và thêm biến thể.',
  invalid: 'Chưa thể điền nội dung này. Vui lòng thử yêu cầu ngắn hơn.',
  unavailable: 'AI tạm thời chưa phản hồi. Vui lòng thử lại sau.'
} as const
export interface ContentAiItem { content: string; emailSubject: string | null }
export interface ContentAiContext { actionId: string; mode: 'basic' | 'advanced'; format: 'plain' | 'html' }
export interface ContentAiRequest { requestId: string; description: string; context: ContentAiContext; items: ContentAiItem[] }
export interface ContentAiPatch {
  edits: Array<{ index: number; content: string | null; emailSubject: string | null }>
  additions: Array<{ sourceIndex: number; content: string; emailSubject: string | null }>
}
export type ContentAiResult = CampaignFormAiResult<ContentAiPatch>
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).sort().join() === [...expected].sort().join()
const text = (v: unknown, max = 16_000): v is string => typeof v === 'string' && v.length <= max
const index = (v: unknown, length: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < length

// Provider-compatible structural schema; bounds and field capabilities are checked locally.
export const CONTENT_AI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status', 'reason', 'changes'],
  properties: {
    status: { type: 'string', enum: ['ok', 'unclear', 'unsupported'] }, reason: { type: 'string' },
    changes: { type: 'object', additionalProperties: false, required: ['edits', 'additions'], properties: {
      edits: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['index', 'content', 'emailSubject'], properties: {
          index: { type: 'integer' }, content: { type: ['string', 'null'] }, emailSubject: { type: ['string', 'null'] }
        } } },
      additions: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['sourceIndex', 'content', 'emailSubject'], properties: {
          sourceIndex: { type: 'integer' }, content: { type: 'string' }, emailSubject: { type: ['string', 'null'] }
        } } }
    } }
  }
}

export function validateContentAiRequest(input: unknown): ContentAiRequest {
  if (!record(input) || typeof input.requestId !== 'string'
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.requestId)
    || !text(input.description, CAMPAIGN_FORM_AI_MAX_PROMPT) || !input.description.trim()
    || !record(input.context) || typeof input.context.actionId !== 'string' || !/^[a-z][a-z0-9_]{0,119}$/.test(input.context.actionId)
    || !['basic', 'advanced'].includes(String(input.context.mode)) || !['plain', 'html'].includes(String(input.context.format))
    || !Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw new Error(CONTENT_AI_MESSAGES.invalid)
  const email = input.context.actionId.startsWith('email_')
  const items = input.items.map((item, i): ContentAiItem => {
    if (!record(item) || !text(item.content) || !(item.emailSubject === null || email && text(item.emailSubject, 500))
      || input.context && (input.context as ContentAiContext).mode === 'basic' && i > 0 && item.emailSubject !== null) throw new Error(CONTENT_AI_MESSAGES.invalid)
    return { content: item.content, emailSubject: item.emailSubject as string | null }
  })
  if (JSON.stringify(items).length > 60_000) throw new Error(CONTENT_AI_MESSAGES.invalid)
  return { requestId: input.requestId, description: input.description.trim(), context: {
    actionId: input.context.actionId, mode: input.context.mode as ContentAiContext['mode'], format: input.context.format as ContentAiContext['format']
  }, items }
}

export function parseContentAiResponse(content: string, request: ContentAiRequest): ContentAiResult {
  const error = (code: keyof typeof CONTENT_AI_MESSAGES): ContentAiResult => ({ ok: false, code, message: CONTENT_AI_MESSAGES[code] })
  try {
    if (content.length > 100_000) return error('invalid')
    const result: unknown = JSON.parse(content)
    if (!record(result) || !keys(result, ['status', 'reason', 'changes']) || !text(result.reason, 300)
      || !['ok', 'unclear', 'unsupported'].includes(String(result.status)) || !record(result.changes)
      || !keys(result.changes, ['edits', 'additions']) || !Array.isArray(result.changes.edits) || !Array.isArray(result.changes.additions)
      || result.changes.edits.length > request.items.length || result.changes.additions.length > 20
      || request.items.length + result.changes.additions.length > 100) return error('invalid')
    const patch: ContentAiPatch = { edits: [], additions: [] }, seen = new Set<number>()
    for (const item of result.changes.edits) {
      if (!record(item) || !keys(item, ['index', 'content', 'emailSubject']) || !index(item.index, request.items.length)
        || seen.has(item.index) || !(item.content === null || text(item.content))
        || !(item.emailSubject === null || text(item.emailSubject, 500))) return error('invalid')
      if (item.emailSubject !== null && request.items[item.index].emailSubject === null) return error('unsupported')
      seen.add(item.index)
      patch.edits.push({ index: item.index, content: item.content as string | null, emailSubject: item.emailSubject as string | null })
    }
    for (const item of result.changes.additions) {
      if (!record(item) || !keys(item, ['sourceIndex', 'content', 'emailSubject']) || !index(item.sourceIndex, request.items.length)
        || !text(item.content) || !item.content.trim() || !(item.emailSubject === null || text(item.emailSubject, 500))) return error('invalid')
      if (item.emailSubject !== null && (request.context.mode === 'basic' || request.items[item.sourceIndex].emailSubject === null)) return error('unsupported')
      patch.additions.push({ sourceIndex: item.sourceIndex, content: item.content, emailSubject: item.emailSubject as string | null })
    }
    if (result.status !== 'ok') {
      if (patch.edits.length || patch.additions.length) return error('invalid')
      const code = result.status as 'unclear' | 'unsupported'
      return { ok: false, code, message: CONTENT_AI_MESSAGES[code] + (result.reason.trim() ? ` ${result.reason.trim()}` : '') }
    }
    return { ok: true, patch }
  } catch { return error('invalid') }
}

/** Edits never replace objects wholesale. New variants inherit media/options from their source. */
export function applyContentAiItems<T extends { content: string; emailSubject?: string | null }>(
  items: T[], patch: ContentAiPatch, clone: (source: T) => T, sanitize: (content: string) => string = content => content
): T[] {
  const updated = items.map((item, i) => {
    const edit = patch.edits.find(entry => entry.index === i)
    return !edit ? item : { ...item,
      ...(edit.content === null ? {} : { content: sanitize(edit.content) }),
      ...(edit.emailSubject === null ? {} : { emailSubject: edit.emailSubject })
    }
  })
  return [...updated, ...patch.additions.map(item => ({ ...clone(items[item.sourceIndex]), content: sanitize(item.content),
    ...(item.emailSubject === null ? {} : { emailSubject: item.emailSubject }) }))]
}
