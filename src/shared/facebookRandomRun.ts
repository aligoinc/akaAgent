export const FACEBOOK_RANDOM_RUN_IPC = 'facebook-random-run:request'
export type RandomRunUnit = 'data' | 'run' | 'minute'
export interface FacebookRandomRule { campaignActionId: string; quantity: number; unit: RandomRunUnit }
export interface FacebookRandomConfig { version: 1; revision: number; rules: FacebookRandomRule[] }
export type RandomTurnStatus = 'planned' | 'running' | 'completed' | 'stopped' | 'skipped' | 'expired'
export interface FacebookRandomTurn extends FacebookRandomRule {
  id: string; order: number; round: number; ruleIndex: number; revision: number
  campaignId: number; campaignName: string; processed: number; elapsedSeconds: number
  status: RandomTurnStatus; reason?: string | null; claimToken?: string | null
  startedAt?: string | null; endedAt?: string | null
}
export interface FacebookRandomSettings { enabled: boolean; config: FacebookRandomConfig | null }
export interface FacebookRandomDay {
  date: string; accountId: number; status: 'open' | 'closed'; turns: FacebookRandomTurn[]
  total: number; page: number
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
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.version !== 1
    || !Number.isSafeInteger(config.revision) || config.revision < 0
    || !Array.isArray(config.rules) || config.rules.length < 1 || config.rules.length > 100) {
    throw new Error('Cấu hình phải có version = 1, revision và từ 1 đến 100 quy tắc.')
  }
  const allowed = new Set(actionIds)
  const rules = config.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || !allowed.has(rule.campaignActionId)
      || !rule.campaignActionId.startsWith('facebook_')) throw new Error(`Dòng ${index + 1}: loại chiến dịch không được phép sử dụng.`)
    if (rule.unit !== randomRuleUnit(rule.campaignActionId) || !Number.isSafeInteger(rule.quantity)
      || rule.quantity <= 0 || rule.quantity > 2147483647 || (rule.unit === 'run' && rule.quantity !== 1)) {
      throw new Error(`Dòng ${index + 1}: chỉ tiêu phải là số nguyên dương, đúng đơn vị; đăng trang cá nhân là 1 lượt.`)
    }
    return { campaignActionId: rule.campaignActionId, quantity: rule.quantity, unit: rule.unit }
  })
  return { version: 1, revision: config.revision, rules }
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
