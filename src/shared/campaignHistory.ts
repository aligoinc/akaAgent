/** IDs remain decimal strings: PostgreSQL bigint exceeds JavaScript's safe range. */
export interface CampaignHistoryEntry { id: string; log: string; createdAt: string }
export interface CampaignHistoryQuery { beforeId?: string; afterId?: string; throughId?: string; limit?: number }
export interface CampaignHistoryPage { campaignId: number; items: CampaignHistoryEntry[]; hasMore: boolean; nextCursor: string | null; throughId?: string }
export interface CampaignHistorySnapshot { id: number; items: CampaignHistoryEntry[]; newestId: string; hasOlder: boolean }

export function compareHistoryIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

export function mergeHistoryItems(a: CampaignHistoryEntry[], b: CampaignHistoryEntry[]): CampaignHistoryEntry[] {
  const rows = new Map(a.map(row => [row.id, row]))
  b.forEach(row => rows.set(row.id, row))
  return Array.from(rows.values()).sort((x, y) => compareHistoryIds(y.id, x.id))
}

/** Publish a fresh cursor only after every page of new records has been read.
 * Automatic refresh keeps the currently requested window bounded. Older pages
 * are fetched only on demand; dropping an old visible item never deletes it.
 */
export async function readCampaignHistory(
  id: number,
  previous: CampaignHistorySnapshot | undefined,
  read: (query: CampaignHistoryQuery) => Promise<CampaignHistoryPage | null>,
  older = false,
  current: () => boolean = () => true
): Promise<CampaignHistorySnapshot | null> {
  if (!current()) return null
  if (!previous || older) {
    const beforeId = older ? previous?.items[previous.items.length - 1]?.id : undefined
    const page = await read({ limit: 100, ...(beforeId ? { beforeId } : {}) })
    if (!page || !current()) return null
    const items = mergeHistoryItems(older ? previous?.items || [] : [], page.items)
    return { id, items, newestId: previous?.newestId || items[0]?.id || '0', hasOlder: page.hasMore }
  }
  let cursor = previous.newestId
  let throughId: string | undefined
  let items = previous.items
  let hasOlder = previous.hasOlder
  const windowSize = Math.max(100, items.length)
  for (;;) {
    if (!current()) return null
    const page = await read({ afterId: cursor, ...(throughId ? { throughId } : {}), limit: 500 })
    if (!page || !current()) return null
    throughId ??= page.throughId
    if (page.items.length) {
      const merged = mergeHistoryItems(items, page.items)
      hasOlder ||= merged.length > windowSize
      items = merged.slice(0, windowSize)
    }
    const next = page.items.reduce((latest, row) => compareHistoryIds(row.id, latest) > 0 ? row.id : latest, cursor)
    if (page.hasMore && next === cursor) throw new Error('Cursor lịch sử không tiến lên.')
    cursor = next
    if (!page.hasMore) return items === previous.items && cursor === previous.newestId && hasOlder === previous.hasOlder
      ? previous : { id, items, newestId: cursor, hasOlder }
  }
}

/** A stored RPC argument is one entry, even if continuation lines look dated. */
export function displayHistoryEntry(entry: CampaignHistoryEntry): { key: string; timestamp?: string; message: string; screenshotEventId?: number } {
  const newline = entry.log.indexOf('\n')
  const first = newline < 0 ? entry.log : entry.log.slice(0, newline)
  const match = first.match(/^\[([^\]]+)\]\s*(.*)$/)
    || first.match(/^(\d{1,2}:\d{2}:\d{2}\s+\d{1,2}\/\d{1,2}\/\d{4})\s+-\s*(.*)$/)
  const text = (match ? match[2] : first) + (newline < 0 ? '' : entry.log.slice(newline))
  const screenshot = text.match(/\s*<!--\s*screenshotEventId:(\d+)\s*-->\s*$/i)
  return { key: entry.id, timestamp: match?.[1], message: screenshot ? text.slice(0, screenshot.index).trimEnd() : text,
    ...(screenshot ? { screenshotEventId: Number(screenshot[1]) } : {}) }
}

export function validateHistoryQuery(query: CampaignHistoryQuery): CampaignHistoryQuery {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Bộ lọc lịch sử không hợp lệ.')
  const { beforeId, afterId, throughId, limit = 100 } = query
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || beforeId !== undefined && afterId !== undefined) throw new Error('Bộ lọc lịch sử không hợp lệ.')
  for (const value of [beforeId, afterId, throughId]) {
    if (value !== undefined && (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)
      || compareHistoryIds(value, '9223372036854775807') > 0)) throw new Error('Cursor lịch sử không hợp lệ.')
  }
  if (beforeId === '0' || throughId !== undefined && afterId === undefined) throw new Error('Cursor lịch sử không hợp lệ.')
  return { limit, ...(beforeId !== undefined ? { beforeId } : {}), ...(afterId !== undefined ? { afterId } : {}), ...(throughId !== undefined ? { throughId } : {}) }
}
