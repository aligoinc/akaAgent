/**
 * "Thêm thành viên vào group" (zalo_add_group_member, workflow từ migration_v160), tách từ bộ chạy Desktop/VPS (campaignScheduler.ts):
 * - data có UID: đọc hồ sơ theo UID + lưu danh bạ, không tag akaBiz (zaloResolveAddGroupMemberTarget);
 * - data chỉ có SĐT: kiểm khoá / hạn mức "Tìm SĐT" lúc chạy (checkZaloFindPhoneUserRuntimeLimit: bị khoá thì không ghi lịch sử, data về
 *   hàng đợi, dừng lượt), tra số như "Nhắn tin theo SĐT" rồi tag akaBiz (zaloFindPhoneUser);
 * - không UID, không SĐT: `Data cần có SĐT hoặc UID Zalo` (DAT01, không tính lượt);
 * - thêm vào group cấu hình trong chiến dịch (zaloAddGroupMember): đã là thành viên → "đã là thành viên", không tính lượt; gửi link
 *   group (zaloAddGroupMemberUseShareMethod) → `Gửi lời mời thành công đến … qua link group …`; còn lại `${message} cho … vào group …`.
 * Không có cổng từ chối nhận tin, chống gửi lặp, nội dung, tag Zalo / đổi tên.
 */
import type { ClaimContext } from '../contracts.js'
import type { EngineStep, StepContext } from '../runUnit.js'
import { DeadlineError, errorMessage } from '../boundary.js'
import { firstString, mergeZaloProfileTarget, zaloFailure, zaloTargetFromInput, zaloTargetLabel, type ZaloResolvedTarget } from './common.js'
import { buildAkaBizTagStep } from './auxiliary.js'
import { FIND_PHONE, buildZaloPhoneLookupStep, type V2Support, type ZaloMessagePhoneCampaign, type ZaloMessagePhonePort } from './messagePhone.js'

export const ZALO_ADD_GROUP_MEMBER = 'zalo_add_group_member'
const NAME_ADD_MEMBER = 'Thêm thành viên vào group'
export const ZALO_ADD_GROUP_MEMBER_ACTION_NAMES: Readonly<Record<string, string>> = {
  [ZALO_ADD_GROUP_MEMBER]: NAME_ADD_MEMBER,
  [FIND_PHONE]: 'Tìm SĐT'
}

type JsonObject = Record<string, unknown>

/** Kết quả thêm một thành viên (ZaloAddGroupMemberResult của Desktop). */
export interface ZaloAddGroupMemberResult {
  groupId: string
  groupName?: string | null
  groupType?: number | null
  /** direct_add | invite_user_to_groups | share_group_link */
  mode: string
  outcome: 'added' | 'invited' | 'link_sent' | 'already_member'
  /** Câu của Desktop: "Đã thêm thành viên vào group", "Đã gửi lời mời vào group", "Gửi lời mời thành công", "Đã là thành viên của group". */
  message: string
  groupLink?: string | null
  response?: unknown
}

export interface ZaloAddGroupMemberPort {
  /** Thêm / mời một UID vào group (addMemberToGroup của Desktop; Fly: lệnh add_group_member). Lỗi Zalo: ZaloPortError (thao tác gửi). */
  addGroupMember(ctx: StepContext, input: { groupId: string; memberId: string; useShareMethod: boolean }): Promise<ZaloAddGroupMemberResult>
}

/** Group đích trong cấu hình: bỏ tiền tố "g" như Desktop; tên mặc định là ID. */
export function zaloAddGroupMemberTarget(extra: JsonObject): { id: string; name: string } {
  const id = (firstString(extra.zaloAddGroupMemberTargetGroupId) ?? '').replace(/^g/i, '')
  return { id, name: firstString(extra.zaloAddGroupMemberTargetGroupName, id) ?? '' }
}

export function zaloAddGroupMemberV2Support(campaign: ZaloMessagePhoneCampaign): V2Support {
  if (campaign.actionId !== ZALO_ADD_GROUP_MEMBER) return { ok: false, reason: 'action_not_supported' }
  // Chưa chọn group (form bắt chọn; 0/37 chiến dịch 30 ngày tới 12/11): bộ cũ ghi lỗi từng data rồi tạm dừng sau 4 data, giữ nguyên.
  if (!zaloAddGroupMemberTarget(campaign.extraSettings).id) return { ok: false, reason: 'add_member_group_missing' }
  return { ok: true }
}

/**
 * Khoá / hạn mức "Thêm thành viên vào group" chặn cả data như preflight của Desktop. "Tìm SĐT" không bắt buộc: chỉ data chỉ có SĐT
 * mới cần, và khi đó bước tra số trả data về hàng đợi (onGateWait 'requeue') thay vì chặn chiến dịch chỉ có UID.
 */
export function zaloAddGroupMemberClaimPlan(): Pick<ClaimContext, 'actions' | 'requireAny'> {
  return { actions: [{ code: ZALO_ADD_GROUP_MEMBER }, { code: FIND_PHONE, required: false }] }
}

