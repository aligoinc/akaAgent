import { ipcMain } from 'electron'
import {
  AiRewriteContentRequest,
  AiWriteMultiOtherContentRequest,
  Campaign,
  CampaignAssistantChatRequest,
  CampaignAssistantChatResponse,
  CampaignAssistantContextResult,
  CampaignAssistantContextSnapshot,
  CampaignAssistantMessage,
  CampaignDetail,
  CampaignInputData,
  IPC_EVENTS
} from '../../../shared/types'
import { requireCurrentUser } from '../../data/currentUser'
import * as accountRepo from '../../data/repositories/accountRepository'
import * as accountActionRepo from '../../data/repositories/accountActionRepository'
import * as campaignRepo from '../../data/repositories/campaignRepository'
import * as campaignActionRepo from '../../data/repositories/campaignActionRepository'
import { getSettingValue, listActiveSystemSettingsByKeys } from '../../data/repositories/systemSettingsRepository'

const AKA_AI_BASE_URL = 'https://api.akaapp.vn'
const AKA_AI_SOURCE = 'aka_agent'
const AI_REQUEST_TIMEOUT_MS = 120_000
const VIETNAM_UTC_OFFSET = '+07:00'
const MAX_CONTENT_CHARS = 8000
const DEFAULT_MAX_MESSAGES = 30
const DEFAULT_MAX_CONTEXT_ROWS = 30
const MAX_CONTEXT_ROWS_CAP = 100
const DEEPSEEK_PROVIDER = 'deepseek' as const

const SYSTEM_SETTING_KEYS = {
  deepseekApiKey: 'ai.deepseek.api_key',
  deepseekEndpoint: 'ai.deepseek.endpoint',
  deepseekModel: 'ai.deepseek.model',
  deepseekDefaultBody: 'ai.deepseek.default_body',
  facebookCampaignPrompt: 'assistant.facebook.campaign.system_prompt',
  facebookCampaignMaxMessages: 'assistant.facebook.campaign.max_messages',
  facebookCampaignMaxContextRows: 'assistant.facebook.campaign.max_context_rows'
} as const

const ALL_ASSISTANT_SETTING_KEYS = Object.values(SYSTEM_SETTING_KEYS)

interface AssistantSettings {
  apiKey: string
  endpoint: string
  model: string
  defaultBody: Record<string, unknown>
  systemPrompt: string
  maxMessages: number
  maxContextRows: number
}

interface VietnamDayRange {
  key: string
  startIso: string
  endIso: string
}

interface AkaAiResponse {
  status?: number | string
  data?: unknown
  message?: unknown
}

function requireContent(input: unknown): string {
  const content = typeof input === 'string' ? input.trim() : ''
  if (!content) {
    throw new Error('Vui lòng soạn 1 nội dung trong form nội dung.')
  }
  return content
}

function unwrapAiContent(payload: unknown): string {
  const response = payload as AkaAiResponse
  const ok = response?.status === 1 || response?.status === '1'
  if (!ok) {
    const message = typeof response?.message === 'string' && response.message.trim()
      ? response.message.trim()
      : 'AI không thể xử lý nội dung lúc này.'
    throw new Error(message)
  }
  if (typeof response.data !== 'string') {
    throw new Error('AI trả về nội dung không hợp lệ.')
  }
  return response.data
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

function parsePositiveInt(value: string, fallback: number, cap: number): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(cap, parsed)
}

