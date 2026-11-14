import { utils, writeFile } from 'xlsx'
import {
  CAMPAIGN_RESULT_RECIPIENT_BATCH_SIZE, CAMPAIGN_RESULT_RECIPIENTS_TOO_MANY, CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE, campaignResultMergedFileName,
  campaignResultMergedSheets, type CampaignResultActionOption, type CampaignResultRecipient
} from '../../../../../shared/campaignResultActions'
import type { CampaignResultRecipientIpcQuery } from '../../../../../shared/campaignResultActionsIpc'

export class CampaignResultExportCancelled extends Error {
  constructor() { super('Đã hủy xuất Excel.'); this.name = 'CampaignResultExportCancelled' }
}

/**
 * Xuất Excel của chế độ gộp (cùng luật WebApp): một lượt lấy mã data khớp bộ lọc (đúng thứ tự đang xem), rồi đọc từng lô
 * cố định 200 data, lần lượt. Danh sách mã chốt từ đầu nên lượt mới phát sinh trong lúc xuất không làm lệch, trùng hay
 * sót. `isCancelled` được hỏi giữa các lô: hủy thì không ghi file dở. File: sheet "Theo người nhận" + "Tất cả lượt".
 */
export async function exportCampaignResultsMerged(input: {
  campaignId: number
  actionId: string
  platform: string
  query: CampaignResultRecipientIpcQuery
  options: readonly CampaignResultActionOption[]
  isCancelled(): boolean
  onProgress(done: number, total: number): void
  formatTime(value: string | null): string
}): Promise<number> {
  const api = window.electronAPI
  const fail = (message?: string) => { throw new Error(message || CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE) }
  const checkCancelled = () => { if (input.isCancelled()) throw new CampaignResultExportCancelled() }
  const keys = await api.campaignResultActions({ kind: 'keys', campaignId: input.campaignId, query: input.query })
  if (!keys.ok) return fail(keys.message)
  if (keys.data.truncated) return fail(CAMPAIGN_RESULT_RECIPIENTS_TOO_MANY)
  if (keys.data.ids.length === 0) return fail('Không có data để xuất.')
  const recipients: CampaignResultRecipient[] = []
  input.onProgress(0, keys.data.ids.length)
  for (let offset = 0; offset < keys.data.ids.length; offset += CAMPAIGN_RESULT_RECIPIENT_BATCH_SIZE) {
    checkCancelled()
    const batch = keys.data.ids.slice(offset, offset + CAMPAIGN_RESULT_RECIPIENT_BATCH_SIZE)
    const page = await api.campaignResultActions({ kind: 'byKeys', campaignId: input.campaignId, ids: batch })
    if (!page.ok) return fail(page.message)
    const byId = new Map(page.data.items.map(item => [item.id, item]))
    // Data bị xóa trong lúc xuất thì bỏ qua; thứ tự giữ theo danh sách mã.
    for (const id of batch) {
      const item = byId.get(id)
      if (item) recipients.push(item)
    }
    input.onProgress(Math.min(offset + batch.length, keys.data.ids.length), keys.data.ids.length)
  }
  checkCancelled()
  const sheets = campaignResultMergedSheets({
    actionCode: input.actionId, platform: input.platform, options: input.options, recipients, formatTime: input.formatTime
  })
  const book = utils.book_new()
  for (const sheet of sheets) utils.book_append_sheet(book, utils.json_to_sheet(sheet.rows), sheet.name)
  writeFile(book, campaignResultMergedFileName(input.campaignId))
  return recipients.length
}
