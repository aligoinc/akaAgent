/**
 * Bảng các loại chiến dịch Zalo đã tách sang lõi. Desktop và Fly chọn loại theo action_id; thêm một loại chỉ cần thêm
 * vào bảng này (các bước, kế hoạch claim, nhãn data, tên thao tác). Loại không có trong bảng thì nơi chạy dùng bộ cũ.
 */
import type { ClaimContext, TargetRow } from '../contracts.js'
import type { EngineStep } from '../runUnit.js'
import type { ConfigIssue } from '../validation.js'
import {
  ZALO_MESSAGE_FRIEND, ZALO_MESSAGE_FRIEND_ACTION_NAMES, ZALO_MESSAGE_GROUP, ZALO_MESSAGE_GROUP_ACTION_NAMES,
  ZALO_MESSAGE_GROUP_MEMBER, ZALO_MESSAGE_GROUP_REALTIME, ZALO_MESSAGE_PHONE, ZALO_MESSAGE_PHONE_ACTION_NAMES, ZALO_MESSAGE_REMARKETING_CUSTOMER, ZALO_UID_STRANGER_ACTION_NAMES,
  buildZaloMessagePhoneSteps, validateZaloMessagePhone, zaloMessagePhoneClaimPlan, zaloMessagePhoneTargetLabel, zaloMessagePhoneV2Support,
  zaloUidTargetLabel,
  type V2Support, type ZaloMessagePhoneCampaign, type ZaloMessagePhoneEnvironment, type ZaloMessagePhonePort, type ZaloStepOptions
} from './messagePhone.js'
import {
  ZALO_ADD_GROUP_MEMBER, ZALO_ADD_GROUP_MEMBER_ACTION_NAMES, buildZaloAddGroupMemberSteps, zaloAddGroupMemberClaimPlan,
  zaloAddGroupMemberV2Support, type ZaloAddGroupMemberPort
} from './addGroupMember.js'
import {
  ZALO_JOIN_GROUP_LINK, ZALO_JOIN_GROUP_LINK_ACTION_NAMES, buildZaloJoinGroupLinkSteps, zaloJoinGroupLinkClaimPlan, zaloJoinGroupLinkV2Support,
  type ZaloJoinGroupLinkPort
} from './joinGroupLink.js'
import type { BatchUnitConfig, PrepareTargetsApi, PrepareTargetsResult } from '../runUnit.js'
import {
  buildZaloShareBatch, isZaloShareCampaign, validateZaloShare, zaloShareV2Support, type ZaloShareBatchOptions, type ZaloSharePort
} from './share.js'
import {
  ZALO_CANCEL_SENT_FRIEND_REQUEST, ZALO_MESSAGE_BIRTHDAY, ZALO_MESSAGE_FRIEND_RECOMMENDATION, buildZaloPrepareTargets,
  type ZaloMaterializeOptions, type ZaloMaterializePort
} from './materialize.js'
import {
  ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_NAMES, buildZaloCancelSentFriendRequestSteps, zaloCancelSentFriendRequestClaimPlan,
  zaloCancelSentFriendRequestV2Support, type ZaloCancelSentFriendRequestPort
} from './cancelSentFriendRequest.js'
import { buildZaloSmsPush, type ZaloSmsPushPort } from './smsPush.js'
import { zaloEngagementAfterReport } from './engagement.js'
import type { AfterReportInfo } from '../runUnit.js'

/** Phần cấu hình chiến dịch lõi cần; mỗi nơi chạy dựng từ dòng auto_campaigns của mình. */
export type ZaloCampaign = ZaloMessagePhoneCampaign
export type ZaloCampaignEnvironment = ZaloMessagePhoneEnvironment
/** Cổng Zalo mỗi nơi chạy cài: hợp các thao tác mà mọi loại chiến dịch cần. */
export type ZaloCampaignPort = ZaloMessagePhonePort & ZaloAddGroupMemberPort & ZaloJoinGroupLinkPort & ZaloSharePort & ZaloMaterializePort
  & ZaloCancelSentFriendRequestPort & ZaloSmsPushPort