async function loadAssistantSettings(): Promise<AssistantSettings> {
  const settings = await listActiveSystemSettingsByKeys(ALL_ASSISTANT_SETTING_KEYS)
  const apiKey = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekApiKey)
  const endpoint = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekEndpoint)
  const model = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekModel)
  const defaultBodyText = getSettingValue(settings, SYSTEM_SETTING_KEYS.deepseekDefaultBody)
  const systemPrompt = getSettingValue(settings, SYSTEM_SETTING_KEYS.facebookCampaignPrompt)

  if (!apiKey) throw new Error('Chưa cấu hình DeepSeek API key cho trợ lý.')
  if (!endpoint) throw new Error('Chưa cấu hình DeepSeek endpoint cho trợ lý.')
  if (!model) throw new Error('Chưa cấu hình DeepSeek model cho trợ lý.')
  if (!systemPrompt) throw new Error('Chưa cấu hình prompt trợ lý chiến dịch Facebook.')

  return {
    apiKey,
    endpoint,
    model,
    defaultBody: parseJsonObject(defaultBodyText, 'DeepSeek default body'),
    systemPrompt,
    maxMessages: parsePositiveInt(
      getSettingValue(settings, SYSTEM_SETTING_KEYS.facebookCampaignMaxMessages),
      DEFAULT_MAX_MESSAGES,
      100
    ),
    maxContextRows: parsePositiveInt(
      getSettingValue(settings, SYSTEM_SETTING_KEYS.facebookCampaignMaxContextRows),
      DEFAULT_MAX_CONTEXT_ROWS,
      MAX_CONTEXT_ROWS_CAP
    )
  }
}

