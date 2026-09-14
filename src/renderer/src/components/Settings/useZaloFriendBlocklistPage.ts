import { useEffect, useState } from 'react'
import type { ZaloFriendBlocklistPage, ZaloFriendBlocklistPageQuery } from '../../../../shared/types'

export const BLOCKLIST_PAGE_SIZE = 100
const EMPTY_PAGE: ZaloFriendBlocklistPage = { contacts: [], total: 0 }

export function useZaloFriendBlocklistPage(
  accountId: number,
  groupId: number | null,
  mode: ZaloFriendBlocklistPageQuery['mode'],
  search: string,
  revision: number
) {
  const scope = JSON.stringify([accountId, groupId, mode, search.trim()])
  const [position, setPosition] = useState({ scope, page: 0 })
  const page = position.scope === scope ? position.page : 0
  const requestKey = JSON.stringify([scope, page, revision])
  const [result, setResult] = useState<{ key: string; data: ZaloFriendBlocklistPage; error: string } | null>(null)
  const enabled = accountId > 0 && (mode === 'available' || groupId !== null)

  useEffect(() => {
    setPosition(current => current.scope === scope ? current : { scope, page: 0 })
  }, [scope])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const data = await window.electronAPI.listZaloFriendBlocklistPage(accountId, {
          groupId, mode, search: search.trim(), offset: page * BLOCKLIST_PAGE_SIZE, limit: BLOCKLIST_PAGE_SIZE
        })
        if (cancelled) return
        const lastPage = Math.max(0, Math.ceil(data.total / BLOCKLIST_PAGE_SIZE) - 1)
        if (page > lastPage) {
          setPosition({ scope, page: lastPage })
          return
        }
        setResult({ key: requestKey, data, error: '' })
      } catch (error) {
        if (cancelled) return
        setResult({ key: requestKey, data: EMPTY_PAGE, error: error instanceof Error ? error.message : 'Không thể tải danh sách.' })
      }
    }, search.trim() ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [accountId, groupId, mode, search, revision, scope, page, requestKey, enabled])

  // Hide stale rows immediately, including the render before an effect cleanup.
  const current = enabled && result?.key === requestKey ? result : null
  return {
    ...(current?.data || EMPTY_PAGE),
    error: current?.error || '',
    loading: enabled && current === null,
    page,
    requestKey,
    setPage: (next: number) => setPosition({ scope, page: Math.max(0, next) })
  }
}