/** Nhắn bạn bè / group: gửi dạng chia sẻ chạy theo lô, gửi thường chạy từng data. */
const shareBatch = (campaign: ZaloCampaign, port: ZaloCampaignPort, opts?: ZaloShareBatchOptions): BatchUnitConfig | null =>
  isZaloShareCampaign(campaign) ? buildZaloShareBatch(campaign, port, opts) : null
const shareAwareValidate = (campaign: ZaloCampaign, env: { zaloWeb: boolean }): ConfigIssue[] =>
  isZaloShareCampaign(campaign) ? validateZaloShare(campaign, env) : validateZaloMessagePhone(campaign, env)
/** Lấy data đầu lượt (bạn bè "toàn bộ / theo tag", sinh nhật, đề xuất, huỷ lời mời); loại / chế độ không cần thì null. */
const prepareTargets = (campaign: ZaloCampaign, port: ZaloCampaignPort, opts: ZaloMaterializeOptions) =>
  buildZaloPrepareTargets(campaign, port, opts)
/** Kiêm SMS sau mỗi dòng lịch sử (theo SĐT, thành viên nhóm); không bật thì null. */
const smsPush = (campaign: ZaloCampaign, port: ZaloCampaignPort, opts: { targetLabel(target: TargetRow): string }) =>
  buildZaloSmsPush(campaign, port, opts)

/**
 * Việc sau mỗi dòng lịch sử của loại nhắn tin: đăng ký nguồn theo dõi tương tác (nhắn người lạ / bạn bè, kết bạn) như dòng lịch sử của bộ
 * chạy cũ, rồi kiêm SMS nếu loại có (thứ tự như Desktop: đăng ký lúc ghi dòng lịch sử, kiêm SMS sau).
 */
const messageAfterReport = (withSms: boolean) =>
  (campaign: ZaloCampaign, port: ZaloCampaignPort, opts: { targetLabel(target: TargetRow): string }) => {
    const engagement = zaloEngagementAfterReport(port)
    const push = withSms ? smsPush(campaign, port, opts) : null
    if (!engagement && !push) return null
    return async (info: AfterReportInfo): Promise<void> => {
      if (engagement) await engagement(info)
      if (push) await push(info)
    }
  }

export interface ZaloCampaignType {
  actionId: string
  /** Chiến dịch dùng tính năng chưa tách thì trả lý do; nơi chạy dùng bộ cũ cho chiến dịch đó. */
  support(campaign: ZaloCampaign, env: ZaloCampaignEnvironment): V2Support
  claimPlan(campaign: ZaloCampaign): Pick<ClaimContext, 'actions' | 'requireAny'>
  /** `opts.account`: tài khoản đang chạy (tag theo tài khoản, câu tiến trình). */
  buildSteps(campaign: ZaloCampaign, port: ZaloCampaignPort, opts?: ZaloStepOptions): readonly EngineStep[]
  /** Nhãn data trong câu tiến trình (getInputDataDisplayName của Desktop). */
  targetLabel(target: TargetRow): string
  /** Tên thao tác Desktop ghi vào lịch sử (actionName của helper). */
  actionNames: Readonly<Record<string, string>>
  /** Luật kiểm cấu hình đầu lượt (CFGxx); zaloWeb: tài khoản đăng nhập Zalo Web. */
  validate?(campaign: ZaloCampaign, env: { zaloWeb: boolean }): ConfigIssue[]
  /** Chạy theo lô (gửi dạng chia sẻ) thay cho buildSteps; null = chạy từng data. Nơi chạy gắn vào UnitConfig.batch. */
  buildBatch?(campaign: ZaloCampaign, port: ZaloCampaignPort, opts?: ZaloShareBatchOptions): BatchUnitConfig | null
  /** Lấy data đầu lượt; null = không cần. Nơi chạy gắn vào UnitConfig.prepareTargets và truyền note của onNoTarget cho finish_campaign_v2. */
  prepareTargets?(campaign: ZaloCampaign, port: ZaloCampaignPort, opts: ZaloMaterializeOptions):
    ((api: PrepareTargetsApi) => Promise<PrepareTargetsResult>) | null
  /** Việc kèm theo dòng lịch sử vừa ghi (kiêm SMS); null = không có. Nơi chạy gắn vào UnitConfig.afterReport. */
  afterReport?(campaign: ZaloCampaign, port: ZaloCampaignPort, opts: { targetLabel(target: TargetRow): string }):
    ((info: AfterReportInfo) => Promise<void>) | null
}

