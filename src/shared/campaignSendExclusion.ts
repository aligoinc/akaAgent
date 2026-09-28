/** Shared with Chat runtime-protocol. Catalog codes are data, never executable code. */
export interface FilterField {
  id: number; code: string; name: string; dataType: string; sourceKey: string
  sourceConfig: { path: string[] }; optionsSource: string; optionsConfig: Record<string, unknown>
  isActive: boolean; sortOrder: number
}
export interface FilterOperator { id: number; code: string; name: string; evaluatorKey: string; isActive: boolean; sortOrder: number }
export interface FilterFieldOperator {
  fieldId: number; operatorId: number; valueType: string; minValues: number; maxValues: number
  validationConfig: { min?: number; max?: number; integer?: boolean }
}
export interface FilterOption { fieldId: number; code: string; label: string; value: unknown; isActive: boolean; sortOrder: number }
export interface ExclusionCatalog { fields: FilterField[]; operators: FilterOperator[]; fieldOperators: FilterFieldOperator[]; options: FilterOption[] }
export interface ExclusionRule { fieldId: number; operatorId: number; value: unknown; isEnabled: boolean; sortOrder: number }
export interface SendExclusionGroup {
  id: number; requestId?: string; accountId: number; name: string; matchMode: 'and' | 'or'; revision: number; rules: ExclusionRule[]
}
export interface SaveSendExclusionGroup extends Omit<SendExclusionGroup, 'id'> { id?: number }
export interface SendExclusionSelection { groupId: number | null; blocklistIds: number[] }
export type SendExclusionsByAccount = Record<string, SendExclusionSelection>
export interface SendExclusionSnapshot { catalog: ExclusionCatalog; group: SendExclusionGroup | null; blocklistUids: string[] }
export interface SendExclusionPage { catalog: ExclusionCatalog; groups: SendExclusionGroup[]; options: FilterOption[]; blocklists: Array<{id: number; name: string; count: number}> }
export interface ExclusionFacts { akabiz_contact: { ids: string[] } | null; campaign_delivery: { daysSince: number } | null }
export const SEND_EXCLUSION_IPC = { page: 'send-exclusions:page', save: 'send-exclusions:save' } as const
export const SEND_EXCLUSION_ACTIONS = new Set(['zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'])
export function supportsSendExclusion(actionId: string, extra: {enableMessage?: unknown} = {}): boolean {
  return SEND_EXCLUSION_ACTIONS.has(actionId) && (['zalo_message_friend', 'zalo_message_birthday'].includes(actionId) || extra.enableMessage === true)
}
export function exclusionSelection(extra: {zaloSendExclusionsByAccountId?: unknown}, accountId: number | string): SendExclusionSelection | null {
  const map = extra.zaloSendExclusionsByAccountId
  if (map === undefined) return null
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('Cấu hình loại trừ không hợp lệ.')
  const entry = (map as SendExclusionsByAccount)[String(accountId)]
  if (!entry) throw new Error('Chưa cấu hình loại trừ cho tài khoản thực hiện.')
  if (!(entry.groupId === null || Number.isSafeInteger(entry.groupId) && entry.groupId > 0) ||
    !Array.isArray(entry.blocklistIds) || entry.blocklistIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Cấu hình loại trừ không hợp lệ.')
  return entry
}
export function hasSendExclusions(extra: {zaloSendExclusionsByAccountId?: unknown}, accountId: number | string): boolean {
  const selection = exclusionSelection(extra, accountId)
  return !!selection && (!!selection.groupId || selection.blocklistIds.length > 0)
}
export const FILTER_SOURCES = new Set(['zalo_profile', 'zalo_friendship', 'zalo_labels', 'akabiz_contact', 'campaign_delivery'])
export const FILTER_EVALUATORS = new Set(['equals', 'not_equals', 'contains_any', 'contains_none', 'text_contains', 'text_not_contains', 'text_starts_with', 'text_not_starts_with', 'lt', 'lte', 'gt', 'gte'])
const TYPES = new Set(['text', 'number', 'boolean', 'enum', 'set', 'date'])
const OPTION_SOURCES = new Set(['none', 'static', 'friend_status', 'zalo_labels', 'akabiz_tags'])
const values = (value: unknown): unknown[] => Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
const safePath = (path: unknown): path is string[] => Array.isArray(path) && path.length > 0 && path.length <= 8 && path.every(key => typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !['constructor', 'prototype', '__proto__'].includes(key))
export function ruleDefinition(catalog: ExclusionCatalog, rule: ExclusionRule) {
  const field = catalog.fields.find(item => item.id === rule.fieldId && item.isActive)
  const operator = catalog.operators.find(item => item.id === rule.operatorId && item.isActive)
  const mapping = catalog.fieldOperators.find(item => item.fieldId === rule.fieldId && item.operatorId === rule.operatorId)
  if (!field || !operator || !mapping || !FILTER_SOURCES.has(field.sourceKey) || !TYPES.has(field.dataType) ||
    !OPTION_SOURCES.has(field.optionsSource) || !FILTER_EVALUATORS.has(operator.evaluatorKey) || !safePath(field.sourceConfig?.path) || !['text', 'number', 'boolean', 'enum', 'date'].includes(mapping.valueType) || !Number.isInteger(mapping.minValues) || !Number.isInteger(mapping.maxValues) || mapping.minValues < 1 || mapping.maxValues < mapping.minValues || field.optionsSource === 'none' && mapping.maxValues !== 1) {
    throw new Error('Định nghĩa điều kiện chưa được hỗ trợ hoặc đã ngừng sử dụng.')
  }
  return {field, operator, mapping}
}
export function validateExclusionGroup(catalog: ExclusionCatalog, group: Pick<SendExclusionGroup, 'rules' | 'name' | 'matchMode'>): void {
  if (!group.name.trim() || group.name.length > 200 || !['and', 'or'].includes(group.matchMode)) throw new Error('Tên hoặc cách kết hợp nhóm không hợp lệ.')
  if (!group.rules.some(rule => rule.isEnabled)) throw new Error('Bật ít nhất một điều kiện.')
  if (new Set(group.rules.map(rule => rule.fieldId)).size !== group.rules.length) throw new Error('Mỗi trường chỉ được dùng một lần.')
  for (const rule of group.rules.filter(rule => rule.isEnabled)) {
    const {field, mapping} = ruleDefinition(catalog, rule)
    const operands = values(rule.value)
    if (operands.length < mapping.minValues || operands.length > mapping.maxValues) throw new Error(`Chọn giá trị hợp lệ cho ${field.name}.`)
    for (const operand of operands) {
      const config = mapping.validationConfig || {}
      if (mapping.valueType === 'number' && (typeof operand !== 'number' || !Number.isFinite(operand) ||
        config.integer && !Number.isInteger(operand) || config.min !== undefined && operand < config.min || config.max !== undefined && operand > config.max)) throw new Error(`Giá trị ${field.name} không hợp lệ.`)
      if (mapping.valueType === 'text' && (typeof operand !== 'string' || !operand.trim())) throw new Error(`Nhập ${field.name}.`)
      if ((mapping.valueType === 'date' || field.dataType === 'date') && validDate(operand) === null) throw new Error(`Ngày ${field.name} không hợp lệ.`)
      if (mapping.valueType === 'boolean' && typeof operand !== 'boolean') throw new Error(`Giá trị ${field.name} không hợp lệ.`)
      if (field.optionsSource === 'static' && !catalog.options.some(option => option.fieldId === field.id && option.isActive && option.value === operand)) throw new Error(`Giá trị ${field.name} đã ngừng sử dụng.`)
    }
  }
}
export type FilterTruth = boolean | null
function readPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined, source)
}
function validDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(value)) return null
  const time = Date.parse(value)
  const day = value.slice(0,10), dayTime = Date.parse(day)
  return Number.isFinite(time) && Number.isFinite(dayTime) && new Date(dayTime).toISOString().slice(0,10) === day ? time : null
}
export function evaluateFilter(key: string, actual: unknown, operand: unknown, dataType?: string): FilterTruth {
  if (Array.isArray(operand) && operand.length === 1) operand = operand[0]
  if (dataType === 'date') { actual = validDate(actual); operand = validDate(operand); if (operand === null) return null }
  if (dataType === 'number' && typeof actual !== 'number' || dataType === 'boolean' && typeof actual !== 'boolean' || dataType === 'text' && typeof actual !== 'string') return null
  if (actual === null || actual === undefined) return null
  const selected = values(operand)
  switch (key) {
    case 'equals': case 'not_equals': {
      if (typeof actual === 'object' || selected.length !== 1 || typeof actual !== typeof selected[0]) return null
      const equal = actual === selected[0]
      return key === 'equals' ? equal : !equal
    }
    case 'contains_any': case 'contains_none': {
      if (!Array.isArray(actual) || actual.some(item => !['string', 'number', 'boolean'].includes(typeof item)) || !selected.length) return null
      const match = actual.some(item => selected.some(value => String(value) === String(item)))
      return key === 'contains_any' ? match : !match
    }
    case 'text_contains': case 'text_not_contains': case 'text_starts_with': case 'text_not_starts_with': {
      if (typeof actual !== 'string' || typeof operand !== 'string') return null
      const match = key.includes('starts_with') ? actual.startsWith(operand) : actual.includes(operand)
      return key.includes('_not_') ? !match : match
    }
    case 'lt': case 'lte': case 'gt': case 'gte': {
      if (typeof actual !== 'number' || typeof operand !== 'number' || !Number.isFinite(actual) || !Number.isFinite(operand)) return null
      return key === 'lt' ? actual < operand : key === 'lte' ? actual <= operand : key === 'gt' ? actual > operand : actual >= operand
    }
    default: return null
  }
}
export interface ExclusionDecision { decision: 'allowed' | 'excluded' | 'unknown'; note: string }
/** Resolver failures are unknown. Cancellation/lifecycle errors must be thrown by the caller's checkActive. */
export async function evaluateSendExclusion(snapshot: SendExclusionSnapshot, uid: string, resolve: (source: string) => Promise<unknown>, checkActive: () => void = () => {}, onSourceError?: (source: string, error: unknown) => Promise<void>): Promise<ExclusionDecision> {
  checkActive()
  if (uid && snapshot.blocklistUids.includes(uid.trim())) return {decision: 'excluded', note: 'Thuộc danh sách Zalo ID loại trừ.'}
  if (!uid && snapshot.blocklistUids.length) return {decision: 'unknown', note: 'Chưa xác định được Zalo ID để kiểm tra danh sách loại trừ.'}
  const group = snapshot.group
  if (!group) return {decision: 'allowed', note: ''}
  validateExclusionGroup(snapshot.catalog, group)
  const sources = new Map<string, Promise<unknown>>()
  let unknown = false
  // Cheap DB facts precede optional Zalo reads. Ordering has no effect on three-valued logic.
  const rules = group.rules.filter(rule => rule.isEnabled).sort((a, b) => {
    const cost = (r: ExclusionRule) => ['akabiz_contact', 'campaign_delivery'].includes(ruleDefinition(snapshot.catalog, r).field.sourceKey) ? 0 : 1
    return cost(a) - cost(b) || a.sortOrder - b.sortOrder
  })
  for (const rule of rules) {
    const {field, operator} = ruleDefinition(snapshot.catalog, rule)
    if (!sources.has(field.sourceKey)) sources.set(field.sourceKey, Promise.resolve().then(() => resolve(field.sourceKey)).catch(async error => { await onSourceError?.(field.sourceKey, error); return null }))
    const data = await sources.get(field.sourceKey)
    checkActive()
    const available = data && typeof data === 'object' ? (data as {availableValues?: unknown[]}).availableValues : undefined
    const missingOption = Array.isArray(available) && values(rule.value).some(value => !available.some(item => String(item) === String(value)))
    const result = missingOption ? null : evaluateFilter(operator.evaluatorKey, readPath(data, field.sourceConfig.path), rule.value, field.dataType)
    if (result === true && group.matchMode === 'or') return {decision: 'excluded', note: `Thỏa điều kiện loại trừ của nhóm “${group.name}”: ${field.name}.`}
    if (result === false && group.matchMode === 'and') return {decision: 'allowed', note: ''}
    if (result === null) unknown = true
  }
  if (unknown) return {decision: 'unknown', note: `Chưa đủ dữ liệu để kiểm tra nhóm “${group.name}”.`}
  return group.matchMode === 'and' ? {decision: 'excluded', note: `Thỏa điều kiện loại trừ của nhóm “${group.name}”.`} : {decision: 'allowed', note: ''}
}
/** Both findUser and getUserInfo envelopes expose the same profile properties to definitions. */
export function zaloProfileFacts(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const profile = record.profile ?? record.user ?? record
  return profile && typeof profile === 'object' && !Array.isArray(profile) ? profile as Record<string, unknown> : null
}
export function readFriendship(raw: unknown): {status: string} | null {
  if (!raw || typeof raw !== 'object') return null
  const base = raw as Record<string, unknown>
  const nested = base.profile ?? base.user
  const r = nested && typeof nested === 'object' ? {...base, ...nested as Record<string, unknown>} : base
  const flag = (value: unknown) => value === 1 || value === '1' || value === true ? true : value === 0 || value === '0' || value === false ? false : null
  const friend = flag(r.is_friend ?? r.isFr ?? r.is_fr)
  if (friend === true) return {status: 'friend'}
  const sent = flag(r.is_requesting), received = flag(r.is_requested)
  if (sent === true) return {status: 'request_sent'}
  if (received === true) return {status: 'request_received'}
  return friend === false && sent === false && received === false ? {status: 'stranger'} : null
}

