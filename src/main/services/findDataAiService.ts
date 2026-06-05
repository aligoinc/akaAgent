import { getSettingValue, listActiveSystemSettingsByKeys } from '../data/repositories/systemSettingsRepository'

const AI_REQUEST_TIMEOUT_MS = 120_000
const DEEPSEEK_PROVIDER = 'deepseek' as const

const SYSTEM_SETTING_KEYS = {
  deepseekApiKey: 'ai.deepseek.api_key',
  deepseekEndpoint: 'ai.deepseek.endpoint',
  deepseekModel: 'ai.deepseek.model',
  deepseekDefaultBody: 'ai.deepseek.default_body'
} as const

interface FindDataAiSettings {
  apiKey: string
  endpoint: string
  model: string
  defaultBody: Record<string, unknown>
}

interface FindDataMeaningAiRequest {
  contentText?: unknown
  prompt?: unknown
  entityType?: unknown
}

interface FindDataMeaningAiResponse {
  ok: boolean
  matched: boolean
  checkResult: 'matched' | 'not_matched' | 'error'
  prompt: string
  finalPrompt: string
  rawResult: string
  reason: string
  provider: typeof DEEPSEEK_PROVIDER
  model: string
  error?: string
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} phải là JSON object.`)
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof Error && err.message.includes('JSON object')) throw err
    throw new Error(`${label} không phải JSON hợp lệ.`)
  }
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value || '').trim()
}

async function loadFindDataAiSettings(): Promise<FindDataAiSettings> {
  const settings = await listActiveSystemSettingsByKeys(Object.values(SYSTEM_SETTING_KEYS))
  const apiKey = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekApiKey)
  const endpoint = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekEndpoint)
  const model = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekModel)
  const defaultBodyText = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekDefaultBody)

  if (!apiKey) throw new Error('Chưa cấu hình DeepSeek API key cho AI tìm data.')
  if (!endpoint) throw new Error('Chưa cấu hình DeepSeek endpoint cho AI tìm data.')
  if (!model) throw new Error('Chưa cấu hình DeepSeek model cho AI tìm data.')

  return {
    apiKey,
    endpoint,
    model,
    defaultBody: parseJsonObject(defaultBodyText, 'DeepSeek default body')
  }
}

function splitMeaningTraits(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
  return lines.length > 0 ? lines : [prompt]
}

function buildFindDataMeaningPrompt(request: FindDataMeaningAiRequest): { prompt: string; finalPrompt: string } {
  const prompt = toText(request.prompt)
  const contentText = toText(request.contentText)
  const entityType = toText(request.entityType) || 'content'
  const traits = splitMeaningTraits(prompt)
  const traitLines = traits.map((trait, index) => `${index + 1}. ${trait}`).join('\n')

  return {
    prompt,
    finalPrompt: [
      'Bạn là bộ lọc dữ liệu cho chiến dịch tìm data Facebook.',
      '',
      'Nhiệm vụ:',
      'Kiểm tra nội dung bên dưới có khớp ÍT NHẤT 1 tính chất trong danh sách hay không.',
      'Chỉ cần khớp một tính chất là matched=true.',
      '',
      'Danh sách tính chất cần tìm:',
      traitLines,
      '',
      `Loại dữ liệu: ${entityType}`,
      '',
      'Nội dung cần kiểm tra:',
      JSON.stringify(contentText),
      '',
      'Quy tắc:',
      '- Đánh giá theo ý nghĩa, không cần trùng chính xác từ ngữ.',
      '- Nếu nội dung mơ hồ nhưng có khả năng cao đúng nhu cầu thì matched=true.',
      '- Nếu chỉ là quảng cáo, spam, hoặc không liên quan thì matched=false.',
      '- Trả về JSON hợp lệ duy nhất, không giải thích ngoài JSON.',
      '',
      'Format JSON:',
      '{"matched":true,"matchMode":"any","matchedTraits":[{"index":1,"trait":"...","reason":"..."}],"reason":"..."}'
    ].filter(Boolean).join('\n')
  }
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const text = (fenced ? fenced[1] : trimmed).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text
}

function parseMeaningResult(rawResult: string): { matched: boolean; reason: string } {
  const parsed = JSON.parse(extractJsonText(rawResult)) as Record<string, unknown>
  const matchedValue = parsed.matched
  const matched = matchedValue === true || String(matchedValue).toLowerCase() === 'true'
  const reason = toText(parsed.reason)
  return { matched, reason }
}

export async function checkFindDataMeaningAI(request: FindDataMeaningAiRequest): Promise<FindDataMeaningAiResponse> {
  const { prompt, finalPrompt } = buildFindDataMeaningPrompt(request)
  const emptyBase = {
    matched: false,
    prompt,
    finalPrompt,
    rawResult: '',
    reason: '',
    provider: DEEPSEEK_PROVIDER,
    model: ''
  }

  try {
    if (!prompt) throw new Error('Thiếu prompt kiểm tra ý nghĩa AI.')
    const contentText = toText(request.contentText)
    if (!contentText) throw new Error('Thiếu nội dung để kiểm tra ý nghĩa AI.')

    const settings = await loadFindDataAiSettings()
    const payload = {
      ...settings.defaultBody,
      model: settings.model,
      stream: false,
      messages: [
        { role: 'user', content: finalPrompt }
      ]
    }

    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
    })

    if (!response.ok) {
      throw new Error(`DeepSeek trả về lỗi ${response.status}.`)
    }

    const data = await response.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: unknown } }>
    } | null
    const rawResult = toText(data?.choices?.[0]?.message?.content)
    if (!rawResult) throw new Error('AI không trả về nội dung.')

    const parsed = parseMeaningResult(rawResult)
    return {
      ok: true,
      matched: parsed.matched,
      checkResult: parsed.matched ? 'matched' : 'not_matched',
      prompt,
      finalPrompt,
      rawResult,
      reason: parsed.reason,
      provider: DEEPSEEK_PROVIDER,
      model: settings.model
    }
  } catch (err: any) {
    const message = err?.message ? String(err.message) : String(err)
    return {
      ok: false,
      ...emptyBase,
      checkResult: 'error',
      error: message,
      reason: message
    }
  }
}
