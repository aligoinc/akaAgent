/**
 * Quét data website (V618): công tắc web_scan.campaigns và RPC tin đã quét / số đã hiện. Phương án docs/WEB_DATA_SCAN_PLAN.md mục 7.
 */
import { getSupabaseClient } from '../supabaseClient'
import {
  parseWebScanSetting, WEB_SCAN_SETTING_KEY, webScanCoversOrganization, type WebScanLimits, type WebScanSetting, type WebScanSite
} from '../../../shared/webScan'

const SETTING_TIMEOUT_MS = 8_000
const RPC_TIMEOUT_MS = 15_000

export interface WebScanSettingSnapshot {
  setting: WebScanSetting
  /** Tên cookie batdongsan báo đã đăng nhập (điền ở DB sau khi thử thật; rỗng = không đoán, chỉ dựa vào hộp đăng nhập lúc chạy). */
  batdongsanLoginCookies: string[]
}

let cached: { at: number; value: WebScanSettingSnapshot } | null = null

export async function loadWebScanSetting(force = false): Promise<WebScanSettingSnapshot> {
  if (!force && cached && Date.now() - cached.at < 5 * 60_000) return cached.value
  try {
    const { data, error } = await getSupabaseClient()
      .from('auto_system_settings')
      .select('value')
      .eq('key', WEB_SCAN_SETTING_KEY)
      .eq('is_active', true)
      .abortSignal(AbortSignal.timeout(SETTING_TIMEOUT_MS))
      .maybeSingle()
    if (error) throw new Error(error.message)
    const raw = (data as { value?: string | null } | null)?.value ?? null
    let cookies: string[] = []
    try {
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && Array.isArray(parsed.batdongsanLoginCookies)) {
        cookies = parsed.batdongsanLoginCookies.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      }
    } catch { cookies = [] }
    const value = { setting: parseWebScanSetting(raw), batdongsanLoginCookies: cookies }
    cached = { at: Date.now(), value }
    return value
  } catch (error) {
    console.warn('[auth] Không đọc được thiết lập quét data website:', error)
    return { setting: parseWebScanSetting(null), batdongsanLoginCookies: [] }
  }
}

/** Lúc đăng nhập: tổ chức có bật quét data website không, kèm mặc định / trần giới hạn. Lỗi đọc = tắt. */
export async function loadWebScanAccess(organizationId: number): Promise<{ enabled: boolean; limits: WebScanLimits }> {
  const snapshot = await loadWebScanSetting(true)
  return { enabled: webScanCoversOrganization(snapshot.setting, organizationId), limits: snapshot.setting.limits }
}

export interface WebScanSeenResult {
  seen: Set<string>
  cached: Map<string, { phone: string; name: string | null; data: Record<string, unknown> }>
}

function rpcError(name: string, reason: unknown): Error {
  return new Error(`${name}: ${String(reason || 'lỗi không rõ')}`)
}

/** Trong các mã tin vừa đọc: tin chiến dịch đã quét ở lượt trước, và số đã hiện trong tổ chức 30 ngày (V618). */
export async function loadWebScanSeen(campaignId: number, site: WebScanSite, keys: readonly string[], signal?: AbortSignal): Promise<WebScanSeenResult> {
  const unique = [...new Set(keys.filter(Boolean))]
  const out: WebScanSeenResult = { seen: new Set(), cached: new Map() }
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400)
    const { data, error } = await getSupabaseClient()
      .rpc('aka_agent_web_scan_seen_v1', { p_campaign_id: campaignId, p_site: site, p_keys: chunk })
      .abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(RPC_TIMEOUT_MS)]) : AbortSignal.timeout(RPC_TIMEOUT_MS))
    if (error) throw rpcError('aka_agent_web_scan_seen_v1', error.message)
    const res = data as { ok?: boolean; reason?: string; seen?: string[]; cached?: Record<string, { phone: string; name: string | null; data: Record<string, unknown> }> }
    if (!res?.ok) throw rpcError('aka_agent_web_scan_seen_v1', res?.reason)
    for (const key of res.seen || []) out.seen.add(key)
    for (const [key, value] of Object.entries(res.cached || {})) if (value?.phone) out.cached.set(key, value)
  }
  return out
}

export interface WebScanRecordItem {
  key: string
  phone?: string | null
  name?: string | null
  data?: Record<string, unknown>
}

/** Ghi tin vừa quét của chiến dịch (và số vừa hiện, dùng lại trong tổ chức 30 ngày). */
export async function recordWebScanSeen(campaignId: number, site: WebScanSite, items: readonly WebScanRecordItem[], signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200)
    const { data, error } = await getSupabaseClient()
      .rpc('aka_agent_web_scan_record_v1', { p_campaign_id: campaignId, p_site: site, p_items: chunk })
      .abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(RPC_TIMEOUT_MS)]) : AbortSignal.timeout(RPC_TIMEOUT_MS))
    if (error) throw rpcError('aka_agent_web_scan_record_v1', error.message)
    const res = data as { ok?: boolean; reason?: string }
    if (!res?.ok) throw rpcError('aka_agent_web_scan_record_v1', res?.reason)
  }
}

let blocksCache: { at: number; value: Map<string, string> } | null = null

/** Code block "[engine] web_*" (V618) theo tên; giữ 5 phút như danh mục engine Facebook (sửa block ở DB có hiệu lực ở lượt sau đó). */
export async function loadWebScanBlocks(names: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
  if (blocksCache && Date.now() - blocksCache.at < 5 * 60_000 && names.every(name => blocksCache!.value.has(name))) return blocksCache.value
  const { data, error } = await getSupabaseClient()
    .from('auto_blocks')
    .select('name, code')
    .in('name', [...names])
    .abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(RPC_TIMEOUT_MS)]) : AbortSignal.timeout(RPC_TIMEOUT_MS))
  if (error) throw new Error(`Không đọc được block quét data website: ${error.message}`)
  const value = new Map<string, string>()
  for (const row of (data || []) as Array<{ name: string; code: string | null }>) if (row.code) value.set(row.name, row.code)
  blocksCache = { at: Date.now(), value }
  return value
}
