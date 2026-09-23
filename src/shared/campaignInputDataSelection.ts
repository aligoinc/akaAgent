import type { CampaignInputData, CampaignInputDataPageQuery, CampaignInputDataPageResult, CampaignInputDataSort } from './types'

type SelectionQuery = Omit<CampaignInputDataPageQuery, 'offset' | 'limit'> & { inputDataIds: number[] }

const timestamp = (value: string | null | undefined): [number, number] | null => {
  if (value == null) return null
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new Error('Thời gian của data không hợp lệ.')
  // Postgres retains microseconds; Date.parse only retains milliseconds.
  const fraction = value.match(/\.(\d+)/)?.[1] || ''
  return [milliseconds, Number(fraction.padEnd(6, '0').slice(3, 6))]
}

export function sortCampaignInputDataSelection(rows: CampaignInputData[], sort: CampaignInputDataSort): CampaignInputData[] {
  const direction = sort.endsWith('_asc') ? 1 : -1
  return rows.map(row => ({
    row,
    time: timestamp(sort.startsWith('processed_') ? row.dateAction ?? row.createdAt : row.createdAt)
  })).sort((left, right) => {
    if (left.time === null && right.time !== null) return 1
    if (left.time !== null && right.time === null) return -1
    const byTime = left.time && right.time
      ? left.time[0] - right.time[0] || left.time[1] - right.time[1]
      : 0
    return direction * (byTime || left.row.id - right.row.id)
  }).map(item => item.row)
}

export async function loadSelectedCampaignInputData(
  query: SelectionQuery,
  loadPage: (query: CampaignInputDataPageQuery) => Promise<CampaignInputDataPageResult>
): Promise<CampaignInputData[]> {
  const ids = Array.from(new Set(query.inputDataIds))
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('ID data không hợp lệ.')
  const rows: CampaignInputData[] = []
  // Partition by immutable IDs, never by offsets in a changing time order.
  for (let start = 0; start < ids.length; start += 500) {
    const inputDataIds = ids.slice(start, start + 500)
    const page = await loadPage({ ...query, inputDataIds, offset: 0, limit: inputDataIds.length })
    const expectedIds = new Set(inputDataIds)
    const returnedIds = new Set(page.items.map(row => row.id))
    if (page.items.length !== expectedIds.size || returnedIds.size !== expectedIds.size
      || page.items.some(row => !expectedIds.has(row.id))) {
      throw new Error('Không thể tải đủ data đã chọn. Một số dòng đã bị xóa hoặc không còn khớp bộ lọc. Vui lòng tải lại danh sách và chọn lại.')
    }
    rows.push(...page.items)
  }
  return sortCampaignInputDataSelection(rows, query.sort ?? 'created_desc')
}
