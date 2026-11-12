/**
 * "Huỷ lời mời kết bạn đã gửi" (zalo_cancel_sent_friend_request, workflow từ migration_v135), tách từ bộ chạy Desktop/VPS
 * (zaloCancelSentFriendRequest): data do bước lấy data đầu lượt thêm vào (materialize.ts: N lời mời cũ nhất, info1 = thời điểm gửi,
 * info2 = lời nhắn, info3 = global ID) → huỷ lời mời (undoFriendRequest) → dòng lịch sử. Không nội dung, không cổng, không thao tác phụ.
 * Claim chỉ kiểm khoá của thao tác, không kiểm hạn mức (limit_check_action_codes rỗng ở bản cũ; V505).
 */
import type { ClaimContext } from '../contracts.js'
import type { EngineStep, StepContext } from '../runUnit.js'
import { firstString, zaloFailure, zaloTargetFromInput, zaloTargetLabel } from './common.js'
import type { V2Support, ZaloMessagePhoneCampaign } from './messagePhone.js'
import { ZALO_CANCEL_SENT_FRIEND_REQUEST } from './materialize.js'

const NAME_CANCEL = 'Huỷ lời mời kết bạn'
export const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_NAMES: Readonly<Record<string, string>> = { [ZALO_CANCEL_SENT_FRIEND_REQUEST]: NAME_CANCEL }

type JsonObject = Record<string, unknown>

export interface ZaloCancelSentFriendRequestPort {
  /** Huỷ lời mời kết bạn đã gửi (Desktop: undoFriendRequest; Fly: lệnh undo_friend_request). Lỗi Zalo: ZaloPortError (gửi). */
  undoFriendRequest(ctx: StepContext, uid: string): Promise<unknown>
}

export function zaloCancelSentFriendRequestV2Support(campaign: ZaloMessagePhoneCampaign): V2Support {
  if (campaign.actionId !== ZALO_CANCEL_SENT_FRIEND_REQUEST) return { ok: false, reason: 'action_not_supported' }
  return { ok: true }
}

/** Chỉ khoá của thao tác huỷ, không hạn mức (V505: "quota": false). */
export function zaloCancelSentFriendRequestClaimPlan(): Pick<ClaimContext, 'actions' | 'requireAny'> {
  return { actions: [{ code: ZALO_CANCEL_SENT_FRIEND_REQUEST, quota: false }] }
}

export function buildZaloCancelSentFriendRequestSteps(_campaign: ZaloMessagePhoneCampaign,
  port: ZaloCancelSentFriendRequestPort): readonly EngineStep[] {
  // Không UID: Desktop tự đặt mã 114 (tín hiệu engine riêng, DB đổi ra DAT01), không gọi Zalo, không ghi dấu "sắp gửi".
  const target: EngineStep = {
    key: 'target',
    actionCode: ZALO_CANCEL_SENT_FRIEND_REQUEST,
    actionName: NAME_CANCEL,
    delivery: false,
    gate: true,
    run: async ctx => {
      const uid = String(ctx.target.uid || '').trim()
      if (!uid) {
        return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'target_missing_identity', message: 'UID lời mời kết bạn Zalo không hợp lệ' },
          data: { uid } }
      }
      return { ok: true }
    }
  }

  const cancel: EngineStep = {
    key: 'cancel_friend_request',
    actionCode: ZALO_CANCEL_SENT_FRIEND_REQUEST,
    actionName: NAME_CANCEL,
    delivery: true,
    requires: ['target'],
    run: async ctx => {
      const input = ctx.target as unknown as JsonObject
      const uid = String(ctx.target.uid || '').trim()
      // Như zaloCancelSentFriendRequest: thời điểm gửi và lời nhắn lấy từ info1 / info2 của data.
      const sentAt = input.info1 ?? null
      const requestMessage = firstString(input.info2) ?? ''
      const target = zaloTargetFromInput(uid, input, { source: 'zalo_sent_friend_requests', sentAt, requestMessage }, false)
      const data = { target, sentAt, requestMessage }
      try {
        const response = await port.undoFriendRequest(ctx, target.uid)
        return {
          ok: true,
          statusCode: 'campaign_detail_success',
          customerLog: `Đã huỷ lời mời kết bạn đã gửi đến ${zaloTargetLabel(target)}`,
          data: { ...data, response: response ?? null }
        }
      } catch (error) {
        if (ctx.signal.aborted) throw error
        return zaloFailure(error, 'after_send', data)
      }
    }
  }

  return [target, cancel]
}
