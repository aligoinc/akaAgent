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
  IPC_EVENTS
} from '../../../shared/types'
import { requireCurrentUser } from '../../data/currentUser'
import * as accountRepo from '../../data/repositories/accountRepository'
import * as accountActionRepo from '../../data/repositories/accountActionRepository'
import * as campaignRepo from '../../data/repositories/campaignRepository'
import * as campaignActionRepo from '../../data/repositories/campaignActionRepository'
import * as errorPolicyRepo from '../../data/repositories/errorPolicyRepository'
import * as runV2Repo from '../../data/repositories/runV2Repository'
import { getSettingValue, listActiveSystemSettingsByKeys } from '../../data/repositories/systemSettingsRepository'
import { callAiUsing } from '../../services/aiRuntimeService'

const VIETNAM_UTC_OFFSET = '+07:00'
const MAX_CONTENT_CHARS = 8000
const DEFAULT_MAX_MESSAGES = 30
const DEFAULT_MAX_CONTEXT_ROWS = 30
const MAX_CONTEXT_ROWS_CAP = 100
const CAMPAIGN_ASSISTANT_AI_CODE = 'app_campaign_assistant_chat'

const SYSTEM_SETTING_KEYS = {
  facebookCampaignMaxMessages: 'assistant.facebook.campaign.max_messages',
  facebookCampaignMaxContextRows: 'assistant.facebook.campaign.max_context_rows'
} as const

const ALL_ASSISTANT_SETTING_KEYS = Object.values(SYSTEM_SETTING_KEYS)

interface AssistantContextSettings {
  maxMessages: number
  maxContextRows: number
}

interface VietnamDayRange {
  key: string
  startIso: string
  endIso: string
}

function requireContent(input: unknown): string {
  const content = typeof input === 'string' ? input.trim() : ''
  if (!content) {
    throw new Error('Vui lòng soạn 1 nội dung trong form nội dung.')
  }
  return content
}

function parsePositiveInt(value: string, fallback: number, cap: number): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(cap, parsed)
}

async function loadAssistantContextSettings(): Promise<AssistantContextSettings> {
  const settings = await listActiveSystemSettingsByKeys(ALL_ASSISTANT_SETTING_KEYS)

  return {
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

function parseCampaignProgressLogs(logText: string, dayKey: string, limit: number): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = []
  const lines = (logText || '').split('\n')

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    const match = line.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (!match) continue
    const dateKey = parseVietnamLogDateKey(match[1])
    entries.push({
      order: index + 1,
      time: match[1],
      dateKey,
      message: sanitizeTextForAssistant(match[2] || '')
    })
  }

  const todayEntries = entries.filter(entry => entry.dateKey === dayKey)
  return (todayEntries.length > 0 ? todayEntries : entries).slice(-limit)
}

const SECRET_FIELD_PATTERN = /(password|cookie|token|secret|keyapi|api[_-]?key|auth(code)?|login[_-]?data|imei|session)/i
const INTERNAL_ID_FIELD_PATTERN = /(^id$|Id$|Ids$|ID$|IDs$|_id$|_ids$|uid$|uids$)/

function sanitizeTextForAssistant(value: string, maxLength = 1600): string {
  const trimmed = String(value || '')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [masked]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[masked_api_key]')
    .replace(/EAAG[A-Za-z0-9_-]{12,}/g, '[masked_token]')
    .replace(/(c_user|xs|fr|datr|sb)=[^;\s]+/gi, '$1=[masked]')
    .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g, '[masked_file]')
    .replace(/\b[A-Za-z0-9+/]{160,}={0,2}\b/g, '[masked_base64]')
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

