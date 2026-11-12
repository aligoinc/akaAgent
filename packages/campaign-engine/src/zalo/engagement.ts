/**
 * Theo dõi tương tác Zalo (V339 / V510: đã xem, phản hồi, thả cảm xúc, đồng ý kết bạn) cho tin và lời mời bộ mới gửi, như bộ chạy cũ:
 * - Desktop / VPS (campaignScheduler + zaloCampaignEngagement): giữ chỗ trước khi gửi (beginCampaignEngagementSend), ghi nguồn
 *   (makeEngagementSource) vào dòng lịch sử kèm zaloEngagementPending, giữ nguồn để khôi phục (stageCampaignEngagementSource), đăng ký sau
 *   khi có dòng lịch sử (recordCampaignEngagementDetail), bỏ giữ chỗ khi gửi lỗi (abandonCampaignEngagementSend);
 * - Fly (ZaloCampaignExecutor + CampaignEngagementRepository): ghi nguồn kèm zaloEngagementPending và zaloEngagementRuntime 'chat'; bộ ghi
 *   tương tác của worker tự quét dòng chờ đăng ký.
 * Chỉ áp cho nhắn người lạ, nhắn bạn bè và kết bạn (engagementApplicable của Desktop), không áp cho group. Lõi chỉ dựng nguồn và gọi cổng;
 * cổng không có các hàm này thì không theo dõi (nơi chạy cũ).
 */
import type { AfterReportInfo, StepContext } from '../runUnit.js'

/** Như ZaloEngagementSource của Desktop (src/shared/zaloCampaignEngagement.ts) và runtime-protocol của ChatApi. */
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

/** Một lần gửi đang được theo dõi (EngagementSendContext của Desktop). */
export interface ZaloEngagementSendContext {
  /** Phiên bản cấu hình theo dõi lúc gửi; rỗng là công tắc tắt (không theo dõi). */
  revision: string
  sentAt: string
  accountZaloUid?: string | null
  operationId?: string
  /** Trường nơi chạy cần thêm vào dòng lịch sử cùng nguồn (Fly: zaloEngagementRuntime 'chat'). */
  detailData?: Record<string, unknown>
}

export interface ZaloEngagementPort {
  /** Bắt đầu một lần gửi tới người nhận (giữ chỗ cho sự kiện đến trước khi có dòng lịch sử); null = không theo dõi. */
  engagementBegin?(ctx: StepContext, targetUid: string): ZaloEngagementSendContext | null
  /** Gửi lỗi / không có nguồn: bỏ giữ chỗ. */
  engagementAbandon?(ctx: StepContext, send: ZaloEngagementSendContext): void
  /** Ngay trước khi báo kết quả có nguồn: giữ nguồn để khôi phục khi tiến trình chết trước khi đăng ký. */
  engagementStage?(ctx: StepContext, source: ZaloEngagementSource): void
  /** Sau khi DB ghi dòng lịch sử có nguồn: đăng ký (Desktop: hàng đăng ký; Fly: đánh thức bộ ghi tương tác). */
  engagementRegister?(detailId: number, source: ZaloEngagementSource): void
  trace?(event: { type: string; [key: string]: unknown }): void
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const id = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : ''

/** Như engagementMessageIds của Desktop: chỉ mã tin trong vỏ kết quả gửi của SDK, không đọc nội dung hay mã phía máy gửi. */
export function zaloEngagementMessageIds(result: unknown): string[] {
  const out = new Set<string>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) return
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    const row = record(value)
    for (const key of ['msgId', 'msgID', 'globalMsgId']) {
      const found = id(row[key]); if (found) out.add(found)
    }
    for (const key of ['message', 'attachment', 'response', 'mediaResponse', 'contentResponse', 'data']) {
      if (row[key] !== undefined) visit(row[key], depth + 1)
    }
  }
  visit(result, 0)
  return Array.from(out)
}