export interface LabelSnapshot { labelData: Array<{id: number | string; text?: string; conversations: string[]; [key: string]: unknown}>; version: number; lastUpdateTime?: number }
export function validateLabelSnapshot(raw: unknown): LabelSnapshot {
  const r = raw as LabelSnapshot | null
  if (!r || !Number.isFinite(r.version) || !Array.isArray(r.labelData) || r.labelData.some(label => !label || !label.id || !Array.isArray(label.conversations) || label.conversations.some(id => typeof id !== 'string'))) throw new Error('Không xác minh được dữ liệu tag Zalo.')
  return r
}
/** Single-flight read, including errors. Mutation responses advance the working version. */
export class CampaignLabelContext {
  private pending?: Promise<LabelSnapshot>
  private working?: LabelSnapshot
  constructor(private readonly read: () => Promise<unknown>, private readonly checkActive: () => void = () => {}) {}
  assertActive(): void { this.checkActive() }
  async initial(): Promise<LabelSnapshot> {
    this.checkActive()
    if (!this.pending) this.pending = Promise.resolve().then(() => { this.checkActive(); return this.read() }).then(validateLabelSnapshot).then(snapshot => {
      this.checkActive()
      this.working = structuredClone(snapshot)
      return snapshot
    })
    const snapshot = await this.pending
    this.checkActive()
    return snapshot
  }
  async current(): Promise<LabelSnapshot> { await this.initial(); this.checkActive(); return this.working! }
  commit(raw: unknown): void { this.checkActive(); this.working = structuredClone(validateLabelSnapshot(raw)) }
  async ids(uid: string): Promise<{ids: string[]; availableValues: string[]}> {
    const snapshot = await this.initial()
    this.checkActive()
    return {ids: snapshot.labelData.filter(label => label.conversations.includes(uid)).map(label => String(label.id)), availableValues: snapshot.labelData.map(label => String(label.id))}
  }
}
