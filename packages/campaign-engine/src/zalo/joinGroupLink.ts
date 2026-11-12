/**
 * "Vào group bằng link" (zalo_join_group_link, workflow từ migration_v133), tách từ bộ chạy Desktop/VPS (zaloJoinGroupLink): link nằm
 * ở cột uid của data; chuẩn hoá (normalizeZaloGroupInviteLink) → tham gia (joinGroupByLink: 178 = đã tham gia, 240 = chờ duyệt) →
 * lưu danh bạ group (is_joined khi đã vào hoặc đã ở trong group) → dòng lịch sử. Không nội dung, không cổng, không thao tác phụ.
 */
import type { ClaimContext } from '../contracts.js'
import type { EngineStep, StepContext } from '../runUnit.js'
import { errorMessage } from '../boundary.js'
import { firstString, zaloFailure, zaloTargetFromInput } from './common.js'
import type { V2Support, ZaloMessagePhoneCampaign } from './messagePhone.js'

export const ZALO_JOIN_GROUP_LINK = 'zalo_join_group_link'
const NAME_JOIN = 'Tham gia group'
export const ZALO_JOIN_GROUP_LINK_ACTION_NAMES: Readonly<Record<string, string>> = { [ZALO_JOIN_GROUP_LINK]: NAME_JOIN }

type JsonObject = Record<string, unknown>

/** Kết quả tham gia (ZaloJoinGroupLinkResult của Desktop). */
export interface ZaloJoinGroupLinkResult {
  link: string
  group: JsonObject
  groupId: string
  groupName?: string | null
  /** joined | already_joined | pending_approval */
  outcome: string
  response?: unknown
  zaloCode?: string | null
  zaloMessage?: string | null
}

export interface ZaloJoinGroupLinkPort {
  /** Tham gia group bằng link đã chuẩn hoá (Desktop: joinGroupByLink; Fly: lệnh join_group_link). Lỗi Zalo: ZaloPortError (gửi). */
  joinGroupByLink(ctx: StepContext, link: string): Promise<ZaloJoinGroupLinkResult>
  /** Lưu danh bạ group (upsertZaloJoinGroupLinkContact): isJoined khi đã vào / đã ở trong group. Không có ID group thì bỏ qua. */
  saveJoinedGroup(ctx: StepContext, result: ZaloJoinGroupLinkResult, isJoined: boolean): Promise<void>
}

/** Như normalizeZaloGroupInviteLink của Desktop: `zalo.me/g/<mã>` hoặc `zaloapp.com/qr/g/<mã>` → `https://zalo.me/g/<mã>`; sai thì rỗng. */
export function normalizeZaloGroupInviteLink(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withProtocol)
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    let groupCode = ''
    if (hostname === 'zalo.me' || hostname.endsWith('.zalo.me')) {
      if (parts[0]?.toLowerCase() !== 'g') return ''
      groupCode = parts[1] || ''
    } else if (hostname === 'zaloapp.com' || hostname.endsWith('.zaloapp.com')) {
      if (parts[0]?.toLowerCase() !== 'qr' || parts[1]?.toLowerCase() !== 'g') return ''
      groupCode = parts[2] || ''
    } else {
      return ''
    }
    return groupCode ? `https://zalo.me/g/${groupCode}` : ''
  } catch {
    return ''
  }
}

export function zaloJoinGroupLinkV2Support(campaign: ZaloMessagePhoneCampaign): V2Support {
  if (campaign.actionId !== ZALO_JOIN_GROUP_LINK) return { ok: false, reason: 'action_not_supported' }
  return { ok: true }
}

export function zaloJoinGroupLinkClaimPlan(): Pick<ClaimContext, 'actions' | 'requireAny'> {
  return { actions: [{ code: ZALO_JOIN_GROUP_LINK }] }
}

export function buildZaloJoinGroupLinkSteps(_campaign: ZaloMessagePhoneCampaign,
  port: ZaloJoinGroupLinkPort & { trace?(event: { type: string; [key: string]: unknown }): void }): readonly EngineStep[] {
  // Kiểm link trước, không ghi dấu "sắp gửi": link sai thì Desktop tự đặt mã 114 (DB đổi ra DAT01), không gọi Zalo.
  const target: EngineStep = {
    key: 'target',
    actionCode: ZALO_JOIN_GROUP_LINK,
    actionName: NAME_JOIN,
    delivery: false,
    gate: true,
    run: async ctx => {
      const raw = String(ctx.target.uid || '').trim()
      const link = normalizeZaloGroupInviteLink(raw)
      if (!link) {
        return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'target_missing_identity', message: 'Link group Zalo không hợp lệ' },
          data: { link: raw } }
      }
      return { ok: true, state: { joinLink: link } }
    }
  }

  const join: EngineStep = {
    key: 'join',
    actionCode: ZALO_JOIN_GROUP_LINK,
    actionName: NAME_JOIN,
    delivery: true,
    requires: ['target'],
    run: async ctx => {
      const link = String(ctx.state.joinLink)
      let result: ZaloJoinGroupLinkResult
      try {
        result = await port.joinGroupByLink(ctx, link)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        return zaloFailure(error, 'after_send', { link })
      }
      const confirmed = result.outcome === 'joined' || result.outcome === 'already_joined'
      const pending = result.outcome === 'pending_approval'
      if (!confirmed && !pending) {
        // Desktop ném lỗi không mã rồi ghi theo chính sách lỗi Zalo không mã.
        const message = result.zaloMessage || 'Không xác định được kết quả tham gia group Zalo'
        return { ok: false, phase: 'after_send', signal: { kind: 'message_like', message }, data: { link } }
      }
      try {
        await port.saveJoinedGroup(ctx, result, confirmed)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        // Lỗi ghi DB của mình không đổi kết quả Zalo (F1); bản cũ ghi thành lỗi tham gia.
        port.trace?.({ type: 'save_joined_group_failed', inputDataId: ctx.target.id, error: errorMessage(error) })
      }
      const groupLabel = firstString(result.groupName, result.groupId, result.link) ?? link
      const input = ctx.target as unknown as JsonObject
      const groupTarget = zaloTargetFromInput(firstString(result.groupId, result.link) ?? link,
        { ...input, uid: firstString(result.groupId, input.uid, result.link), name: groupLabel },
        { type: 'group', link: result.link, group: result.group, joinOutcome: result.outcome }, false)
      const data = {
        target: groupTarget, link: result.link, groupId: result.groupId, groupName: groupLabel, group: result.group,
        response: result.response ?? null, zalo: { code: result.zaloCode ?? null, message: result.zaloMessage ?? null }
      }
      if (result.outcome === 'already_joined') {
        return { ok: true, statusCode: 'campaign_detail_joined', customerLog: `Tài khoản đã tham gia group ${groupLabel} từ trước`, data }
      }
      if (pending) return { ok: true, customerLog: `Đã gửi yêu cầu tham gia group ${groupLabel}, đang chờ duyệt`, data }
      return { ok: true, customerLog: `Đã tham gia group ${groupLabel}`, data }
    }
  }

  return [target, join]
}