/** Như makeEngagementSource của Desktop: thiếu UID tài khoản / người nhận, gửi cho chính mình, công tắc tắt hay giờ gửi sai thì không có nguồn. */
export function makeZaloEngagementSource(send: ZaloEngagementSendContext | null, targetUid: string, actionType: ZaloEngagementSource['actionType'],
  responses: unknown): ZaloEngagementSource | undefined {
  const ownUid = String(send?.accountZaloUid ?? '').trim()
  const target = String(targetUid ?? '').trim()
  if (!send || !ownUid || !target || ownUid === target || !send.revision || !Number.isFinite(Date.parse(send.sentAt))) return undefined
  return { version: 1, ...(send.operationId ? { operationId: send.operationId } : {}), accountZaloUid: ownUid, targetZaloUid: target, actionType,
    sentAt: send.sentAt, messageIds: actionType === 'message' ? zaloEngagementMessageIds(responses) : [], revision: send.revision }
}

/** Trường ghi vào dòng lịch sử cùng nguồn (dòng chờ đăng ký như bộ chạy cũ của hai nơi). */
export function zaloEngagementDetailData(source: ZaloEngagementSource, send: ZaloEngagementSendContext): Record<string, unknown> {
  return { ...(send.detailData ?? {}), zaloEngagementSource: source, zaloEngagementPending: true }
}

/**
 * Một lần gửi tới một người: bắt đầu trước khi gửi; xong thì gọi finish với phản hồi gửi được (dựng nguồn, giữ để khôi phục, trả trường
 * cho dòng lịch sử) hoặc abandon. Không gọi gì thì coi như bỏ (gọi abandon ở finally).
 */
export function beginZaloEngagement(port: ZaloEngagementPort, ctx: StepContext, targetUid: string,
  actionType: ZaloEngagementSource['actionType']) {
  let send: ZaloEngagementSendContext | null = null
  try {
    send = port.engagementBegin?.(ctx, targetUid) ?? null
  } catch (error) {
    port.trace?.({ type: 'engagement_begin_failed', error: error instanceof Error ? error.message : String(error) })
  }
  let settled = false
  const abandon = (): void => {
    if (settled) return
    settled = true
    if (!send) return
    try { port.engagementAbandon?.(ctx, send) } catch { /* giữ chỗ tự hết hạn ở nơi chạy */ }
  }
  return {
    active: send !== null,
    /** Gửi được: nguồn + trường cho dòng lịch sử (rỗng khi không theo dõi). */
    finish(responses: unknown): Record<string, unknown> {
      if (settled) return {}
      const source = makeZaloEngagementSource(send, targetUid, actionType, responses)
      if (!source || !send) { abandon(); return {} }
      settled = true
      try { port.engagementStage?.(ctx, source) } catch (error) {
        port.trace?.({ type: 'engagement_stage_failed', error: error instanceof Error ? error.message : String(error) })
      }
      return zaloEngagementDetailData(source, send)
    },
    abandon
  }
}

/** Nguồn trong dữ liệu dòng lịch sử của một kết quả (null nếu không có). */
export function zaloEngagementSourceOf(data: unknown): ZaloEngagementSource | null {
  const source = record(record(data).zaloEngagementSource)
  return source.version === 1 && typeof source.targetZaloUid === 'string' && typeof source.revision === 'string'
    ? source as unknown as ZaloEngagementSource : null
}

/** Sau khi DB ghi: đăng ký nguồn của dòng lịch sử mới (dòng ghi lại theo result_key thì đã đăng ký từ lần đầu). */
export function registerZaloEngagement(port: ZaloEngagementPort, decisions: ReadonlyArray<{ detailId: number | null; replay?: boolean }>,
  data: unknown): void {
  const source = zaloEngagementSourceOf(data)
  if (!source || !port.engagementRegister) return
  for (const decision of decisions) {
    if (decision.detailId === null || decision.detailId === undefined || decision.replay) continue
    try { port.engagementRegister(decision.detailId, source) } catch (error) {
      port.trace?.({ type: 'engagement_register_failed', detailId: decision.detailId, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** UnitConfig.afterReport: đăng ký nguồn tương tác của bước vừa báo (từng data). */
export function zaloEngagementAfterReport(port: ZaloEngagementPort): ((info: AfterReportInfo) => Promise<void>) | null {
  if (!port.engagementRegister) return null
  return async info => {
    if (!info.raw.ok) return
    registerZaloEngagement(port, info.decisions, info.raw.data)
  }
}
