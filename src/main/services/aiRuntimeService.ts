import { AiCallMetadata, AiCallResult, AiUsingConfig } from '../../shared/aiTypes'
import * as aiRepo from '../data/repositories/aiRepository'

const DEFAULT_AI_TIMEOUT_MS = 120_000

type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string }
type AiChatMessage = { role: 'system' | 'user' | 'assistant'; content: unknown }

interface PreparedRequest {
  systemPrompt: string
  userPrompt: string
  body: Record<string, unknown>
  messages: AiMessage[]
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function renderTemplate(template: string, payload: Record<string, unknown>): string {
  let output = String(template || '')
  for (const [key, value] of Object.entries(payload)) {
    const text = toText(value)
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    output = output
      .replace(new RegExp(`\\[${escapedKey}\\]`, 'gi'), text)
      .replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'gi'), text)
  }
  return output
}

function normalizeMessages(value: unknown): AiMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      const raw = toRecord(item)
      const role = String(raw.role || '').trim()
      const content = toText(raw.content).trim()
      if (!content || !['system', 'user', 'assistant'].includes(role)) return null
      return { role: role as AiMessage['role'], content }
    })
    .filter((item): item is AiMessage => item !== null)
}

function getPathValue(value: unknown, path: string | null | undefined): unknown {
  const cleanPath = String(path || '').trim()
  if (!cleanPath) return undefined
  return cleanPath.split('.').reduce<unknown>((current, part) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(part)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (typeof current === 'object') return (current as Record<string, unknown>)[part]
    return undefined
  }, value)
}

function extractResponseText(raw: unknown, responsePath?: string | null): string {
  const pathValue = getPathValue(raw, responsePath)
  if (typeof pathValue === 'string') return pathValue.trim()
  if (pathValue !== undefined && pathValue !== null && typeof pathValue !== 'object') return String(pathValue).trim()

  if (typeof raw === 'string') return raw.trim()
  const data = toRecord(raw)

  if (typeof data.output_text === 'string') return data.output_text.trim()
  const dataValue = data.data ?? data.Data ?? data.message ?? data.Message
  if (typeof dataValue === 'string') return dataValue.trim()

  const choices = Array.isArray(data.choices) ? data.choices : []
  const firstChoice = toRecord(choices[0])
  const choiceMessage = toRecord(firstChoice.message)
  const choiceContent = choiceMessage.content ?? firstChoice.text
  if (typeof choiceContent === 'string') return choiceContent.trim()

  const output = Array.isArray(data.output) ? data.output : []
  const parts: string[] = []
  for (const item of output) {
    const itemRecord = toRecord(item)
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : []
    for (const contentItem of content) {
      const contentRecord = toRecord(contentItem)
      const type = String(contentRecord.type || '')
      const text = contentRecord.text
      if ((type === 'output_text' || type === 'text') && typeof text === 'string') {
        parts.push(text)
      }
    }
  }
  return parts.join('').trim()
}

function extractUsage(raw: unknown): { usage?: unknown; tokenInput?: number | null; tokenOutput?: number | null } {
  const data = toRecord(raw)
  const usage = toRecord(data.usage)
  const tokenInput = Number(usage.input_tokens ?? usage.prompt_tokens)
  const tokenOutput = Number(usage.output_tokens ?? usage.completion_tokens)
  return {
    usage: data.usage,
    tokenInput: Number.isFinite(tokenInput) ? tokenInput : null,
    tokenOutput: Number.isFinite(tokenOutput) ? tokenOutput : null
  }
}

const SECRET_FIELD_PATTERN = /(password|cookie|token|secret|keyapi|api[_-]?key|authorization|auth(code)?|session)/i
const MAX_IMAGE_DATA_URLS = 3

function sanitizeText(value: string, maxLength = 6000): string {
  const masked = String(value || '')
    .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g, '[masked_file]')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [masked]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[masked_api_key]')
    .replace(/\b[A-Za-z0-9+/]{160,}={0,2}\b/g, '[masked_long_token]')
  return masked.length > maxLength ? `${masked.slice(0, maxLength)}...` : masked
}

