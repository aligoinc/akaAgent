/** Shared metadata contract. This module must never call a Zalo API. */
export type EngagementKind = 'message' | 'reaction' | 'friend' | 'seen'
export type EngagementFilter = 'all' | 'responded' | 'reacted' | 'friended' | 'seen' | 'none'
export interface ZaloEngagementSource {
  version: 1
  operationId?: string
  accountZaloUid: string
  targetZaloUid: string
  actionType: 'message' | 'friend_request'
  sentAt: string
  messageIds: string[]
  revision: string
}
export interface ZaloEngagement {
  sent_at: string
  tracking_until: string
  seen_at: string | null
  responded_at: string | null
  reacted_at: string | null
  friended_at: string | null
}
export interface EngagementEvent {
  accountId: string
  accountZaloUid: string
  targetZaloUid: string
  kind: EngagementKind
  occurredAt: string
  messageIds: string[]
}
export interface EngagementConfig {
  enabled: boolean
  revision: string
  flushIntervalSeconds: number
  batchSize: number
  trackingWindowHours: number
}
export const ENGAGEMENT_PREFIX = 'zalo.campaign_engagement.'
export const ENGAGEMENT_KEYS = ['enabled', 'flush_interval_seconds', 'batch_size', 'tracking_window_hours'].map(k => ENGAGEMENT_PREFIX + k)
export function parseEngagementConfig(rows: Array<{ key: string; value: unknown; updated_at?: unknown; is_active?: boolean; is_secret?: boolean }>): EngagementConfig {
  const map = new Map(rows.filter(r => r.is_active !== false && r.is_secret !== true).map(r => [r.key, r]))
  const enabled = map.get(ENGAGEMENT_KEYS[0]!)
  const integer = (index: number, fallback: number, max: number): number => {
    const raw = String(map.get(ENGAGEMENT_KEYS[index]!)?.value ?? '')
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN
    return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback
  }
  const revision = typeof enabled?.updated_at === 'string' ? enabled.updated_at : ''
  return { enabled: enabled?.value === 'true' && !!revision, revision,
    flushIntervalSeconds: integer(1, 5, 60), batchSize: integer(2, 100, 500), trackingWindowHours: integer(3, 48, 720) }
}
export class EngagementConfigCache {
  private cached: { at: number; value: EngagementConfig } | undefined
  private pending: Promise<EngagementConfig> | undefined
  private failedUntil = 0
  constructor(private readonly read: () => Promise<Parameters<typeof parseEngagementConfig>[0]>, private readonly now = Date.now) {}
  get(): Promise<EngagementConfig> {
    if (this.cached && this.now() - this.cached.at < 60_000) return Promise.resolve(this.cached.value)
    if (this.pending) return this.pending
    if (this.now() < this.failedUntil) return Promise.reject(new Error("engagement_config_unavailable"))
    this.pending = Promise.resolve().then(this.read).then(rows => {
      const value = parseEngagementConfig(rows)
      this.cached = { at: this.now(), value }
      return value
    }).catch(error => { this.failedUntil = this.now()+60_000; throw error }).finally(() => { this.pending = undefined })
    return this.pending
  }
  /** Optional tracking must never make a campaign wait for configuration IO. */
  currentOrRefresh(): EngagementConfig | undefined {
    const current = this.cached && this.now() - this.cached.at < 60_000 ? this.cached.value : undefined
    if (!current) void this.get().catch(() => undefined)
    return current
  }
  /** Only for fencing deferred metadata; never authorizes work with stale settings. */
  lastKnown(): EngagementConfig | undefined { return this.cached?.value }
  invalidate(): void { this.cached = undefined }
}
export const engagementRecord = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const id = (v: unknown): string => typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : ''
export function engagementMessageIds(result: unknown): string[] {
  // Only SDK send-result containers, never arbitrary text/content or client IDs.
  const out = new Set<string>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) return
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    const row = engagementRecord(value)
    for (const key of ['msgId', 'msgID', 'globalMsgId']) {
      const value = id(row[key]); if (value) out.add(value)
    }
    for (const key of ['message', 'attachment', 'response', 'mediaResponse', 'contentResponse', 'data']) {
      if (row[key] !== undefined) visit(row[key], depth + 1)
    }
  }
  visit(result, 0)
  return Array.from(out)
}
function eventTime(value: unknown, receivedAt: string): string {
  if (value === undefined || value === null || value === '') return receivedAt
  const n = Number(value)
  const ms = Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.parse(String(value))
  return Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : receivedAt
}
export function normalizeEngagementEvent(type: string, payload: unknown, accountId: string, ownUid: string, receivedAt: string): EngagementEvent[] {
  if ((type === 'seen_messages' || type === 'delivered_messages') && Array.isArray(payload)) {
    return payload.flatMap(item => normalizeEngagementEvent(type,item,accountId,ownUid,receivedAt))
  }
  const row = engagementRecord(payload)
  const data = engagementRecord(row.data)
  if (!accountId || !ownUid || row.isSelf === true || row.isGroup === true) return []
  let kind: EngagementKind
  let target: string
  let messageIds: string[] = []
  let at: unknown = data.ts
  if (type === 'message') {
    if (row.type !== 0 && row.type !== 'user') return []
    kind = 'message'; target = id(data.uidFrom)
    if (id(data.idTo) && id(data.idTo) !== ownUid) return []
  } else if (type === 'reaction') {
    if (row.isGroup !== false) return []
    const content = engagementRecord(data.content)
    if (!content.rIcon || content.rType === -1) return []
    messageIds = Array.isArray(content.rMsg) ? content.rMsg.map(v => id(engagementRecord(v).gMsgID)).filter(Boolean) : []
    if (!messageIds.length) return []
    kind = 'reaction'; target = id(data.uidFrom)
  } else if (type === 'seen_messages' || type === 'delivered_messages') {
    if (row.type !== 0 && row.type !== 'user') return []
    target = type === 'seen_messages' ? id(data.idTo) : id(row.threadId)
    if (id(row.threadId) && id(row.threadId) !== target) return []
    // Delivery alone is not a read. Only an explicit seen receipt/seen UID counts.
    if (type === 'delivered_messages' && (!Array.isArray(data.seenUids) || !data.seenUids.map(id).includes(target))) return []
    // Match the same global msgId used by the existing Chat receipt projection.
    const messageId = id(data.msgId)
    if (!messageId) return []
    kind = 'seen'; messageIds = [messageId]
    // The SDK's seen receipt has no timestamp: retain the first arrival time.
  } else if (type === 'friend_event') {
    if (row.type !== 0) return [] // ADD only; SDK isSelf cannot identify who accepted.
    kind = 'friend'; target = id(row.data) || id(row.threadId); at = row.ts
  } else return []
  if (!target || target === ownUid || target === '0') return []
  return [{ accountId, accountZaloUid: ownUid, targetZaloUid: target, kind, occurredAt: eventTime(at, receivedAt), messageIds }]
}
export function makeEngagementSource(ownUid: string | undefined | null, targetUid: string, actionType: ZaloEngagementSource['actionType'], sentAt: string, responses: unknown, revision: string, operationId?: string): ZaloEngagementSource | undefined {
  if (!ownUid || !targetUid || ownUid === targetUid || !revision || !Number.isFinite(Date.parse(sentAt))) return undefined
  return { version: 1, ...(operationId ? { operationId } : {}), accountZaloUid: ownUid, targetZaloUid: targetUid, actionType, sentAt,
    messageIds: actionType === 'message' ? engagementMessageIds(responses) : [], revision }
}
export function engagementDisplay(value: ZaloEngagement | null | undefined, applicable: boolean): string {
  if (!applicable || !value) return ''
  const marks = [[value.seen_at, 'Đã xem'], [value.responded_at, 'Đã phản hồi'], [value.reacted_at, 'Đã thả cảm xúc'], [value.friended_at, 'Đã kết bạn']]
    .filter(([at]) => at).map(([at, label]) => `${label}: ${new Date(at!).toLocaleString('vi-VN')}`)
  return marks.join('\n')
}
export const engagementApplicable = (actionCode?: string | null): boolean => ['zalo_message_friend', 'zalo_message_stranger', 'zalo_add_friend'].includes(actionCode || '')

