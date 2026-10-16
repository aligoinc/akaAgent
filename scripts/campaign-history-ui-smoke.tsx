// Real CampaignPanel/store/hook, using the existing isolated panel fixture.
import './campaign-data-sort-ui-smoke'
import { useAuthStore } from '../src/renderer/src/stores/authStore'

const fixture = (window as any).sortSmoke
const original = window.electronAPI
const listeners = new Map<string, Set<(value: any) => void>>()
const histories = new Map<number, any[]>([91, 92].map(campaignId => [campaignId,
  Array.from({ length: 205 }, (_, i) => ({ id: String(i + 1), log: `12:00:00 16/10/2026 - History ${campaignId}/${i + 1} 😀\nContinuation`, createdAt: '2026-10-16T05:00:00Z' }))]))
fixture.history = { histories, hold: false, release: null, calls: [], auth: useAuthStore,
  emit: (key: string, value: any) => listeners.get(key)?.forEach(listener => listener(value)) }
window.electronAPI = new Proxy(original, { get(target, key: string) {
  if (key === 'onCampaignLog' || key === 'onCampaignLogUpdated') return (listener: (value: any) => void) => {
    const set = listeners.get(key) || new Set(); set.add(listener); listeners.set(key, set)
    return () => { set.delete(listener) }
  }
  if (key === 'getDesktopCampaignLogs') return async (id: number, query: any) => {
    fixture.history.calls.push({ id, query })
    const rows = (histories.get(id) || []).filter(row => (!query.beforeId || BigInt(row.id) < BigInt(query.beforeId))
      && (!query.afterId || BigInt(row.id) > BigInt(query.afterId)) && (!query.throughId || BigInt(row.id) <= BigInt(query.throughId)))
      .sort((a, b) => (query.afterId ? 1 : -1) * (Number(a.id) - Number(b.id)))
    const items = rows.slice(0, query.limit)
    const result = { campaignId: id, items, hasMore: rows.length > query.limit, nextCursor: items.at(-1)?.id || null,
      throughId: query.throughId || histories.get(id)?.at(-1)?.id || '0' }
    if (fixture.history.hold) await new Promise(resolve => { fixture.history.release = resolve })
    return result
  }
  return Reflect.get(target, key)
} })