function getImageDataUrls(payload: Record<string, unknown>): string[] {
  const values: unknown[] = []
  if (typeof payload.imageDataUrl === 'string') values.push(payload.imageDataUrl)
  if (Array.isArray(payload.imageDataUrls)) values.push(...payload.imageDataUrls)

  return values
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(value => /^data:image\/[a-z0-9.+-]+;base64,/i.test(value))
    .slice(0, MAX_IMAGE_DATA_URLS)
}

function buildOpenAiInputContent(text: string, payload: Record<string, unknown>): Record<string, unknown>[] {
  return [
    { type: 'input_text', text },
    ...getImageDataUrls(payload).map(imageUrl => ({ type: 'input_image', image_url: imageUrl }))
  ]
}

function buildChatUserContent(text: string, payload: Record<string, unknown>): unknown {
  const imageUrls = getImageDataUrls(payload)
  if (imageUrls.length === 0) return text
  return [
    { type: 'text', text },
    ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
  ]
}

function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (SECRET_FIELD_PATTERN.test(key)) return '[masked]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= 5) return '[truncated]'
    return value.slice(0, 50).map(item => sanitize(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth >= 5) return '[truncated]'
    const output: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      output[entryKey] = sanitize(entryValue, entryKey, depth + 1)
    }
    return output
  }
  return String(value)
}

function preparePrompts(config: AiUsingConfig, payload: Record<string, unknown>): { systemPrompt: string; userPrompt: string; messages: AiMessage[] } {
  const promptOverride = toText(payload.promptOverride || payload.questionOverride).trim()
  const systemPromptOverride = toText(payload.systemPromptOverride).trim()
  const userTemplate = promptOverride || config.prompt.promptUser || toText(payload.question)
  const systemTemplate = systemPromptOverride || config.prompt.promptSystem || ''
  const systemPrompt = renderTemplate(systemTemplate, payload).trim()
  const userPrompt = renderTemplate(userTemplate, payload).trim()
  const messages = normalizeMessages(payload.messages)
  return { systemPrompt, userPrompt, messages }
}

function buildOpenAiResponsesBody(config: AiUsingConfig, prepared: PreparedRequest, payload: Record<string, unknown>): Record<string, unknown> {
  const bodyOverrides = toRecord(payload.bodyOverrides)
  const body: Record<string, unknown> = {
    ...config.model.defaultBody,
    ...config.using.requestOptions,
    ...bodyOverrides,
    model: config.model.model
  }

  if (prepared.systemPrompt) body.instructions = prepared.systemPrompt

  const nonSystemMessages = prepared.messages.filter(message => message.role !== 'system')
  if (nonSystemMessages.length > 0) {
    let lastUserIndex = -1
    for (let i = 0; i < nonSystemMessages.length; i += 1) {
      if (nonSystemMessages[i].role !== 'assistant') lastUserIndex = i
    }
    body.input = nonSystemMessages.map((message, index) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.role !== 'assistant' && index === lastUserIndex
        ? buildOpenAiInputContent(message.content, payload)
        : [{ type: 'input_text', text: message.content }]
    }))
  } else {
    body.input = [{
      role: 'user',
      content: buildOpenAiInputContent(prepared.userPrompt, payload)
    }]
  }

  return body
}

