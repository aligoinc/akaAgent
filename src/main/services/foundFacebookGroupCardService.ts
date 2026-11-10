import {
  facebookGroupUrlKey, mergeFacebookSearchGroupCards, parseFacebookSearchGroupCard, type FacebookSearchGroupCard
} from '../../shared/facebookSearchGroupCard'
import type {
  FoundFacebookGroupCardsData, FoundFacebookGroupCardsRequest, FoundFacebookGroupCardsResult
} from '../../shared/foundFacebookGroupCardsIpc'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import { listFacebookSearchGroupCardEventPage } from '../data/repositories/campaignRunEventRepository'
import { getSupabaseClient } from '../data/supabaseClient'

/**
 * Xuất Excel tab "Data tìm được" (Facebook - Tìm kiếm data bằng search): đọc lại chữ gốc của thẻ nhóm trong log chạy
 * để file có đủ dữ liệu mà kết quả chạy chưa lưu (block hiện tại không đọc được số bài giao diện tiếng Anh, không lấy
 * trạng thái tham gia/bạn bè…). Chỉ đọc, chỉ khi bấm xuất; không cache, không hẹn giờ. Mỗi trang 1.000 dòng theo
 * keyset, tối đa 60.000 dòng (chiến dịch lớn nhất 10/11/2026: 19.329 thẻ), hạn cả lượt 65 s như các lượt đọc lớn
 * khác; quá hạn hoặc quá số dòng thì trả phần mới nhất đã đọc kèm `truncated`. Gộp lượt trùng theo chiến dịch.
 */
const FIND_DATA_SEARCH_ACTION_ID = 'facebook_find_data_search'
const PAGE_SIZE = 1_000
const MAX_ROWS = 60_000
const DEADLINE_MS = 65_000
const flights = new Map<string, Promise<FoundFacebookGroupCardsResult>>()

class FoundGroupCardsError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'FoundGroupCardsError'
  }
}

const timeoutError = () => new FoundGroupCardsError('cards_timeout', 'Đọc log chạy quá lâu, chưa lấy được thông tin thêm của nhóm.')
const unavailableError = () => new FoundGroupCardsError('cards_unavailable', 'Chưa đọc được log chạy của chiến dịch.')

async function assertOwnedSearchCampaign(campaignId: number, signal: AbortSignal): Promise<void> {
  const user = requireCurrentUser()
  const { data, error } = await getSupabaseClient().from('auto_campaigns')
    .select('id,action_id')
    .eq('id', campaignId).eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false)
    .abortSignal(signal).maybeSingle()
  if (signal.aborted) throw timeoutError()
  if (error) throw unavailableError()
  if (!data) throw new FoundGroupCardsError('campaign_not_found', 'Không tìm thấy chiến dịch.')
  if ((data as { action_id?: unknown }).action_id !== FIND_DATA_SEARCH_ACTION_ID) {
    throw new FoundGroupCardsError('unsupported_campaign', 'Chiến dịch này không phải tìm data bằng search.')
  }
}

async function readCards(campaignId: number, signal: AbortSignal): Promise<FoundFacebookGroupCardsData> {
  await assertOwnedSearchCampaign(campaignId, signal)
  const byKey = new Map<string, { seenAt: string; card: FacebookSearchGroupCard }>()
  let before: { createdAt: string; id: number } | null = null
  let scannedRows = 0
  let truncated = false
  for (;;) {
    let rows: Awaited<ReturnType<typeof listFacebookSearchGroupCardEventPage>>
    try {
      rows = await listFacebookSearchGroupCardEventPage(campaignId, { before, limit: PAGE_SIZE, signal })
    } catch (error) {
      if (signal.aborted && scannedRows > 0) {
        truncated = true
        break
      }
      if (signal.aborted) throw timeoutError()
      console.warn('[foundFacebookGroupCards] read failed:', error instanceof Error ? error.message : String(error))
      throw unavailableError()
    }
    for (const row of rows) {
      scannedRows += 1
      const key = facebookGroupUrlKey(row.targetUrl)
      if (!key || !row.rawText) continue
      const card = parseFacebookSearchGroupCard(row.rawText)
      const entry = byKey.get(key)
      // Dòng đến theo thứ tự mới → cũ: thẻ cũ hơn chỉ bổ sung trường còn trống.
      if (entry) entry.card = mergeFacebookSearchGroupCards([entry.card, card])
      else byKey.set(key, { seenAt: row.createdAt, card })
    }
    if (rows.length < PAGE_SIZE) break
    if (scannedRows >= MAX_ROWS) {
      truncated = true
      break
    }
    const last = rows[rows.length - 1]
    before = { createdAt: last.createdAt, id: last.id }
  }
  return {
    cards: Array.from(byKey, ([key, entry]) => ({ key, seenAt: entry.seenAt, card: entry.card })),
    scannedRows,
    truncated
  }
}

export async function handleFoundFacebookGroupCardsRequest(request: FoundFacebookGroupCardsRequest): Promise<FoundFacebookGroupCardsResult> {
  const campaignId = Number(request?.campaignId)
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    return { ok: false, code: 'invalid_campaign_id', message: 'ID chiến dịch không hợp lệ.' }
  }
  let user: ReturnType<typeof requireCurrentUser>
  try {
    user = requireCurrentUser()
  } catch {
    return { ok: false, code: 'session_invalid', message: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.' }
  }
  const flightKey = `${user.staffId}:${user.organizationId}:${campaignId}`
  const running = flights.get(flightKey)
  if (running) return running
  const flight = runWithCurrentUser(user, async (): Promise<FoundFacebookGroupCardsResult> => {
    try {
      return { ok: true, data: await readCards(campaignId, AbortSignal.timeout(DEADLINE_MS)) }
    } catch (error) {
      if (error instanceof FoundGroupCardsError) return { ok: false, code: error.code, message: error.message }
      const message = error instanceof Error ? error.message : String(error)
      if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) {
        return { ok: false, code: 'session_invalid', message: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.' }
      }
      console.warn('[foundFacebookGroupCards] request failed:', message)
      return { ok: false, code: 'cards_unavailable', message: unavailableError().message }
    }
  }).finally(() => flights.delete(flightKey))
  flights.set(flightKey, flight)
  return flight
}