function mapRecordForContext(value: unknown): Record<string, unknown> {
  return sanitizeForAssistant(value) as Record<string, unknown>
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
  const useTestWorkflow = requireCurrentUser().useTestWorkflow === true
  const workflowId = useTestWorkflow ? action?.testWorkflowId : action?.workflowId
  if (!workflowId) {
    return {
      reason: useTestWorkflow ? 'test_workflow_missing' : 'workflow_missing',
      severity: 'blocking',
      message: useTestWorkflow
        ? 'Loại chiến dịch chưa có workflow test.'
        : 'Loại chiến dịch chưa có workflow chạy.'
    }
  }
  if (String(campaign.note || '').includes('Đang chờ data từ chiến dịch tìm data')) {
    return { reason: 'waiting_find_data_source', severity: 'info', message: campaign.note }
  }
  if (
    pendingInputCount === 0 &&
    runningInputCount === 0 &&
    !['facebook_timeline_post', 'facebook_newsfeed_interaction'].includes(campaign.actionId)
  ) {
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

async function buildCampaignAssistantContext(campaignId: number, settings: AssistantContextSettings): Promise<CampaignAssistantContextSnapshot> {
  requireCurrentUser()
  const campaign = await campaignRepo.getCampaign(campaignId)
  if (!campaign) throw new Error('Không tìm thấy chiến dịch.')

  const dayRange = getVietnamDayRange()
  const [account, action, inputCounts, inputData, runResults, todayActionDetails] = await Promise.all([
    accountRepo.getAccount(campaign.accountId),
    campaignActionRepo.getCampaignAction(campaign.actionId),
    campaignRepo.getCampaignInputDataStatusCounts(campaign.id),
    campaignRepo.listCampaignInputData(campaign.id),
    campaignRepo.listAllCampaignDetailsByCampaign(campaign.id),
    campaignRepo.listCampaignDetailsByCreatedAtRange(campaign.id, dayRange.startIso, dayRange.endIso, settings.maxContextRows)
  ])
  const actionOverview = account
    ? await accountActionRepo.listAccountActionOverview(account.id).catch(() => [])
    : []
  const progressLogs = parseCampaignProgressLogs(campaign.log, dayRange.key, settings.maxContextRows)
  const totalInputData = Object.values(inputCounts).reduce((sum, count) => sum + count, 0)
  let campaignErrorDetails = await campaignRepo.listCampaignErrorDetailsByCreatedAtRange(
    campaign.id,
    dayRange.startIso,
    dayRange.endIso,
    settings.maxContextRows
  )
  if (campaignErrorDetails.length === 0) {
    campaignErrorDetails = await campaignRepo.listLatestCampaignErrorDetails(campaign.id, settings.maxContextRows)
  }
  const relevantActionCodes = Array.from(new Set([
    ...(action?.limitCheckActionCodes || []),
    ...runResults.map(detail => detail.actionCode || '').filter(Boolean),
    ...actionOverview.map(item => item.action.code).filter(Boolean)
  ]))
  const [accountErrorStates, runTraces] = await Promise.all([
    account
      ? errorPolicyRepo.listAccountErrorStatesWithPolicies(account.id, relevantActionCodes, {
        startIso: dayRange.startIso,
        endIso: dayRange.endIso,
        limit: settings.maxContextRows
      }).catch(() => [])
      : [],
    runV2Repo.listCampaignBugRunTraces(
      campaign.id,
      dayRange.startIso,
      dayRange.endIso,
      settings.maxContextRows
    ).catch(() => [])
  ])

  return {
    snapshotAt: new Date().toISOString(),
    campaign: mapRecordForContext(campaign),
    campaignSummary: mapRecordForContext({
      name: campaign.name,
      actionName: campaign.actionName || action?.name || campaign.actionId,
      accountName: campaign.accountName || account?.name || '',
      status: campaign.status,
      schedule: campaign.schedule || null,
      originalSchedule: campaign.originalSchedule || null,
      scheduleType: campaign.scheduleType || 'daily',
      dailyStopTime: campaign.dailyStopTime || null,
      note: campaign.note || '',
      lastRunAt: campaign.lastRunAt || null,
      completedAt: campaign.completedAt || null
    }),
    account: account ? mapRecordForContext(account) : null,
    action: action ? mapRecordForContext(action) : null,
    inputSummary: {
      total: totalInputData,
      byStatus: inputCounts
    },
    inputData: inputData.map(mapRecordForContext),
    runResults: runResults.map(mapRecordForContext),
    progressLogs,
    bugLogs: {
      campaignErrorDetails: campaignErrorDetails.map(mapRecordForContext),
      accountErrorStates: accountErrorStates.map(mapRecordForContext),
      runTraces: runTraces.map(mapRecordForContext)
    },
    accountActionLimits: actionOverview.map(mapRecordForContext),
    ruleDiagnosis: buildRuleDiagnosis(campaign, account, action, inputCounts, todayActionDetails),
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

function buildAssistantContextMessage(contextSnapshot: CampaignAssistantContextSnapshot): string {
  const safeContext = stripInternalIdsForAssistant(contextSnapshot)
  return [
    `THÔNG TIN NỘI BỘ (chỉ dùng để hiểu tình huống, không nhắc tên phần này trong câu trả lời; thời điểm ${contextSnapshot.snapshotAt}):`,
    JSON.stringify(safeContext, null, 2)
  ].join('\n')
}

export function registerAiHandlers(): void {
  ipcMain.handle(IPC_EVENTS.AI_REWRITE_CONTENT, async (_, request: AiRewriteContentRequest) => {
    const content = requireContent(request?.content)
    requireCurrentUser()
    const result = await callAiUsing('app_ai_rewrite_content', { content })
    if (!result.ok) throw new Error(result.error || 'AI không thể xử lý nội dung lúc này.')
    return result.content
  })

  ipcMain.handle(IPC_EVENTS.AI_WRITE_MULTI_OTHER_CONTENT, async (_, request: AiWriteMultiOtherContentRequest) => {
    const content = requireContent(request?.content)
    const countContent = Math.floor(Number(request?.countContent))
    if (!Number.isFinite(countContent) || countContent < 2) {
      throw new Error('Số lượng nội dung khác nhau phải từ 2 nội dung trở lên.')
    }

    requireCurrentUser()
    const result = await callAiUsing('app_ai_write_multi_other_content', {
      content,
      count: countContent,
      countContent
    })
    if (!result.ok) throw new Error(result.error || 'AI không thể xử lý nội dung lúc này.')
    return result.content
  })

  ipcMain.handle(IPC_EVENTS.AI_CAMPAIGN_ASSISTANT_CONTEXT, async (_, campaignId: number): Promise<CampaignAssistantContextResult> => {
    const normalizedCampaignId = Number(campaignId)
    if (!Number.isFinite(normalizedCampaignId) || normalizedCampaignId <= 0) {
      throw new Error('campaignId không hợp lệ.')
    }
    const settings = await loadAssistantContextSettings()
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

    const settings = await loadAssistantContextSettings()
    const messages = sanitizeMessages(request?.messages, settings.maxMessages)
    const result = await callAiUsing(CAMPAIGN_ASSISTANT_AI_CODE, {
      messages: [
        { role: 'system', content: buildAssistantContextMessage(contextSnapshot) },
        ...messages
      ]
    }, {
      organizationId: campaign.organizationId ?? null,
      campaignId: campaign.id,
      accountId: campaign.accountId
    })
    if (!result.ok) throw new Error(result.error || 'AI không thể xử lý nội dung lúc này.')
    return {
      content: result.content,
      provider: result.provider,
      model: result.model,
      generatedAt: result.generatedAt,
      usage: result.usage ?? null
    }
  })
}