function buildChatCompletionsBody(config: AiUsingConfig, prepared: PreparedRequest, payload: Record<string, unknown>): Record<string, unknown> {
  const bodyOverrides = toRecord(payload.bodyOverrides)
  const messages: AiChatMessage[] = []
  const explicitSystemMessages = prepared.messages.filter(message => message.role === 'system')
  if (prepared.systemPrompt) messages.push({ role: 'system', content: prepared.systemPrompt })
  messages.push(...explicitSystemMessages)
  const nonSystemMessages = prepared.messages.filter(message => message.role !== 'system')
  if (nonSystemMessages.length > 0) {
    let lastUserIndex = -1
    for (let i = 0; i < nonSystemMessages.length; i += 1) {
      if (nonSystemMessages[i].role !== 'assistant') lastUserIndex = i
    }
    messages.push(...nonSystemMessages.map((message, index) => ({
      role: message.role,
      content: message.role !== 'assistant' && index === lastUserIndex
        ? buildChatUserContent(message.content, payload)
        : message.content
    })))
  } else {
    messages.push({ role: 'user', content: buildChatUserContent(prepared.userPrompt, payload) })
  }

  return {
    ...config.model.defaultBody,
    ...config.using.requestOptions,
    ...bodyOverrides,
    model: config.model.model,
    stream: false,
    messages
  }
}

function buildRequest(config: AiUsingConfig, payload: Record<string, unknown>): PreparedRequest {
  const prompts = preparePrompts(config, payload)
  const provider = config.model.provider.toLowerCase()
  const endpoint = config.model.endpoint.toLowerCase()
  const preparedBase = {
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    messages: prompts.messages
  }

  const temporaryPrepared = { ...preparedBase, body: {} }
  const body = provider === 'openai' && endpoint.includes('/responses')
    ? buildOpenAiResponsesBody(config, temporaryPrepared, payload)
    : buildChatCompletionsBody(config, temporaryPrepared, payload)

  return { ...preparedBase, body }
}

async function createAiLogSafe(input: Parameters<typeof aiRepo.createAiLog>[0]): Promise<number | null> {
  try {
    return await aiRepo.createAiLog(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      console.warn('[aiRuntime] failed to create AI log:', message)
    } catch {}
    return null
  }
}

