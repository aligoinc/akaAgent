export const FACEBOOK_RANDOM_RUN_IPC = 'facebook-random-run:request'
export type RandomRunUnit = 'data' | 'run' | 'minute'
export interface FacebookRandomRule { campaignActionId: string; quantity: number; unit: RandomRunUnit }
export interface FacebookRandomConfig { version: 1 | 2; revision: number; rules: FacebookRandomRule[]; mode?: 'manual' | 'ai' }
export const isAiRandomConfig = (config: FacebookRandomConfig | null | undefined): boolean => config?.version === 2 && config.mode === 'ai'
export interface FacebookRandomAiAction {
  campaignActionId: string; name: string; unit: RandomRunUnit; waitingCount: number; pausedCount: number
  limits?: unknown
}
export interface FacebookRandomAiContext {
  date: string; actions: FacebookRandomAiAction[]; accountLimits?: unknown
}
export interface FacebookRandomAiState {
  status: 'generating' | 'retry_wait' | 'failed' | 'ready'
  requestId: string; attempts: number; generatedAt?: string; nextAttemptAt?: string | null
  error?: string | null; rules?: FacebookRandomRule[]; context: FacebookRandomAiContext
}
export interface FacebookRandomAllocation {
  cursor: number; cycle: number; coverageRound: number; servedCount?: number
  availableActionIds?: string[]; pendingActionIds?: string[]
}
export type RandomTurnStatus = 'planned' | 'running' | 'completed' | 'stopped' | 'skipped' | 'expired'
export interface FacebookRandomTurn extends FacebookRandomRule {
  id: string; order: number; round: number; ruleIndex: number; revision: number
  campaignId: number; campaignName: string; processed: number; elapsedSeconds: number
  status: RandomTurnStatus; reason?: string | null; claimToken?: string | null
  startedAt?: string | null; endedAt?: string | null
  aiPlanId?: string; coverageRound?: number; planCycle?: number
}
export interface FacebookRandomSettings { enabled: boolean; config: FacebookRandomConfig | null }
export interface FacebookRandomDay {
  date: string; accountId: number; status: 'open' | 'closed'; turns: FacebookRandomTurn[]
  total: number; page: number
  ai?: FacebookRandomAiState | null; allocation?: FacebookRandomAllocation | null
  aiMode?: boolean; canRetryAi?: boolean; activeTurn?: FacebookRandomTurn | null
}
export interface FacebookRandomPlan extends FacebookRandomSettings {
  date: string; turns: FacebookRandomTurn[]
}
export interface FacebookRandomReadQuery { date: string; campaignId?: number | null; page?: number }
export const RANDOM_TURN_LABELS: Record<RandomTurnStatus, string> = {
  planned: 'Chờ chạy', running: 'Đang chạy', completed: 'Hoàn tất đợt',
  stopped: 'Dừng sớm', skipped: 'Bỏ qua', expired: 'Không chạy — hết ngày'
}
export function randomRuleUnit(actionId: string): RandomRunUnit {
  return actionId === 'facebook_timeline_post' ? 'run' : actionId === 'facebook_newsfeed_interaction' ? 'minute' : 'data'
}
export function validateFacebookRandomConfig(value: unknown, actionIds: readonly string[]): FacebookRandomConfig {
  const config = value as FacebookRandomConfig | null
  if (!config || typeof config !== 'object' || Array.isArray(config) || ![1, 2].includes(config.version)
    || (config.version === 2 && !['manual', 'ai'].includes(config.mode || ''))
    || !Number.isSafeInteger(config.revision) || config.revision < 0
    || !Array.isArray(config.rules) || config.rules.length < (isAiRandomConfig(config) ? 0 : 1) || config.rules.length > 100) {
    throw new Error('Cấu hình chạy ngẫu nhiên không hợp lệ; chế độ thủ công cần từ 1 đến 100 quy tắc.')
  }
  // AI mode keeps the manual draft intact, including actions no longer in the catalog.
  const ids = isAiRandomConfig(config) ? config.rules.map(rule => rule?.campaignActionId) : actionIds
  const rules = validateRandomRules(config.rules, ids, isAiRandomConfig(config))
  return { version: config.version, revision: config.revision, rules, ...(config.version === 2 ? { mode: config.mode } : {}) }
}
export function validateRandomRules(value: unknown, actionIds: readonly string[], allowEmpty = false): FacebookRandomRule[] {
  if (!Array.isArray(value) || value.length < (allowEmpty ? 0 : 1) || value.length > 100) throw new Error('Kế hoạch phải có từ 1 đến 100 dòng.')
  const allowed = new Set(actionIds)
  return value.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || typeof rule.campaignActionId !== 'string' || !allowed.has(rule.campaignActionId)
      || !rule.campaignActionId.startsWith('facebook_')) throw new Error(`Dòng ${index + 1}: loại chiến dịch không được phép sử dụng.`)
    if (rule.unit !== randomRuleUnit(rule.campaignActionId) || !Number.isSafeInteger(rule.quantity)
      || rule.quantity <= 0 || rule.quantity > 2147483647 || (rule.unit === 'run' && rule.quantity !== 1)) {
      throw new Error(`Dòng ${index + 1}: chỉ tiêu phải là số nguyên dương, đúng đơn vị; đăng trang cá nhân là 1 lượt.`)
    }
    return { campaignActionId: rule.campaignActionId, quantity: rule.quantity, unit: rule.unit }
  })
}
export function parseFacebookRandomAiRules(content: string, context: FacebookRandomAiContext): FacebookRandomRule[] {
  if (content.length > 64_000) throw new Error('Kế hoạch AI quá dài.')
  const value = JSON.parse(content)
  if (!value || Object.keys(value).length !== 1 || !Array.isArray(value.rules)) throw new Error('Kế hoạch AI không đúng định dạng.')
  const rules = validateRandomRules(value.rules, context.actions.map(a => a.campaignActionId))
  const seen = new Map<string, number>(), reserve = new Set(context.actions.filter(a => a.waitingCount === 0).map(a => a.campaignActionId))
  let inReserve = false
  for (const rule of rules) {
    seen.set(rule.campaignActionId, (seen.get(rule.campaignActionId) || 0) + 1)
    if (reserve.has(rule.campaignActionId)) inReserve = true
    else if (inReserve) throw new Error('Các dòng dự phòng phải ở cuối kế hoạch.')
  }
  for (const action of context.actions) {
    if (!seen.has(action.campaignActionId) || (reserve.has(action.campaignActionId) && seen.get(action.campaignActionId) !== 1)) {
      throw new Error('Kế hoạch AI thiếu hành động hoặc lặp dòng dự phòng.')
    }
  }
  return rules
}
/** Uniform selection, preserving the configured order and duplicate rule rows. */
export function chooseRandomRound<T extends { id: number; actionId: string }>(
  rules: FacebookRandomRule[], candidates: readonly T[], random: () => number = Math.random
): Array<{ ruleIndex: number; campaignId: number }> {
  return rules.flatMap((rule, ruleIndex) => {
    const matches = candidates.filter(c => c.actionId === rule.campaignActionId)
    if (!matches.length) return []
    return [{ ruleIndex, campaignId: matches[Math.min(matches.length - 1, Math.floor(random() * matches.length))].id }]
  })
}
export function vietnamRunDate(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}
export function randomRemaining(turn: Pick<FacebookRandomTurn, 'unit' | 'quantity' | 'processed'>): number {
  return turn.unit === 'data' ? Math.max(0, turn.quantity - turn.processed) : Math.max(0, 1 - turn.processed)
}