async function postAiContent(path: string, body: Record<string, unknown>): Promise<string> {
  requireCurrentUser()

  const response = await fetch(`${AKA_AI_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`AI trả về lỗi ${response.status}.`)
  }

  return unwrapAiContent(await response.json())
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getVietnamDateParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day)
  }
}

function getVietnamDayRange(date = new Date()): VietnamDayRange {
  const parts = getVietnamDateParts(date)
  const key = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
  const start = new Date(`${key}T00:00:00${VIETNAM_UTC_OFFSET}`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { key, startIso: start.toISOString(), endIso: end.toISOString() }
}

function parseVietnamLogDateKey(value: string): string | null {
  const match = value.match(/(\d{1,2}):(\d{2}):(\d{2})\s*,?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!match) return null
  return `${match[6]}-${pad2(Number(match[5]))}-${pad2(Number(match[4]))}`
}

function parseTodayCampaignProgress(logText: string, dayKey: string, limit: number): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = []
  const lines = (logText || '').split('\n')

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    const match = line.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (!match) continue
    if (parseVietnamLogDateKey(match[1]) !== dayKey) continue
    entries.push({
      order: index + 1,
      time: match[1],
      message: sanitizeTextForAssistant(match[2] || '')
    })
  }

  return entries.slice(-limit)
}

const SECRET_FIELD_PATTERN = /(password|cookie|token|secret|keyapi|api[_-]?key|auth(code)?|login(data)?|imei|session)/i
const INTERNAL_ID_FIELD_PATTERN = /(^id$|Id$|Ids$|ID$|IDs$|_id$|_ids$|uid$|uids$)/

function sanitizeTextForAssistant(value: string, maxLength = 1600): string {
  const trimmed = String(value || '')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [masked]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[masked_api_key]')
    .replace(/EAAG[A-Za-z0-9_-]{12,}/g, '[masked_token]')
    .replace(/(c_user|xs|fr|datr|sb)=[^;\s]+/gi, '$1=[masked]')
    .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g, '[masked_file]')
    .replace(/\/Users\/[^\s"']+/g, '[masked_file]')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[masked_file]')
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed
}

function sanitizeForAssistant(value: unknown, key = '', depth = 0): unknown {
  if (SECRET_FIELD_PATTERN.test(key)) return '[masked]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeTextForAssistant(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= 4) return '[truncated]'
    return value.slice(0, 20).map(item => sanitizeForAssistant(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth >= 4) return '[truncated]'
    const output: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
      output[entryKey] = sanitizeForAssistant(entryValue, entryKey, depth + 1)
    })
    return output
  }
  return String(value)
}

function stripInternalIdsForAssistant(value: unknown, key = '', depth = 0): unknown {
  if (INTERNAL_ID_FIELD_PATTERN.test(key)) return '[hidden]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= 4) return '[truncated]'
    return value.map(item => stripInternalIdsForAssistant(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth >= 4) return '[truncated]'
    const output: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
      output[entryKey] = stripInternalIdsForAssistant(entryValue, entryKey, depth + 1)
    })
    return output
  }
  return String(value)
}

function mapInputDataForContext(row: CampaignInputData): Record<string, unknown> {
  return sanitizeForAssistant({
    id: row.id,
    name: row.name || '',
    uid: row.uid || '',
    phone: row.phone || '',
    email: row.email || '',
    status: row.status,
    note: row.note || '',
    schedule: row.schedule || null,
    dateAction: row.dateAction || null,
    createdAt: row.createdAt || null
  }) as Record<string, unknown>
}

function mapCampaignDetailForContext(row: CampaignDetail): Record<string, unknown> {
  return sanitizeForAssistant({
    id: row.id,
    inputDataId: row.inputDataId ?? null,
    actionCode: row.actionCode || null,
    actionName: row.actionName,
    status: row.status,
    errorCode: row.errorCode || null,
    log: row.log || '',
    data: row.data || null,
    postUrl: row.postUrl || '',
    createdAt: row.createdAt || null
  }) as Record<string, unknown>
}

function buildRuleDiagnosis(campaign: Campaign, account: Awaited<ReturnType<typeof accountRepo.getAccount>>, action: Awaited<ReturnType<typeof campaignActionRepo.getCampaignAction>>, inputCounts: Record<string, number>, todayDetails: CampaignDetail[]): Record<string, unknown> {
  const errorsToday = todayDetails.filter(detail => detail.status === 'lỗi')
  const failuresToday = todayDetails.filter(detail => detail.status === 'thất bại')
  const pendingInputCount = inputCounts['chờ xử lý'] || 0
  const runningInputCount = inputCounts['đang chạy'] || 0

  if (!account) {
    return { reason: 'account_missing', severity: 'blocking', message: 'Không tìm thấy tài khoản chạy chiến dịch.' }
  }
  if (account.isActive === false) {
    return { reason: 'account_inactive', severity: 'blocking', message: 'Tài khoản đang tắt hoạt động.' }
  }
  if (account.loginStatus !== 'đã đăng nhập') {
    return { reason: 'account_login_required', severity: 'blocking', message: `Tài khoản đang ở trạng thái ${account.loginStatus}.` }
  }
  if (campaign.status === 'tạm dừng') {
    return { reason: 'campaign_paused', severity: 'info', message: 'Chiến dịch đang tạm dừng.' }
  }
  if (campaign.status === 'hoàn thành') {
    return { reason: 'campaign_completed', severity: 'info', message: 'Chiến dịch đã hoàn thành.' }
  }
  if (!action?.workflowId) {
    return { reason: 'workflow_missing', severity: 'blocking', message: 'Loại chiến dịch chưa có workflow chạy.' }
  }
  if (String(campaign.note || '').includes('Đang chờ data từ chiến dịch tìm data')) {
    return { reason: 'waiting_find_data_source', severity: 'info', message: campaign.note }
  }
  if (pendingInputCount === 0 && runningInputCount === 0 && campaign.actionId !== 'facebook_timeline_post') {
    return { reason: 'no_pending_data', severity: 'info', message: 'Không còn data chờ xử lý trong chiến dịch.' }
  }
  if (errorsToday.length >= 3) {
    return { reason: 'many_errors_today', severity: 'warning', message: `Có ${errorsToday.length} lỗi trong ngày hôm nay.` }
  }
  if (failuresToday.length >= 3) {
    return { reason: 'many_failures_today', severity: 'warning', message: `Có ${failuresToday.length} hành động thất bại trong ngày hôm nay.` }
  }

  return { reason: 'unknown', severity: 'info', message: 'Chưa xác định được nguyên nhân rõ ràng từ kiểm tra tự động.' }
}

async function buildCampaignAssistantContext(campaignId: number, settings: AssistantSettings): Promise<CampaignAssistantContextSnapshot> {
  requireCurrentUser()
  const campaign = await campaignRepo.getCampaign(campaignId)
  if (!campaign) throw new Error('Không tìm thấy chiến dịch.')

  const dayRange = getVietnamDayRange()
  const [account, action, inputCounts, todayInputData, todayActionDetails] = await Promise.all([
    accountRepo.getAccount(campaign.accountId),
    campaignActionRepo.getCampaignAction(campaign.actionId),
    campaignRepo.getCampaignInputDataStatusCounts(campaign.id),
    campaignRepo.listCampaignInputDataByDateActionRange(campaign.id, dayRange.startIso, dayRange.endIso, settings.maxContextRows),
    campaignRepo.listCampaignDetailsByCreatedAtRange(campaign.id, dayRange.startIso, dayRange.endIso, settings.maxContextRows)
  ])
  const actionOverview = account
    ? await accountActionRepo.listAccountActionOverview(account.id).catch(() => [])
    : []
  const todayProgress = parseTodayCampaignProgress(campaign.log, dayRange.key, settings.maxContextRows)
  const totalInputData = Object.values(inputCounts).reduce((sum, count) => sum + count, 0)

  return {
    snapshotAt: new Date().toISOString(),
    campaign: sanitizeForAssistant({
      id: campaign.id,
      name: campaign.name,
      actionId: campaign.actionId,
      actionName: campaign.actionName || action?.name || campaign.actionId,
      status: campaign.status,
      schedule: campaign.schedule || null,
      originalSchedule: campaign.originalSchedule || null,
      scheduleType: campaign.scheduleType || 'daily',
      dailyStopTime: campaign.dailyStopTime || null,
      note: campaign.note || '',
      content: campaign.content || '',
      extraSettings: campaign.extraSettings || {},
      imageCount: Array.isArray(campaign.images) ? campaign.images.length : 0,
      lastRunAt: campaign.lastRunAt || null,
      completedAt: campaign.completedAt || null
    }) as Record<string, unknown>,
    account: account ? sanitizeForAssistant({
      id: account.id,
      name: account.name,
      flatformType: account.flatformType,
      loginStatus: account.loginStatus,
      status: account.status,
      isActive: account.isActive,
      rateLimitMinutes: account.rateLimitMinutes ?? null
    }) as Record<string, unknown> : null,
    action: action ? sanitizeForAssistant({
      id: action.id,
      name: action.name,
      flatformType: action.flatformType,
      workflowId: action.workflowId ?? null,
      limitCheckActionCodes: action.limitCheckActionCodes || []
    }) as Record<string, unknown> : null,
    inputSummary: {
      total: totalInputData,
      byStatus: inputCounts
    },
    actionState: {
      actions: actionOverview.map(item => sanitizeForAssistant({
        code: item.action.code,
        name: item.action.name,
        isActive: item.action.isActive,
        countActionInDay: item.status.countActionInDay,
        isDisable: item.status.isDisable,
        dateEnable: item.status.dateEnable || null,
        windowActionCount: item.windowActionCount,
        windowMinutes: item.windowMinutes
      }))
    },
    ruleDiagnosis: buildRuleDiagnosis(campaign, account, action, inputCounts, todayActionDetails),
    todayProgress,
    todayInputData: todayInputData.map(mapInputDataForContext),
    todayActionDetails: todayActionDetails.map(mapCampaignDetailForContext),
    limits: {
      maxContextRows: settings.maxContextRows,
      maxMessages: settings.maxMessages
    }
  }
}

function sanitizeMessages(input: unknown, maxMessages: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(input)) throw new Error('messages không hợp lệ.')
  const cleaned: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const message of input) {
    const item = message as CampaignAssistantMessage
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) {
      throw new Error('messages không hợp lệ.')
    }
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content) throw new Error('messages không hợp lệ.')
    if (content.length > MAX_CONTENT_CHARS) throw new Error('Nội dung câu hỏi quá dài.')
    cleaned.push({ role: item.role, content })
  }
  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== 'user') {
    throw new Error('Tin nhắn cuối cùng phải là câu hỏi của người dùng.')
  }
  return cleaned.length > maxMessages ? cleaned.slice(cleaned.length - maxMessages) : cleaned
}

function buildAssistantSystemPrompt(systemPrompt: string, contextSnapshot: CampaignAssistantContextSnapshot): string {
  const safeContext = stripInternalIdsForAssistant(contextSnapshot)
  return [
    systemPrompt,
    '',
    `THÔNG TIN NỘI BỘ (chỉ dùng để hiểu tình huống, không nhắc tên phần này trong câu trả lời; thời điểm ${contextSnapshot.snapshotAt}):`,
    JSON.stringify(safeContext, null, 2)
  ].join('\n')
}

async function callDeepSeek(settings: AssistantSettings, contextSnapshot: CampaignAssistantContextSnapshot, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<CampaignAssistantChatResponse> {
  const payload = {
    ...settings.defaultBody,
    model: settings.model,
    stream: false,
    messages: [
      { role: 'system', content: buildAssistantSystemPrompt(settings.systemPrompt, contextSnapshot) },
      ...messages
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
    usage?: unknown
  } | null
  const content = typeof data?.choices?.[0]?.message?.content === 'string'
    ? data.choices[0].message.content.trim()
    : ''
  if (!content) throw new Error('DeepSeek không trả về nội dung.')

  return {
    content,
    provider: DEEPSEEK_PROVIDER,
    model: settings.model,
    generatedAt: new Date().toISOString(),
    usage: data?.usage || null
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle(IPC_EVENTS.AI_REWRITE_CONTENT, async (_, request: AiRewriteContentRequest) => {
    const content = requireContent(request?.content)
    return postAiContent('/api/AI/rewriteContent', {
      content,
      questionContentName: 'rewrite_content',
      source: AKA_AI_SOURCE
    })
  })

  ipcMain.handle(IPC_EVENTS.AI_WRITE_MULTI_OTHER_CONTENT, async (_, request: AiWriteMultiOtherContentRequest) => {
    const content = requireContent(request?.content)
    const countContent = Math.floor(Number(request?.countContent))
    if (!Number.isFinite(countContent) || countContent < 2) {
      throw new Error('Số lượng nội dung khác nhau phải từ 2 nội dung trở lên.')
    }

    return postAiContent('/api/AI/writeMultiOtherContent', {
      countContent,
      content,
      questionContentName: 'write_multi_other_content',
      source: AKA_AI_SOURCE
    })
  })

  ipcMain.handle(IPC_EVENTS.AI_CAMPAIGN_ASSISTANT_CONTEXT, async (_, campaignId: number): Promise<CampaignAssistantContextResult> => {
    const normalizedCampaignId = Number(campaignId)
    if (!Number.isFinite(normalizedCampaignId) || normalizedCampaignId <= 0) {
      throw new Error('campaignId không hợp lệ.')
    }
    const settings = await loadAssistantSettings()
    return {
      contextSnapshot: await buildCampaignAssistantContext(normalizedCampaignId, settings)
    }
  })

  ipcMain.handle(IPC_EVENTS.AI_CAMPAIGN_ASSISTANT_CHAT, async (_, request: CampaignAssistantChatRequest): Promise<CampaignAssistantChatResponse> => {
    const campaignId = Number(request?.campaignId)
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      throw new Error('campaignId không hợp lệ.')
    }
    const campaign = await campaignRepo.getCampaign(campaignId)
    if (!campaign) throw new Error('Không tìm thấy chiến dịch.')

    const contextSnapshot = request?.contextSnapshot
    const contextCampaignId = Number(contextSnapshot?.campaign?.id)
    if (!contextSnapshot || contextCampaignId !== campaignId) {
      throw new Error('Dữ liệu chiến dịch của trợ lý không khớp. Vui lòng tạo mới hội thoại.')
    }

    const settings = await loadAssistantSettings()
    const messages = sanitizeMessages(request?.messages, settings.maxMessages)
    return callDeepSeek(settings, contextSnapshot, messages)
  })
}