export async function callAiUsing(
  code: string,
  payload: Record<string, unknown> = {},
  metadata: AiCallMetadata = {}
): Promise<AiCallResult> {
  const usingCode = String(code || '').trim()
  const generatedAt = new Date().toISOString()
  if (!usingCode) {
    return {
      ok: false,
      content: '',
      usingCode,
      provider: '',
      model: '',
      generatedAt,
      error: 'Thiếu mã cấu hình AI.'
    }
  }

  let config: AiUsingConfig | null = null
  try {
    config = await aiRepo.getAiUsingConfigByCode(usingCode, metadata)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      content: '',
      usingCode,
      provider: '',
      model: '',
      generatedAt,
      error
    }
  }
  if (!config) {
    return {
      ok: false,
      content: '',
      usingCode,
      provider: '',
      model: '',
      generatedAt,
      error: `Không tìm thấy cấu hình AI: ${usingCode}`
    }
  }

  const provider = config.model.provider
  const model = config.model.model
  const endpoint = config.model.endpoint
  const startedAt = Date.now()
  const request = buildRequest(config, payload)
  const timeoutMs = Math.max(1000, Number(config.using.timeoutMs || DEFAULT_AI_TIMEOUT_MS))

  if (!config.model.apiKey) {
    const error = `Chưa cấu hình API key cho AI model: ${config.model.code}`
    const durationMs = Date.now() - startedAt
    const logId = await createAiLogSafe({
      ...metadata,
      usingId: config.using.id,
      modelId: config.model.id,
      promptId: config.prompt.id,
      organizationId: metadata.organizationId ?? config.using.organizationId ?? config.model.organizationId ?? null,
      usingCode,
      provider,
      model,
      endpoint,
      status: 'error',
      renderedSystemPrompt: request.systemPrompt,
      renderedUserPrompt: request.userPrompt,
      sanitizedRequest: sanitize({ endpoint, provider, model, body: request.body }) as Record<string, unknown>,
      errorMessage: error,
      durationMs
    })
    return {
      ok: false,
      content: '',
      usingCode,
      provider,
      model,
      generatedAt,
      renderedSystemPrompt: request.systemPrompt,
      renderedUserPrompt: request.userPrompt,
      durationMs,
      logId,
      error
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${config.model.apiKey}`
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const durationMs = Date.now() - startedAt
    const responseText = await response.text()
    let rawResponse: unknown = responseText
    try {
      rawResponse = responseText ? JSON.parse(responseText) : {}
    } catch {
      rawResponse = responseText
    }

    if (!response.ok) {
      const message = typeof rawResponse === 'string'
        ? rawResponse
        : toText(toRecord(rawResponse).error || toRecord(rawResponse).message || responseText)
      const error = `AI trả về lỗi ${response.status}${message ? `: ${sanitizeText(message, 800)}` : ''}`
      const usage = extractUsage(rawResponse)
      const logId = await createAiLogSafe({
        ...metadata,
        usingId: config.using.id,
        modelId: config.model.id,
        promptId: config.prompt.id,
        organizationId: metadata.organizationId ?? config.using.organizationId ?? config.model.organizationId ?? null,
        usingCode,
        provider,
        model,
        endpoint,
        status: 'error',
        httpStatus: response.status,
        renderedSystemPrompt: request.systemPrompt,
        renderedUserPrompt: request.userPrompt,
        sanitizedRequest: sanitize({ endpoint, provider, model, body: request.body }) as Record<string, unknown>,
        sanitizedResponse: sanitize(rawResponse) as Record<string, unknown>,
        errorMessage: error,
        tokenInput: usage.tokenInput,
        tokenOutput: usage.tokenOutput,
        durationMs
      })
      return {
        ok: false,
        content: '',
        usingCode,
        provider,
        model,
        generatedAt,
        renderedSystemPrompt: request.systemPrompt,
        renderedUserPrompt: request.userPrompt,
        usage: usage.usage,
        tokenInput: usage.tokenInput,
        tokenOutput: usage.tokenOutput,
        durationMs,
        logId,
        rawResponse,
        error
      }
    }

    const content = extractResponseText(rawResponse, config.using.responsePath)
    if (!content) {
      throw new Error('AI không trả về nội dung.')
    }

    const usage = extractUsage(rawResponse)
    const logId = await createAiLogSafe({
      ...metadata,
      usingId: config.using.id,
      modelId: config.model.id,
      promptId: config.prompt.id,
      organizationId: metadata.organizationId ?? config.using.organizationId ?? config.model.organizationId ?? null,
      usingCode,
      provider,
      model,
      endpoint,
      status: 'success',
      httpStatus: response.status,
      renderedSystemPrompt: request.systemPrompt,
      renderedUserPrompt: request.userPrompt,
      sanitizedRequest: sanitize({ endpoint, provider, model, body: request.body }) as Record<string, unknown>,
      sanitizedResponse: sanitize(rawResponse) as Record<string, unknown>,
      responseText: content,
      tokenInput: usage.tokenInput,
      tokenOutput: usage.tokenOutput,
      durationMs
    })

    return {
      ok: true,
      content,
      usingCode,
      provider,
      model,
      generatedAt,
      renderedSystemPrompt: request.systemPrompt,
      renderedUserPrompt: request.userPrompt,
      usage: usage.usage,
      tokenInput: usage.tokenInput,
      tokenOutput: usage.tokenOutput,
      durationMs,
      logId,
      rawResponse
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const error = err instanceof Error ? err.message : String(err)
    const logId = await createAiLogSafe({
      ...metadata,
      usingId: config.using.id,
      modelId: config.model.id,
      promptId: config.prompt.id,
      organizationId: metadata.organizationId ?? config.using.organizationId ?? config.model.organizationId ?? null,
      usingCode,
      provider,
      model,
      endpoint,
      status: 'error',
      renderedSystemPrompt: request.systemPrompt,
      renderedUserPrompt: request.userPrompt,
      sanitizedRequest: sanitize({ endpoint, provider, model, body: request.body }) as Record<string, unknown>,
      errorMessage: error,
      durationMs
    })
    return {
      ok: false,
      content: '',
      usingCode,
      provider,
      model,
      generatedAt,
      renderedSystemPrompt: request.systemPrompt,
      renderedUserPrompt: request.userPrompt,
      durationMs,
      logId,
      error
    }
  }
}