export const ZALO_CAMPAIGN_TYPES: Readonly<Record<string, ZaloCampaignType>> = {
  [ZALO_MESSAGE_PHONE]: {
    actionId: ZALO_MESSAGE_PHONE,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloMessagePhoneTargetLabel,
    actionNames: ZALO_MESSAGE_PHONE_ACTION_NAMES,
    validate: validateZaloMessagePhone,
    afterReport: messageAfterReport(true)
  },
  // Nhắn tin người lạ theo UID của data (workflow 272 / 274): cùng các bước gửi với "Nhắn tin theo SĐT", xác định người nhận
  // bằng hồ sơ đọc theo UID thay cho tra số.
  [ZALO_MESSAGE_GROUP_MEMBER]: {
    actionId: ZALO_MESSAGE_GROUP_MEMBER,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_UID_STRANGER_ACTION_NAMES,
    validate: validateZaloMessagePhone,
    afterReport: messageAfterReport(true)
  },
  // Group thời gian thực (workflow 276): các bước như thành viên nhóm; data do bộ nhận sự kiện của bản cũ đổ vào (vẫn chạy như hôm nay);
  // chờ data / hết ngày nhận do finish_campaign_v2 (V506) quyết định như handleZaloRealtimeGroupCompletion.
  [ZALO_MESSAGE_GROUP_REALTIME]: {
    actionId: ZALO_MESSAGE_GROUP_REALTIME,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_UID_STRANGER_ACTION_NAMES,
    validate: validateZaloMessagePhone,
    afterReport: messageAfterReport(false)
  },
  [ZALO_MESSAGE_REMARKETING_CUSTOMER]: {
    actionId: ZALO_MESSAGE_REMARKETING_CUSTOMER,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_UID_STRANGER_ACTION_NAMES,
    validate: validateZaloMessagePhone,
    afterReport: messageAfterReport(false)
  },
  // Nhắn tin bạn bè: gửi thường (workflow 266) từng data, gửi dạng chia sẻ theo lô (share.ts). Chế độ "toàn bộ / theo tag" lấy danh
  // sách bạn bè một lần ở đầu lượt đầu tiên (materialize.ts).
  [ZALO_MESSAGE_FRIEND]: {
    actionId: ZALO_MESSAGE_FRIEND,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_MESSAGE_FRIEND_ACTION_NAMES,
    validate: shareAwareValidate,
    buildBatch: shareBatch,
    prepareTargets,
    afterReport: messageAfterReport(false)
  },
  // Chúc mừng sinh nhật (workflow 270): đầu lượt lấy bạn bè có sinh nhật hôm nay, rồi nhắn như bạn bè (không tag akaBiz / Zalo, không đổi
  // tên, bỏ qua gửi dạng chia sẻ).
  [ZALO_MESSAGE_BIRTHDAY]: {
    actionId: ZALO_MESSAGE_BIRTHDAY,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_MESSAGE_FRIEND_ACTION_NAMES,
    validate: validateZaloMessagePhone,
    prepareTargets,
    afterReport: messageAfterReport(false)
  },
  // Nhắn tin / kết bạn theo đề xuất Zalo (workflow 280): đầu lượt lấy N đề xuất, rồi các bước như thành viên nhóm.
  [ZALO_MESSAGE_FRIEND_RECOMMENDATION]: {
    actionId: ZALO_MESSAGE_FRIEND_RECOMMENDATION,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_UID_STRANGER_ACTION_NAMES,
    validate: validateZaloMessagePhone,
    prepareTargets,
    afterReport: messageAfterReport(false)
  },
  // Huỷ lời mời kết bạn đã gửi (workflow từ migration_v135): đầu lượt lấy N lời mời cũ nhất, rồi huỷ từng lời mời.
  [ZALO_CANCEL_SENT_FRIEND_REQUEST]: {
    actionId: ZALO_CANCEL_SENT_FRIEND_REQUEST,
    support: campaign => zaloCancelSentFriendRequestV2Support(campaign),
    claimPlan: () => zaloCancelSentFriendRequestClaimPlan(),
    buildSteps: (campaign, port) => buildZaloCancelSentFriendRequestSteps(campaign, port),
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_NAMES,
    prepareTargets
  },
  // Nhắn tin group: gửi thường (workflow 268) từng data, gửi dạng chia sẻ theo lô.
  [ZALO_MESSAGE_GROUP]: {
    actionId: ZALO_MESSAGE_GROUP,
    support: zaloMessagePhoneV2Support,
    claimPlan: zaloMessagePhoneClaimPlan,
    buildSteps: buildZaloMessagePhoneSteps,
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_MESSAGE_GROUP_ACTION_NAMES,
    validate: shareAwareValidate,
    buildBatch: shareBatch
  },
  // Thêm thành viên vào group (workflow từ migration_v160): UID hoặc SĐT (tra số), group đích trong cấu hình.
  [ZALO_ADD_GROUP_MEMBER]: {
    actionId: ZALO_ADD_GROUP_MEMBER,
    support: campaign => zaloAddGroupMemberV2Support(campaign),
    claimPlan: () => zaloAddGroupMemberClaimPlan(),
    buildSteps: (campaign, port) => buildZaloAddGroupMemberSteps(campaign, port),
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_ADD_GROUP_MEMBER_ACTION_NAMES
  },
  // Vào group bằng link (workflow từ migration_v133): link ở cột uid.
  [ZALO_JOIN_GROUP_LINK]: {
    actionId: ZALO_JOIN_GROUP_LINK,
    support: campaign => zaloJoinGroupLinkV2Support(campaign),
    claimPlan: () => zaloJoinGroupLinkClaimPlan(),
    buildSteps: (campaign, port) => buildZaloJoinGroupLinkSteps(campaign, port),
    targetLabel: zaloUidTargetLabel,
    actionNames: ZALO_JOIN_GROUP_LINK_ACTION_NAMES
  }
}