export function buildZaloAddGroupMemberSteps(campaign: ZaloMessagePhoneCampaign, port: ZaloMessagePhonePort & ZaloAddGroupMemberPort): readonly EngineStep[] {
  const extra = campaign.extraSettings
  const group = zaloAddGroupMemberTarget(extra)
  const useShareMethod = extra.zaloAddGroupMemberUseShareMethod === true
  const uidOf = (ctx: StepContext): string => String(ctx.target.uid || '').trim()
  const phoneOf = (ctx: StepContext): string => String(ctx.target.phone || '').trim()
  const resolvedTarget = (ctx: StepContext): ZaloResolvedTarget | null => {
    const target = ctx.state.zaloTarget as ZaloResolvedTarget | undefined
    return target?.uid ? target : null
  }

  const resolve: EngineStep = {
    key: 'resolve',
    actionCode: ZALO_ADD_GROUP_MEMBER,
    actionName: NAME_ADD_MEMBER,
    delivery: false,
    gate: true,
    run: async ctx => {
      const uid = uidOf(ctx)
      if (uid) {
        // Như zaloResolveAddGroupMemberTarget: mục tiêu từ data (nguồn zalo_add_group_member, không phải bạn bè) ghép hồ sơ đọc theo
        // UID; đọc lỗi thì giữ mục tiêu từ data; lưu danh bạ khi có hồ sơ. Lỗi ghi DB không đổi kết quả (F1).
        let target = zaloTargetFromInput(uid, ctx.target as unknown as JsonObject, { source: ZALO_ADD_GROUP_MEMBER }, false)
        try {
          target = mergeZaloProfileTarget(target, await port.getUserProfile(ctx, uid))
        } catch (error) {
          // Đọc hồ sơ bị treo: như bước resolve của "Nhắn tin theo SĐT" (DeadlineError của cổng như hạn bước của Desktop).
          if (ctx.signal.aborted || error instanceof DeadlineError) throw error
          port.trace?.({ type: 'get_user_profile_failed', inputDataId: ctx.target.id, error: errorMessage(error) })
        }
        const profile = target.raw && typeof target.raw === 'object' ? (target.raw as JsonObject).profile : null
        if (profile && typeof profile === 'object' && Object.keys(profile).length > 0) {
          try {
            await port.saveResolvedProfile(ctx, target)
          } catch (error) {
            if (ctx.signal.aborted) throw error
            port.trace?.({ type: 'save_resolved_profile_failed', inputDataId: ctx.target.id, error: errorMessage(error) })
          }
        }
        return { ok: true, state: { zaloTarget: target } }
      }
      // Chỉ SĐT: tra số ở bước sau.
      if (phoneOf(ctx)) return { ok: true }
      return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'target_missing_identity', message: 'Data cần có SĐT hoặc UID Zalo' },
        data: {} }
    }
  }

  const lookup = buildZaloPhoneLookupStep(port, {
    requires: ['resolve'],
    enabled: ctx => !uidOf(ctx) && Boolean(phoneOf(ctx)),
    onGateWait: 'requeue'
  })
  // Như zaloFindPhoneUser: tra được thì tag akaBiz (data có UID không tag).
  const akaBiz = buildAkaBizTagStep(campaign, port, { requires: ['lookup'], contactType: 'person', actionCode: FIND_PHONE })

  const add: EngineStep = {
    key: 'add',
    actionCode: ZALO_ADD_GROUP_MEMBER,
    actionName: NAME_ADD_MEMBER,
    delivery: true,
    requires: ['resolve'],
    // Không xác định được người cần thêm (tra số không ra, bị bỏ qua) thì không gọi Zalo.
    enabled: ctx => resolvedTarget(ctx) !== null,
    run: async ctx => {
      const target = resolvedTarget(ctx)!
      let result: ZaloAddGroupMemberResult
      try {
        result = await port.addGroupMember(ctx, { groupId: group.id, memberId: target.uid, useShareMethod })
      } catch (error) {
        if (ctx.signal.aborted) throw error
        return zaloFailure(error, 'after_send', { target, targetGroup: { id: group.id, name: group.name }, useShareMethod })
      }
      const targetLabel = zaloTargetLabel(target)
      const groupLabel = firstString(result.groupName, group.name, result.groupId) ?? ''
      const already = result.outcome === 'already_member'
      const customerLog = already
        ? `${targetLabel} đã là thành viên của group ${groupLabel}`
        : result.mode === 'share_group_link'
          ? `Gửi lời mời thành công đến ${targetLabel} qua link group ${groupLabel}`
          : `${result.message} cho ${targetLabel} vào group ${groupLabel}`
      return {
        ok: true,
        ...(already ? { statusCode: 'campaign_detail_already_member' } : {}),
        customerLog,
        data: {
          target,
          targetGroup: { id: result.groupId, name: groupLabel, type: result.groupType ?? null },
          mode: result.mode,
          outcome: result.outcome,
          useShareMethod,
          groupLink: result.groupLink ?? null,
          response: result.response ?? null
        }
      }
    }
  }

  return [resolve, lookup, akaBiz, add]
}