export interface EngagementWatch extends ZaloEngagement {
  campaign_detail_id: number | string
  account_id: number | string
  account_zalo_uid: string
  target_zalo_uid: string
  action_type: 'message' | 'friend_request'
  message_ids: string[]
}
/** Positive metadata only. Missing/evicted/expired entries always mean unknown. */
export class EngagementWatchCache {
  private rows = new Map<string, { row: EngagementWatch; bytes: number; key: string }>()
  private targets = new Map<string, Set<string>>()
  bytes = 0
  saturated = false
  private accounts = new Map<string, number>()
  constructor(readonly maxEntries = 100_000, readonly maxBytes = 64 * 1024 * 1024) {}
  get size(): number { return this.rows.size }
  hasAccount(account: string | number, own: string): boolean { return this.accounts.has(JSON.stringify([String(account),own])) }
  private key(account: string | number, own: string, target: string): string { return JSON.stringify([String(account), own, target]) }
  put(row: EngagementWatch): void {
    const id = String(row.campaign_detail_id), bytes = JSON.stringify(row).length * 2
    this.remove(id)
    if (bytes > this.maxBytes) { this.saturated=true; return }
    while (this.rows.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) { this.saturated=true; this.remove(this.rows.keys().next().value!) }
    const key = this.key(row.account_id,row.account_zalo_uid,row.target_zalo_uid)
    this.rows.set(id,{ row,bytes,key }); this.bytes+=bytes
    const account=JSON.stringify([String(row.account_id),row.account_zalo_uid]); this.accounts.set(account,(this.accounts.get(account) || 0)+1)
    let ids=this.targets.get(key); if (!ids) this.targets.set(key,ids=new Set())
    ids.add(id)
  }
  private remove(id: string): void {
    const item=this.rows.get(id); if (!item) return
    this.rows.delete(id); this.bytes-=item.bytes
    const account=JSON.stringify([String(item.row.account_id),item.row.account_zalo_uid]), count=(this.accounts.get(account) || 1)-1
    if (count) this.accounts.set(account,count); else this.accounts.delete(account)
    const ids=this.targets.get(item.key); ids?.delete(id); if (!ids?.size) this.targets.delete(item.key)
  }
  mayMatch(event: EngagementEvent): true | undefined {
    const ids=this.targets.get(this.key(event.accountId,event.accountZaloUid,event.targetZaloUid))
    const at=Date.parse(event.occurredAt)
    for (const id of Array.from(ids || [])) {
      const item=this.rows.get(id)!, row=item.row
      if (at<Date.parse(row.sent_at) || at>Date.parse(row.tracking_until)) continue
      if (event.kind==='friend' ? row.action_type!=='friend_request' : row.action_type!=='message') continue
      if ((event.kind==='reaction' || event.kind==='seen') && !row.message_ids.some(id=>event.messageIds.includes(id))) continue
      this.rows.delete(id); this.rows.set(id,item)
      return true
    }
    return undefined
  }
  clear(): void { this.rows.clear(); this.targets.clear(); this.accounts.clear(); this.bytes=0; this.saturated=false }
}