export function zaloCampaignType(actionId: string): ZaloCampaignType | null {
  return Object.prototype.hasOwnProperty.call(ZALO_CAMPAIGN_TYPES, actionId) ? ZALO_CAMPAIGN_TYPES[actionId]! : null
}

/**
 * Chiến dịch có chạy bằng bộ mới không: loại chưa tách hoặc dùng tính năng chưa tách thì không.
 * Chặn chung cho mọi loại (đặc tả lịch chạy mục 8.3): nhóm theo thời gian thực. Gửi dạng chia sẻ (bạn bè / group) chạy theo lô với
 * điều kiện riêng (zaloShareV2Support; gửi lặp lại sau x phút do finish_campaign_v2 của V501 xử lý); loại khác không có dạng này.
 * Nhiều khung giờ và Nhóm data (hàm kết thúc Nhóm data của bản cũ) do claim / finish_campaign_v2 (V501) xử lý.
 */
export function zaloCampaignV2Support(campaign: ZaloCampaign, env: ZaloCampaignEnvironment): V2Support {
  const type = zaloCampaignType(campaign.actionId)
  if (!type) return { ok: false, reason: 'action_not_supported' }
  if (isZaloShareCampaign(campaign)) return zaloShareV2Support(campaign, env)
  const extra = campaign.extraSettings
  // Sinh nhật bỏ qua gửi dạng chia sẻ (Desktop chạy gửi thường).
  if (extra.zaloMessageSendMode === 'share' && campaign.actionId !== ZALO_MESSAGE_BIRTHDAY) return { ok: false, reason: 'share_mode' }
  return type.support(campaign, env)
}
