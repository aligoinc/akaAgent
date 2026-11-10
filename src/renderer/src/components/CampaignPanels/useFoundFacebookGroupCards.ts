import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FacebookSearchGroupCard } from '../../../../shared/facebookSearchGroupCard'
import type { FoundFacebookGroupCardEntry } from '../../../../shared/foundFacebookGroupCardsIpc'

// Đọc lại sau thời gian này chỉ khi còn nhóm chưa có thẻ; không hẹn giờ, chỉ xét khi mở tab hoặc bấm Xuất.
const REFRESH_AFTER_MS = 2 * 60_000
const CACHE_LIMIT = 6

export interface FoundGroupCardsSnapshot {
  campaignId: number
  cards: FoundFacebookGroupCardEntry[]
  byKey: Map<string, FacebookSearchGroupCard>
  truncated: boolean
  fetchedAt: number
}

export type FoundGroupCardsResult = { ok: true; snapshot: FoundGroupCardsSnapshot } | { ok: false }

export type FoundGroupCardsStatus = 'idle' | 'loading' | 'ready' | 'failed'

const isFresh = (snapshot: FoundGroupCardsSnapshot, keys: readonly string[]): boolean =>
  Date.now() - snapshot.fetchedAt <= REFRESH_AFTER_MS || keys.every(key => snapshot.byKey.has(key))

/**
 * Thẻ nhóm (chữ gốc trong log chạy) cho kết quả cũ của chiến dịch tìm group bằng search: đọc một lần khi tab cần,
 * dùng lại cho nút Xuất Excel. Đang đọc thì lượt sau chờ cùng lượt đó; lỗi thì không tự đọc lại cho tới khi mở lại
 * tab, bấm Thử lại hoặc bấm Xuất.
 */
export function useFoundFacebookGroupCards(campaignId: number | null, wantedKeys: readonly string[], enabled: boolean) {
  const cacheRef = useRef(new Map<number, FoundGroupCardsSnapshot>())
  const inflightRef = useRef(new Map<number, Promise<FoundGroupCardsResult>>())
  const failedRef = useRef(new Set<number>())
  const [, setVersion] = useState(0)

  const fetchCards = useCallback((id: number): Promise<FoundGroupCardsResult> => {
    const existing = inflightRef.current.get(id)
    if (existing) return existing
    const request = (async (): Promise<FoundGroupCardsResult> => {
      try {
        const result = await window.electronAPI.getFoundFacebookGroupCards({ campaignId: id })
        if (result && result.ok === true && Array.isArray(result.data?.cards)) {
          const snapshot: FoundGroupCardsSnapshot = {
            campaignId: id,
            cards: result.data.cards,
            byKey: new Map(result.data.cards.map(entry => [entry.key, entry.card])),
            truncated: result.data.truncated === true,
            fetchedAt: Date.now()
          }
          const cache = cacheRef.current
          cache.delete(id)
          cache.set(id, snapshot)
          while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as number)
          failedRef.current.delete(id)
          return { ok: true, snapshot }
        }
      } catch (err) {
        console.error('Failed to read found Facebook group cards:', err)
      }
      failedRef.current.add(id)
      return { ok: false }
    })()
    const settled = request.finally(() => {
      inflightRef.current.delete(id)
      setVersion(version => version + 1)
    })
    inflightRef.current.set(id, settled)
    setVersion(version => version + 1)
    return settled
  }, [])

  const wantedSignature = useMemo(() => wantedKeys.join('\n'), [wantedKeys])
  useEffect(() => {
    if (!enabled || campaignId === null || wantedKeys.length === 0) return
    if (inflightRef.current.has(campaignId)) return
    const snapshot = cacheRef.current.get(campaignId)
    if (snapshot && isFresh(snapshot, wantedKeys)) return
    void fetchCards(campaignId)
    // Phụ thuộc vào wantedSignature thay cho mảng khoá: chỉ xét lại khi tập nhóm cần thẻ đổi, không phải mỗi lần render.
  }, [enabled, campaignId, wantedSignature, fetchCards])

  /** Cho nút Xuất: dùng thẻ đã đọc nếu còn mới hoặc đã đủ nhóm, không thì đọc lại (hoặc chờ lượt đang đọc). */
  const ensureCards = useCallback((id: number, keys: readonly string[]): Promise<FoundGroupCardsResult> => {
    const snapshot = cacheRef.current.get(id)
    if (snapshot && !inflightRef.current.has(id) && isFresh(snapshot, keys)) return Promise.resolve({ ok: true, snapshot })
    return fetchCards(id)
  }, [fetchCards])

  const retry = useCallback(() => {
    if (campaignId !== null) void fetchCards(campaignId)
  }, [campaignId, fetchCards])

  const snapshot = campaignId === null ? undefined : cacheRef.current.get(campaignId)
  const status: FoundGroupCardsStatus = campaignId === null
    ? 'idle'
    : inflightRef.current.has(campaignId)
      ? 'loading'
      : snapshot
        ? 'ready'
        : failedRef.current.has(campaignId) ? 'failed' : 'idle'
  return { snapshot, status, ensureCards, retry }
}
